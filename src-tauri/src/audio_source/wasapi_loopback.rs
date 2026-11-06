//! WASAPI のループバックによる入力源（Windows）
//!
//! 出力デバイスに流れている音を、共有モードのループバックで取得する。取得はイベント駆動の
//! 専用スレッドで行い、ステレオ・f32 に揃えて `FrameSink` に書き込む。
//!
//! - 何も再生されていない間、ループバックはパケットを出さない。そのままでは最後の波形が
//!   止まって見えるため、届かなかった時間を0のフレームで埋める（無音の判定にも数える）
//! - デバイスの切断・無効化、Windows の設定でのサンプルレートの変更は、ストリームの読み取りの
//!   失敗として現れる。`Unavailable` を通知し、定期的に（デバイスの変化の通知があればすぐに）開き直す
//! - 既定の出力デバイスに追従しているとき（`device_id` が `None`）は、既定が変わったら
//!   `Opening` を通知して新しい既定を開き直す

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use wasapi::{
    AudioCaptureClient, AudioClient, Device, DeviceEnumerator, DeviceEventCallbacks,
    DeviceEventRegistration, DeviceState, Direction, Handle, Role, SampleType, StreamMode,
    WasapiError,
};

use super::convert::{SampleKind, StereoConverter};
use super::state::{SilenceDetector, StatusReporter};
use super::{
    AudioFormat, AudioSource, DeviceInfo, FrameSink, SourceError, SourceStatus, StatusSink,
    UnavailableReason,
};

/// イベントを待つ最長の時間。停止の要求と、音が届かない時間の検出はこの間隔で確かめる
const WAIT_MS: u32 = 20;
/// 音がこの時間届かなければ、届かなかった分を0のフレームで埋める
const GAP_FILL_AFTER: Duration = Duration::from_millis(40);
/// 一度に埋める上限（スリープからの復帰などで極端に長い時間が空いたとき）
const GAP_FILL_MAX: Duration = Duration::from_secs(1);
/// 使えない間に開き直しを試す間隔
const RETRY_INTERVAL: Duration = Duration::from_secs(1);
/// 共有モードのバッファの長さ（100ns 単位）。読み取りが少し遅れても取りこぼさないように長めにとる。
/// イベントは音声エンジンの周期（約10ms）ごとに来るので、遅れはこの長さに左右されない
const BUFFER_DURATION_HNS: i64 = 2_000_000;

// HRESULT（ビットの並びをそのまま i32 にする）
const AUDCLNT_E_DEVICE_INVALIDATED: i32 = 0x8889_0004_u32 as i32;
const AUDCLNT_E_DEVICE_IN_USE: i32 = 0x8889_000A_u32 as i32;
/// HRESULT_FROM_WIN32(ERROR_NOT_FOUND)。既定の出力デバイスがないときに返る
const E_NOTFOUND: i32 = 0x8007_0490_u32 as i32;

/// WASAPI のループバックによる入力源
#[derive(Default)]
pub struct WasapiLoopback {
    worker: Option<Worker>,
}

struct Worker {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

impl WasapiLoopback {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Drop for WasapiLoopback {
    fn drop(&mut self) {
        self.stop();
    }
}

impl AudioSource for WasapiLoopback {
    fn list_devices(&self) -> Result<Vec<DeviceInfo>, SourceError> {
        // 呼び出し元のスレッドの COM の状態（UI スレッドは STA）に左右されないよう、専用のスレッドで行う
        thread::spawn(|| with_mta(list_devices_mta))
            .join()
            .unwrap_or_else(|_| Err(SourceError::Backend("device listing panicked".into())))
    }

    fn start(
        &mut self,
        device_id: Option<&str>,
        sink: FrameSink,
        on_status: StatusSink,
    ) -> Result<AudioFormat, SourceError> {
        self.stop();

        let stop = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready_rx) = mpsc::channel();
        let device_id = device_id.map(str::to_owned);
        let stop_in = Arc::clone(&stop);
        let thread = thread::Builder::new()
            .name("wasapi-loopback".into())
            .spawn(move || {
                with_mta(|| capture_thread(device_id, sink, on_status, &stop_in, ready_tx));
            })
            .map_err(|e| SourceError::Backend(e.to_string()))?;

        match ready_rx.recv() {
            Ok(Ok(format)) => {
                self.worker = Some(Worker { stop, thread });
                Ok(format)
            }
            Ok(Err(err)) => {
                let _ = thread.join();
                Err(err)
            }
            Err(_) => {
                let _ = thread.join();
                Err(SourceError::Backend("capture thread exited".into()))
            }
        }
    }

    fn stop(&mut self) {
        if let Some(worker) = self.worker.take() {
            worker.stop.store(true, Ordering::Release);
            let _ = worker.thread.join();
        }
    }
}

/// このスレッドで COM を MTA として初期化して `f` を実行する
fn with_mta<T>(f: impl FnOnce() -> T) -> T {
    let initialized = wasapi::initialize_mta().is_ok();
    // COM のオブジェクトは `f` の中で作って捨てるので、解放の前にすべて片づいている
    let result = f();
    if initialized {
        wasapi::deinitialize();
    }
    result
}

fn map_error(err: WasapiError) -> SourceError {
    let detail = err.to_string();
    match &err {
        WasapiError::DeviceNotFound(_) => SourceError::NotFound(detail),
        WasapiError::Windows(e) => match e.code().0 {
            E_NOTFOUND | AUDCLNT_E_DEVICE_INVALIDATED => SourceError::NotFound(detail),
            AUDCLNT_E_DEVICE_IN_USE => SourceError::InUse(detail),
            _ => SourceError::Backend(detail),
        },
        _ => SourceError::Backend(detail),
    }
}

fn default_render_id(enumerator: &DeviceEnumerator) -> Option<String> {
    enumerator
        .get_default_device(&Direction::Render)
        .and_then(|d| d.get_id())
        .ok()
}

fn device_info(device: &Device, default_id: Option<&str>) -> Result<DeviceInfo, SourceError> {
    let id = device.get_id().map_err(map_error)?;
    let name = device.get_friendlyname().unwrap_or_else(|_| id.clone());
    Ok(DeviceInfo {
        is_default: default_id == Some(id.as_str()),
        id,
        name,
    })
}

fn list_devices_mta() -> Result<Vec<DeviceInfo>, SourceError> {
    let enumerator = DeviceEnumerator::new().map_err(map_error)?;
    let default_id = default_render_id(&enumerator);
    // 有効な（DEVICE_STATE_ACTIVE の）出力デバイスだけが返る
    let collection = enumerator
        .get_device_collection(&Direction::Render)
        .map_err(map_error)?;
    let count = collection.get_nbr_devices().map_err(map_error)?;
    (0..count)
        .map(|i| {
            let device = collection.get_device_at_index(i).map_err(map_error)?;
            device_info(&device, default_id.as_deref())
        })
        .collect()
}

/// 開くデバイスを決める。見つかっても有効でなければ使えない
fn resolve_device(
    enumerator: &DeviceEnumerator,
    device_id: Option<&str>,
) -> Result<(Device, DeviceInfo), (SourceError, Option<DeviceInfo>)> {
    let device = match device_id {
        None => enumerator.get_default_device(&Direction::Render),
        Some(id) => enumerator.get_device(id),
    }
    .map_err(|e| (map_error(e), None))?;
    let default_id = default_render_id(enumerator);
    let info = device_info(&device, default_id.as_deref()).map_err(|e| (e, None))?;

    if device.get_direction() != Direction::Render {
        return Err((
            SourceError::NotFound(format!("not an output device: {}", info.id)),
            Some(info),
        ));
    }
    match device.get_state() {
        Ok(DeviceState::Active) => Ok((device, info)),
        Ok(state) => Err((
            SourceError::NotFound(format!("device is {state}: {}", info.id)),
            Some(info),
        )),
        Err(e) => Err((map_error(e), Some(info))),
    }
}

/// 開いているループバックのストリーム
struct Stream {
    device: DeviceInfo,
    format: AudioFormat,
    client: AudioClient,
    capture: AudioCaptureClient,
    event: Handle,
    converter: StereoConverter,
    /// デバイスから読むバイト列（バッファ全体が入る大きさ）
    raw: Vec<u8>,
}

impl Stream {
    fn open(device: &Device, info: DeviceInfo) -> Result<Self, SourceError> {
        let mut client = device.get_iaudioclient().map_err(map_error)?;
        // 共有モードのミックス形式は必ず受け付けられる。チャンネルの変換は自分で行う
        let mix = client.get_mixformat().map_err(map_error)?;
        let is_float = mix.get_subformat().map_err(map_error)? == SampleType::Float;
        let kind = SampleKind::from_format(is_float, mix.get_bitspersample()).ok_or_else(|| {
            SourceError::Backend(format!(
                "unsupported mix format: float={is_float}, bits={}",
                mix.get_bitspersample()
            ))
        })?;
        let converter = StereoConverter::new(
            kind,
            mix.get_nchannels(),
            mix.get_blockalign() as usize,
            mix.get_dwchannelmask(),
        )
        .map_err(SourceError::Backend)?;

        // 出力デバイスのクライアントを Capture で初期化すると、ループバックになる
        client
            .initialize_client(
                &mix,
                &Direction::Capture,
                &StreamMode::EventsShared {
                    autoconvert: false,
                    buffer_duration_hns: BUFFER_DURATION_HNS,
                },
            )
            .map_err(map_error)?;
        let event = client.set_get_eventhandle().map_err(map_error)?;
        let capture = client.get_audiocaptureclient().map_err(map_error)?;
        let buffer_frames = client.get_buffer_size().map_err(map_error)? as usize;
        client.start_stream().map_err(map_error)?;

        Ok(Self {
            device: info,
            format: AudioFormat {
                sample_rate: mix.get_samplespersec(),
                channels: mix.get_nchannels(),
            },
            client,
            capture,
            event,
            raw: vec![0; buffer_frames * converter.frame_bytes()],
            converter,
        })
    }

    /// 届いているパケットをすべて読み、ステレオに変換して `out` に追記する
    fn read_available(&mut self, out: &mut Vec<f32>) -> Result<(), WasapiError> {
        loop {
            match self.capture.get_next_packet_size()? {
                Some(0) | None => return Ok(()),
                Some(_) => {}
            }
            let (frames, info) = self.capture.read_from_device(&mut self.raw)?;
            if frames == 0 {
                return Ok(());
            }
            let frames = frames as usize;
            if info.flags.silent {
                // SILENT のパケットは中身を無視して0として扱う決まり
                out.resize(out.len() + frames * 2, 0.0);
            } else {
                let bytes = frames * self.converter.frame_bytes();
                self.converter.convert(&self.raw[..bytes], out);
            }
        }
    }
}

impl Drop for Stream {
    fn drop(&mut self) {
        let _ = self.client.stop_stream();
    }
}

/// デバイスの変化の通知（OS のスレッドから立て、取得スレッドが読んで下ろす）
#[derive(Default)]
struct DeviceFlags {
    default_changed: AtomicBool,
    devices_changed: AtomicBool,
}

fn register_notifications(
    enumerator: &DeviceEnumerator,
    flags: &Arc<DeviceFlags>,
) -> Result<DeviceEventRegistration, WasapiError> {
    let mut callbacks = DeviceEventCallbacks::new();
    // コールバックは OS のスレッドから呼ばれるので、旗を立てるだけにする
    let f = Arc::clone(flags);
    callbacks.set_default_device_callback(move |direction, role, _| {
        if direction == Direction::Render && role == Role::Console {
            f.default_changed.store(true, Ordering::Release);
        }
    });
    let f = Arc::clone(flags);
    callbacks.set_device_state_callback(move |_, _| {
        f.devices_changed.store(true, Ordering::Release);
    });
    let f = Arc::clone(flags);
    callbacks.set_device_added_callback(move |_| {
        f.devices_changed.store(true, Ordering::Release);
    });
    enumerator.register_notification_callback(callbacks)
}

/// 取得スレッドの本体
fn capture_thread(
    device_id: Option<String>,
    sink: FrameSink,
    on_status: StatusSink,
    stop: &AtomicBool,
    ready: mpsc::Sender<Result<AudioFormat, SourceError>>,
) {
    let mut reporter = StatusReporter::new(on_status);
    let device_id = device_id.as_deref();

    let enumerator = match DeviceEnumerator::new() {
        Ok(enumerator) => enumerator,
        Err(e) => {
            let err = map_error(e);
            reporter.report_unavailable(err.reason(), None);
            let _ = ready.send(Err(err));
            return;
        }
    };
    let flags = Arc::new(DeviceFlags::default());
    // 登録に失敗しても、定期的な開き直しで補えるので続ける
    let _registration = register_notifications(&enumerator, &flags).ok();

    // 最初のオープン。失敗したら呼び出し元に返して終える（再試行は UI の「再試行」から）
    let first = resolve_device(&enumerator, device_id).and_then(|(device, info)| {
        reporter.report(SourceStatus::Opening, Some(&info));
        Stream::open(&device, info.clone()).map_err(|e| (e, Some(info)))
    });
    let stream = match first {
        Ok(stream) => stream,
        Err((err, info)) => {
            reporter.report_unavailable(err.reason(), info.as_ref());
            let _ = ready.send(Err(err));
            return;
        }
    };
    sink.reset(stream.format.sample_rate);
    let _ = ready.send(Ok(stream.format));
    reporter.report(SourceStatus::Live, Some(&stream.device));

    let mut capture = Capture {
        sink,
        detector: SilenceDetector::new(stream.format.sample_rate),
        stream: Some(stream),
        buffer: Vec::new(),
        last_write: Instant::now(),
        next_retry: Instant::now(),
    };
    while !stop.load(Ordering::Acquire) {
        if capture.stream.is_some() {
            capture.step_live(&enumerator, device_id, &flags, &mut reporter);
        } else {
            capture.step_unavailable(&enumerator, device_id, &flags, &mut reporter);
        }
    }
}

/// 取得スレッドの状態
struct Capture {
    sink: FrameSink,
    detector: SilenceDetector,
    stream: Option<Stream>,
    buffer: Vec<f32>,
    last_write: Instant,
    next_retry: Instant,
}

impl Capture {
    /// 開いている間の1回分：イベントを待ち、届いた分を書き込み、無音を判定する
    fn step_live(
        &mut self,
        enumerator: &DeviceEnumerator,
        device_id: Option<&str>,
        flags: &DeviceFlags,
        reporter: &mut StatusReporter,
    ) {
        let Some(stream) = self.stream.as_mut() else {
            return;
        };

        if device_id.is_none() && flags.default_changed.swap(false, Ordering::AcqRel) {
            let new_default = default_render_id(enumerator);
            if new_default.as_deref() != Some(stream.device.id.as_str()) {
                reporter.report(SourceStatus::Opening, Some(&stream.device));
                self.close_and_retry_now();
                return;
            }
        }

        // タイムアウトでも、届いている分がないか確かめる
        let _ = stream.event.wait_for_event(WAIT_MS);
        self.buffer.clear();
        if stream.read_available(&mut self.buffer).is_err() {
            reporter.report(
                SourceStatus::Unavailable {
                    reason: UnavailableReason::Disconnected,
                },
                Some(&stream.device),
            );
            self.stream = None;
            self.next_retry = Instant::now() + RETRY_INTERVAL;
            return;
        }

        let now = Instant::now();
        if !self.buffer.is_empty() {
            self.sink.push(&self.buffer);
            self.detector.feed(&self.buffer);
            self.last_write = now;
        } else {
            let gap = now.duration_since(self.last_write);
            if gap >= GAP_FILL_AFTER {
                let frames = gap_frames(gap, stream.format.sample_rate);
                self.buffer.resize(frames * 2, 0.0);
                self.sink.push(&self.buffer);
                self.detector.feed_quiet(frames as u64);
                self.last_write = now;
            }
        }
        reporter.report(self.detector.status(), Some(&stream.device));
    }

    /// 使えない間の1回分：時間が来たか、デバイスに変化があれば開き直す
    fn step_unavailable(
        &mut self,
        enumerator: &DeviceEnumerator,
        device_id: Option<&str>,
        flags: &DeviceFlags,
        reporter: &mut StatusReporter,
    ) {
        let devices_changed = flags.devices_changed.swap(false, Ordering::AcqRel);
        let default_changed = flags.default_changed.swap(false, Ordering::AcqRel);
        if Instant::now() < self.next_retry && !devices_changed && !default_changed {
            thread::sleep(Duration::from_millis(u64::from(WAIT_MS)));
            return;
        }

        let opened = resolve_device(enumerator, device_id).and_then(|(device, info)| {
            Stream::open(&device, info.clone()).map_err(|e| (e, Some(info)))
        });
        match opened {
            Ok(stream) => {
                self.sink.reset(stream.format.sample_rate);
                self.detector = SilenceDetector::new(stream.format.sample_rate);
                self.last_write = Instant::now();
                reporter.report(SourceStatus::Live, Some(&stream.device));
                self.stream = Some(stream);
            }
            Err((err, info)) => {
                reporter.report_unavailable(err.reason(), info.as_ref());
                self.next_retry = Instant::now() + RETRY_INTERVAL;
            }
        }
    }

    fn close_and_retry_now(&mut self) {
        self.stream = None;
        self.next_retry = Instant::now();
    }
}

/// 音が届かなかった時間に当たるフレーム数（上限つき）
fn gap_frames(gap: Duration, sample_rate: u32) -> usize {
    let gap = gap.min(GAP_FILL_MAX);
    (gap.as_secs_f64() * f64::from(sample_rate)).round() as usize
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio_source::frame_ring;
    use std::sync::Mutex;

    #[test]
    fn gap_frames_follow_the_rate_and_are_capped() {
        assert_eq!(gap_frames(Duration::from_millis(50), 48_000), 2_400);
        assert_eq!(gap_frames(Duration::from_secs(30), 48_000), 48_000);
    }

    #[test]
    fn hresults_map_to_reasons() {
        let err = |code: i32| {
            WasapiError::Windows(windows_core::Error::from_hresult(windows_core::HRESULT(
                code,
            )))
        };
        assert_eq!(
            map_error(err(E_NOTFOUND)).reason(),
            UnavailableReason::NotFound
        );
        assert_eq!(
            map_error(err(AUDCLNT_E_DEVICE_IN_USE)).reason(),
            UnavailableReason::InUse
        );
        assert_eq!(
            map_error(WasapiError::DeviceNotFound("x".into())).reason(),
            UnavailableReason::NotFound
        );
        assert_eq!(
            map_error(WasapiError::UnsupportedFormat).reason(),
            UnavailableReason::Other
        );
    }

    // 以下は実機の出力デバイスが必要なので、既定では実行しない。
    // `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored` で実行する

    #[test]
    #[ignore = "実機の出力デバイスが必要"]
    fn lists_output_devices_with_one_default() {
        let devices = WasapiLoopback::new().list_devices().unwrap();
        assert!(!devices.is_empty());
        assert_eq!(devices.iter().filter(|d| d.is_default).count(), 1);
    }

    #[test]
    #[ignore = "実機の出力デバイスが必要"]
    fn captures_from_the_default_device_and_stops() {
        let mut source = WasapiLoopback::new();
        let (sink, reader) = frame_ring(48_000 * 4);
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_in = Arc::clone(&seen);
        let on_status = StatusSink::new(move |e| seen_in.lock().unwrap().push(e));

        let format = source.start(None, sink, on_status).unwrap();
        assert!(format.sample_rate > 0);
        thread::sleep(Duration::from_millis(500));
        source.stop();

        let mut window = vec![0.0; 2 * 1024];
        let info = reader.copy_latest(&mut window);
        assert_eq!(info.sample_rate, format.sample_rate);
        // 再生していなくても、届かなかった時間が埋まっているので、およそ経過時間分のフレームがある
        let expected = u64::from(format.sample_rate) / 2;
        assert!(
            info.total_frames > expected / 2,
            "too few frames: {} (expected about {expected})",
            info.total_frames
        );

        let seen = seen.lock().unwrap();
        assert_eq!(seen[0].status, SourceStatus::Opening);
        assert_eq!(seen[1].status, SourceStatus::Live);
        assert!(
            seen.iter()
                .all(|e| e.device.as_ref().is_some_and(|d| d.is_default))
        );

        // 止めた後は書き込まれない
        let before = reader.copy_latest(&mut window).total_frames;
        thread::sleep(Duration::from_millis(100));
        assert_eq!(reader.copy_latest(&mut window).total_frames, before);
    }

    #[test]
    #[ignore = "実機の出力デバイスが必要"]
    fn unknown_device_id_is_reported_as_not_found() {
        let mut source = WasapiLoopback::new();
        let (sink, _reader) = frame_ring(1024);
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_in = Arc::clone(&seen);
        let on_status = StatusSink::new(move |e| seen_in.lock().unwrap().push(e.status));

        let err = source
            .start(Some("{0.0.0.00000000}.{no-such-device}"), sink, on_status)
            .unwrap_err();
        assert_eq!(err.reason(), UnavailableReason::NotFound);
        assert_eq!(
            *seen.lock().unwrap(),
            [SourceStatus::Unavailable {
                reason: UnavailableReason::NotFound
            }]
        );
    }
}
