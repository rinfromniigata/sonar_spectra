//! Core Audio の Process Tap による入力源（macOS）
//!
//! 出力デバイスに流れている音を、自前で作った Process Tap と集約デバイス（`tap.rs`）で取り、
//! その集約デバイスを `cpal` の入力として開く。`cpal` 自身のループバックは使わない
//! （入力チャンネルを持つデバイスでは、ループバックではなくそのデバイスの入力を開くため。T12-1）。
//!
//! - 取得は専用のスレッドで行う。初回は OS の確認が出ているあいだ、タップやストリームの作成が
//!   答えるまで止まる（T12-1で4〜71秒）。`start` は `Opening` を通知してすぐに返し、エンジンの
//!   ロックを持ったまま待たない。`stop` も長く待たず、止まっているスレッドは切り離す
//!   （戻ってきたら後始末だけして終わる。止めた後の書き込みと通知は捨てる）
//! - タップは作成時のデバイスに固定され、既定の出力の変更は通知されない。一定の間隔で
//!   既定のデバイス・デバイスの一覧・標本化周波数を調べ、`watch::decide` に従って開き直す
//! - 録音の許可は判定しない。許可がないときも0のサンプルが来るだけで、無音（S01b）になる。
//!   許可した後も動いているストリームには0が来続けるため、無音が続くあいだは一定の間隔で作り直す
//! - 出力デバイスの今の形式で開き、出力デバイスの標本化周波数などは変えない

mod tap;

use std::sync::atomic::{AtomicBool, AtomicU8, AtomicU64, Ordering};
use std::sync::{Arc, mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{BufferSize, DeviceId, ErrorKind, HostId, SampleFormat, StreamConfig};

use self::tap::{AGGREGATE_UID_PREFIX, TapDevice};
use super::convert::{SampleKind, StereoConverter};
use super::state::{SilenceDetector, StatusReporter};
use super::watch::{self, Action, Observation, SilentRebuild, StallWatch, StreamFault};
use super::{
    AudioFormat, AudioSource, DeviceInfo, FrameSink, SourceError, SourceStatus, StatusSink,
};

/// 取得スレッドが状態を見る間隔
const POLL: Duration = Duration::from_millis(50);
/// 既定のデバイス・デバイスの一覧・標本化周波数を調べる間隔
const CHECK_INTERVAL: Duration = Duration::from_millis(500);
/// 使えない間に開き直しを試す間隔
const RETRY_INTERVAL: Duration = Duration::from_secs(1);
/// 無音が続くあいだに作り直す間隔
const SILENT_REBUILD_INTERVAL: Duration = Duration::from_secs(10);
/// コールバックがこの時間届かなければ、止まったとみなして開き直す
const STALL_AFTER: Duration = Duration::from_secs(2);
/// `stop` で取得スレッドの終わりを待つ最長の時間（OS の確認で止まっているときは切り離す）
const STOP_WAIT: Duration = Duration::from_millis(500);

/// Core Audio の Process Tap による入力源
#[derive(Default)]
pub struct CoreAudioTap {
    worker: Option<Worker>,
}

struct Worker {
    stop: Arc<AtomicBool>,
    /// スレッドが終わると切れる（`recv_timeout` で終わりを待つ）
    done: mpsc::Receiver<()>,
    thread: JoinHandle<()>,
}

impl CoreAudioTap {
    pub fn new() -> Self {
        Self::default()
    }
}

impl Drop for CoreAudioTap {
    fn drop(&mut self) {
        self.stop();
    }
}

impl AudioSource for CoreAudioTap {
    fn list_devices(&self) -> Result<Vec<DeviceInfo>, SourceError> {
        let host = cpal::default_host();
        let default_id = default_output_id(&host);
        Ok(output_devices(&host)?
            .into_iter()
            .map(|(_, info)| DeviceInfo {
                is_default: default_id.as_deref() == Some(info.id.as_str()),
                ..info
            })
            .collect())
    }

    fn start(
        &mut self,
        device_id: Option<&str>,
        sink: FrameSink,
        on_status: StatusSink,
    ) -> Result<AudioFormat, SourceError> {
        self.stop();

        let stop = Arc::new(AtomicBool::new(false));
        // 止めた後（切り離したスレッドから）の通知は捨てる
        let gate = Arc::clone(&stop);
        let mut reporter = StatusReporter::new(StatusSink::new(move |event| {
            if !gate.load(Ordering::Acquire) {
                on_status.emit(event.status, event.device);
            }
        }));

        // デバイスを決めて形式を調べるところまでは速いので、ここで行う（タップは作らない）
        let host = cpal::default_host();
        let (device, info) = match resolve(&host, device_id) {
            Ok(found) => found,
            Err((err, info)) => {
                reporter.report_unavailable(err.reason(), info.as_ref());
                return Err(err);
            }
        };
        let config = match device.default_output_config() {
            Ok(config) => config,
            Err(e) => {
                let err = map_error(&e);
                reporter.report_unavailable(err.reason(), Some(&info));
                return Err(err);
            }
        };
        let format = AudioFormat {
            sample_rate: config.sample_rate(),
            channels: config.channels(),
        };
        reporter.report(SourceStatus::Opening, Some(&info));

        let (done_tx, done) = mpsc::channel::<()>();
        let device_id = device_id.map(str::to_owned);
        let stop_in = Arc::clone(&stop);
        let thread = thread::Builder::new()
            .name("core-audio-tap".into())
            .spawn(move || {
                let _done = done_tx; // スレッドが終わると drop され、`done` が切れる
                capture_thread(device_id, info, sink, reporter, &stop_in);
            })
            .map_err(|e| SourceError::Backend(e.to_string()))?;
        self.worker = Some(Worker { stop, done, thread });
        Ok(format)
    }

    fn stop(&mut self) {
        if let Some(worker) = self.worker.take() {
            worker.stop.store(true, Ordering::Release);
            match worker.done.recv_timeout(STOP_WAIT) {
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    // OS の確認などで止まっている。戻ってきたら後始末して終わるので、切り離す
                }
                _ => {
                    let _ = worker.thread.join();
                }
            }
        }
    }
}

fn map_error(err: &cpal::Error) -> SourceError {
    let detail = err.to_string();
    match err.kind() {
        ErrorKind::DeviceNotAvailable => SourceError::NotFound(detail),
        ErrorKind::DeviceBusy => SourceError::InUse(detail),
        _ => SourceError::Backend(detail),
    }
}

/// ストリームのエラーのうち、開き直しの判定に使うもの。取りこぼし（Xrun）などは無視する
fn fault_of(kind: ErrorKind) -> Option<StreamFault> {
    match kind {
        ErrorKind::DeviceNotAvailable => Some(StreamFault::Disconnected),
        ErrorKind::StreamInvalidated => Some(StreamFault::Invalidated),
        ErrorKind::Xrun | ErrorKind::RealtimeDenied | ErrorKind::DeviceChanged => None,
        _ => Some(StreamFault::Other),
    }
}

fn device_uid(device: &cpal::Device) -> Option<String> {
    device.id().ok().map(|id| id.id().to_owned())
}

fn default_output_id(host: &cpal::Host) -> Option<String> {
    host.default_output_device().as_ref().and_then(device_uid)
}

/// 出力デバイスの一覧（自分の集約デバイスは除く）。`is_default` はここでは決めない
fn output_devices(host: &cpal::Host) -> Result<Vec<(cpal::Device, DeviceInfo)>, SourceError> {
    let devices = host.output_devices().map_err(|e| map_error(&e))?;
    Ok(devices
        .filter_map(|device| {
            let id = device_uid(&device)?;
            if id.starts_with(AGGREGATE_UID_PREFIX) {
                return None;
            }
            let name = device
                .description()
                .map(|d| d.name().to_owned())
                .unwrap_or_else(|_| id.clone());
            Some((
                device,
                DeviceInfo {
                    id,
                    name,
                    is_default: false,
                },
            ))
        })
        .collect())
}

/// 開くデバイスを決める
fn resolve(
    host: &cpal::Host,
    device_id: Option<&str>,
) -> Result<(cpal::Device, DeviceInfo), (SourceError, Option<DeviceInfo>)> {
    let default_id = default_output_id(host);
    let wanted = match device_id.map(str::to_owned).or(default_id.clone()) {
        Some(id) => id,
        None => {
            return Err((
                SourceError::NotFound("no default output device".into()),
                None,
            ));
        }
    };
    let (device, mut info) = output_devices(host)
        .map_err(|e| (e, None))?
        .into_iter()
        .find(|(_, info)| info.id == wanted)
        .ok_or_else(|| {
            (
                SourceError::NotFound(format!("no output device: {wanted}")),
                None,
            )
        })?;
    info.is_default = default_id.as_deref() == Some(info.id.as_str());
    Ok((device, info))
}

/// コールバックと取得スレッドで分け合う値
#[derive(Default)]
struct Shared {
    silent: AtomicBool,
    /// 受け取ったフレームの累計（止まっていないかの見張りに使う）
    frames: AtomicU64,
    /// `fault_code` の値。0は異常なし
    fault: AtomicU8,
}

fn fault_code(fault: StreamFault) -> u8 {
    match fault {
        StreamFault::Disconnected => 1,
        StreamFault::Invalidated => 2,
        StreamFault::Other => 3,
    }
}

impl Shared {
    fn take_fault(&self) -> Option<StreamFault> {
        match self.fault.swap(0, Ordering::AcqRel) {
            1 => Some(StreamFault::Disconnected),
            2 => Some(StreamFault::Invalidated),
            3 => Some(StreamFault::Other),
            _ => None,
        }
    }
}

/// 開いている取得。フィールドの順に drop され、ストリームを止めてから集約デバイスとタップを壊す
struct Opened {
    _stream: cpal::Stream,
    _tap: TapDevice,
    info: DeviceInfo,
    rate: u32,
    shared: Arc<Shared>,
}

/// タップと集約デバイスを作り、集約デバイスを出力デバイスの今の形式で開く
///
/// 初回は OS の確認が出ているあいだ、ここで止まる。
fn open(
    host: &cpal::Host,
    device: &cpal::Device,
    info: DeviceInfo,
    sink: &FrameSink,
    stop: &Arc<AtomicBool>,
    start_silent: bool,
) -> Result<Opened, SourceError> {
    let config = device.default_output_config().map_err(|e| map_error(&e))?;
    let rate = config.sample_rate();
    let channels = config.channels();
    // 集約デバイスの側で f32 に変換させ、チャンネルの畳み込みは共通の変換で行う
    // （配置は分からないので、先頭の2チャンネルを L・R とみなす。モノラルは両方に複製する）
    let converter = StereoConverter::new(
        SampleKind::F32,
        channels,
        usize::from(channels) * std::mem::size_of::<f32>(),
        0,
    )
    .map_err(SourceError::Backend)?;

    let tap = TapDevice::create(&info.id)?;
    let aggregate = host
        .device_by_id(&DeviceId::new(HostId::CoreAudio, &tap.aggregate_uid))
        .ok_or_else(|| SourceError::Backend("aggregate device not found".into()))?;

    let shared = Arc::new(Shared::default());
    shared.silent.store(start_silent, Ordering::Release);
    let mut detector = if start_silent {
        SilenceDetector::new_silent(rate)
    } else {
        SilenceDetector::new(rate)
    };
    let mut buffer = Vec::new();
    let (sink_in, stop_in, shared_in) = (sink.clone(), Arc::clone(stop), Arc::clone(&shared));
    let on_data = move |data: &cpal::Data, _: &cpal::InputCallbackInfo| {
        if stop_in.load(Ordering::Acquire) {
            return;
        }
        buffer.clear();
        converter.convert(data.bytes(), &mut buffer);
        sink_in.push(&buffer);
        detector.feed(&buffer);
        shared_in
            .silent
            .store(detector.status() == SourceStatus::Silent, Ordering::Release);
        shared_in
            .frames
            .fetch_add((buffer.len() / 2) as u64, Ordering::AcqRel);
    };
    let shared_err = Arc::clone(&shared);
    let on_error = move |err: cpal::Error| {
        if let Some(fault) = fault_of(err.kind()) {
            shared_err.fault.store(fault_code(fault), Ordering::Release);
        }
    };

    let stream_config = StreamConfig {
        channels,
        sample_rate: rate,
        buffer_size: BufferSize::Default,
    };
    let stream = aggregate
        .build_input_stream_raw(stream_config, SampleFormat::F32, on_data, on_error, None)
        .map_err(|e| map_error(&e))?;
    stream.play().map_err(|e| map_error(&e))?;

    Ok(Opened {
        _stream: stream,
        _tap: tap,
        info,
        rate,
        shared,
    })
}

/// 取得スレッドの状態
struct Capture<'a> {
    host: cpal::Host,
    device_id: Option<String>,
    sink: FrameSink,
    reporter: StatusReporter,
    stop: &'a Arc<AtomicBool>,
    opened: Option<Opened>,
    /// リングバッファに伝えた標本化周波数
    sink_rate: u32,
    next_check: Instant,
    next_retry: Instant,
    silent_rebuild: SilentRebuild,
    stall: StallWatch,
}

/// 取得スレッドの本体
fn capture_thread(
    device_id: Option<String>,
    info: DeviceInfo,
    sink: FrameSink,
    reporter: StatusReporter,
    stop: &Arc<AtomicBool>,
) {
    let host = cpal::default_host();
    let now = Instant::now();
    let mut capture = Capture {
        host,
        device_id,
        sink,
        reporter,
        stop,
        opened: None,
        sink_rate: 0,
        next_check: now,
        next_retry: now,
        silent_rebuild: SilentRebuild::new(SILENT_REBUILD_INTERVAL),
        stall: StallWatch::new(STALL_AFTER, now),
    };

    // 最初のオープン。失敗したら終える（再試行は UI の「再試行」から。Windows と同じ）
    let first = capture
        .resolve_again(&info)
        .and_then(|device| capture.open_device(&device, info.clone(), false));
    if capture.stopped() {
        return;
    }
    match first {
        Ok(opened) => capture.adopt(opened, SourceStatus::Live),
        Err(err) => {
            capture
                .reporter
                .report_unavailable(err.reason(), Some(&info));
            return;
        }
    }

    while !capture.stopped() {
        thread::sleep(POLL);
        if capture.opened.is_some() {
            capture.step_open();
        } else {
            capture.step_unavailable();
        }
    }
}

impl Capture<'_> {
    fn stopped(&self) -> bool {
        self.stop.load(Ordering::Acquire)
    }

    /// `start` で決めたデバイスを、このスレッドの `Host` で探し直す
    fn resolve_again(&self, info: &DeviceInfo) -> Result<cpal::Device, SourceError> {
        resolve(&self.host, Some(&info.id))
            .map(|(device, _)| device)
            .map_err(|(err, _)| err)
    }

    fn open_device(
        &self,
        device: &cpal::Device,
        info: DeviceInfo,
        start_silent: bool,
    ) -> Result<Opened, SourceError> {
        open(
            &self.host,
            device,
            info,
            &self.sink,
            self.stop,
            start_silent,
        )
    }

    /// 開いた取得を使い始める
    fn adopt(&mut self, opened: Opened, status: SourceStatus) {
        if self.stopped() {
            return; // 止めた後に開けたもの（drop で後始末する）
        }
        if opened.rate != self.sink_rate {
            self.sink.reset(opened.rate);
            self.sink_rate = opened.rate;
        }
        let now = Instant::now();
        self.reporter.report(status, Some(&opened.info));
        self.next_check = now + CHECK_INTERVAL;
        self.silent_rebuild = SilentRebuild::new(SILENT_REBUILD_INTERVAL);
        self.stall = StallWatch::new(STALL_AFTER, now);
        self.opened = Some(opened);
    }

    /// 開いている間の1回分：状態を通知し、時期が来たら様子を調べて開き直す
    fn step_open(&mut self) {
        let Some(opened) = self.opened.as_ref() else {
            return;
        };
        let status = if opened.shared.silent.load(Ordering::Acquire) {
            SourceStatus::Silent
        } else {
            SourceStatus::Live
        };
        self.reporter.report(status, Some(&opened.info));

        let now = Instant::now();
        let fault = opened.shared.take_fault();
        let stalled = self
            .stall
            .stalled(opened.shared.frames.load(Ordering::Acquire), now);
        if fault.is_some() || stalled || now >= self.next_check {
            self.next_check = now + CHECK_INTERVAL;
            let action = self.observe(opened, fault, stalled);
            self.act(action, status);
        } else if self.silent_rebuild.due(status, now) {
            self.reopen_same(true);
        }
    }

    fn observe(&self, opened: &Opened, fault: Option<StreamFault>, stalled: bool) -> Action {
        let default_id = default_output_id(&self.host);
        let present = output_devices(&self.host)
            .map(|devices| devices.into_iter().find(|(_, i)| i.id == opened.info.id))
            .ok()
            .flatten();
        let current_rate = present
            .as_ref()
            .and_then(|(device, _)| device.default_output_config().ok())
            .map(|config| config.sample_rate());
        watch::decide(&Observation {
            following_default: self.device_id.is_none(),
            opened_id: &opened.info.id,
            opened_rate: opened.rate,
            default_id: default_id.as_deref(),
            device_present: present.is_some(),
            current_rate,
            fault,
            stalled,
        })
    }

    fn act(&mut self, action: Action, status: SourceStatus) {
        match action {
            Action::Keep => {}
            Action::FollowDefault => {
                self.opened = None;
                match resolve(&self.host, None) {
                    Ok((device, info)) => {
                        self.reporter.report(SourceStatus::Opening, Some(&info));
                        match self.open_device(&device, info.clone(), false) {
                            Ok(opened) => self.adopt(opened, SourceStatus::Live),
                            Err(err) => self.lose(err.reason(), Some(info)),
                        }
                    }
                    Err((err, info)) => self.lose(err.reason(), info),
                }
            }
            Action::Reopen => self.reopen_same(status == SourceStatus::Silent),
            Action::Lost(reason) => {
                let info = self.opened.take().map(|opened| opened.info);
                self.lose(reason, info);
            }
        }
    }

    /// 同じデバイスを開き直す。状態の通知は変えない（無音のあいだの作り直しで表示を揺らさない）
    fn reopen_same(&mut self, start_silent: bool) {
        let Some(previous) = self.opened.take() else {
            return;
        };
        let info = previous.info.clone();
        let status = if start_silent {
            SourceStatus::Silent
        } else {
            SourceStatus::Live
        };
        drop(previous); // 先に後始末してから作り直す
        let reopened = self
            .resolve_again(&info)
            .and_then(|device| self.open_device(&device, info.clone(), start_silent));
        match reopened {
            Ok(opened) => self.adopt(opened, status),
            Err(err) => self.lose(err.reason(), Some(info)),
        }
    }

    fn lose(&mut self, reason: super::UnavailableReason, info: Option<DeviceInfo>) {
        self.opened = None;
        if !self.stopped() {
            self.reporter.report_unavailable(reason, info.as_ref());
        }
        self.next_retry = Instant::now() + RETRY_INTERVAL;
    }

    /// 使えない間の1回分：時間が来たら開き直す
    fn step_unavailable(&mut self) {
        if Instant::now() < self.next_retry {
            return;
        }
        let opened = resolve(&self.host, self.device_id.as_deref()).and_then(|(device, info)| {
            self.open_device(&device, info.clone(), false)
                .map_err(|err| (err, Some(info)))
        });
        match opened {
            Ok(opened) => self.adopt(opened, SourceStatus::Live),
            Err((err, info)) => self.lose(err.reason(), info),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio_source::frame_ring;
    use std::sync::Mutex;

    #[test]
    fn stream_errors_map_to_faults() {
        assert_eq!(
            fault_of(ErrorKind::DeviceNotAvailable),
            Some(StreamFault::Disconnected)
        );
        assert_eq!(
            fault_of(ErrorKind::StreamInvalidated),
            Some(StreamFault::Invalidated)
        );
        assert_eq!(fault_of(ErrorKind::Xrun), None);
        assert_eq!(fault_of(ErrorKind::BackendError), Some(StreamFault::Other));
        for fault in [
            StreamFault::Disconnected,
            StreamFault::Invalidated,
            StreamFault::Other,
        ] {
            let shared = Shared::default();
            shared.fault.store(fault_code(fault), Ordering::Release);
            assert_eq!(shared.take_fault(), Some(fault));
            assert_eq!(shared.take_fault(), None);
        }
    }

    #[test]
    fn errors_map_to_reasons() {
        use crate::audio_source::UnavailableReason;
        let reason = |kind: ErrorKind| map_error(&cpal::Error::from(kind)).reason();
        assert_eq!(
            reason(ErrorKind::DeviceNotAvailable),
            UnavailableReason::NotFound
        );
        assert_eq!(reason(ErrorKind::DeviceBusy), UnavailableReason::InUse);
        assert_eq!(reason(ErrorKind::BackendError), UnavailableReason::Other);
    }

    // 以下は実機の出力デバイスが必要なので、既定では実行しない。
    // `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored` で実行する。
    // タップを作ると、初回は OS の確認（システムオーディオ録音）が出ることがある

    #[test]
    #[ignore = "実機の出力デバイスが必要"]
    fn lists_output_devices_with_one_default() {
        let devices = CoreAudioTap::new().list_devices().unwrap();
        assert!(!devices.is_empty());
        assert_eq!(devices.iter().filter(|d| d.is_default).count(), 1);
        assert!(
            devices
                .iter()
                .all(|d| !d.id.starts_with(AGGREGATE_UID_PREFIX))
        );
    }

    #[test]
    #[ignore = "実機の出力デバイスが必要"]
    fn captures_from_the_default_device_and_stops() {
        let mut source = CoreAudioTap::new();
        let (sink, reader) = frame_ring(48_000 * 4);
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_in = Arc::clone(&seen);
        let on_status = StatusSink::new(move |e| seen_in.lock().unwrap().push(e));

        let format = source.start(None, sink, on_status).unwrap();
        assert!(format.sample_rate > 0);
        // 開くまで待つ（初回の確認が出ているときは、答えるまで）
        let deadline = Instant::now() + Duration::from_secs(90);
        while Instant::now() < deadline
            && !seen
                .lock()
                .unwrap()
                .iter()
                .any(|e| e.status != SourceStatus::Opening)
        {
            thread::sleep(Duration::from_millis(50));
        }
        thread::sleep(Duration::from_millis(500));
        source.stop();

        let seen = seen.lock().unwrap();
        assert_eq!(seen[0].status, SourceStatus::Opening);
        assert_eq!(seen[1].status, SourceStatus::Live, "events: {seen:?}");
        assert!(
            seen.iter()
                .all(|e| e.device.as_ref().is_some_and(|d| d.is_default))
        );

        let mut window = vec![0.0; 2 * 1024];
        let info = reader.copy_latest(&mut window);
        assert_eq!(info.sample_rate, format.sample_rate);
        assert!(info.total_frames > 0, "no frames arrived");

        // 止めた後は書き込まれない
        let before = reader.copy_latest(&mut window).total_frames;
        thread::sleep(Duration::from_millis(100));
        assert_eq!(reader.copy_latest(&mut window).total_frames, before);
    }

    #[test]
    #[ignore = "実機の出力デバイスが必要"]
    fn unknown_device_id_is_reported_as_not_found() {
        let mut source = CoreAudioTap::new();
        let (sink, _reader) = frame_ring(1024);
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_in = Arc::clone(&seen);
        let on_status = StatusSink::new(move |e| seen_in.lock().unwrap().push(e.status));

        let err = source
            .start(Some("no-such-device-uid"), sink, on_status)
            .unwrap_err();
        assert_eq!(
            err.reason(),
            crate::audio_source::UnavailableReason::NotFound
        );
        assert_eq!(
            *seen.lock().unwrap(),
            [SourceStatus::Unavailable {
                reason: crate::audio_source::UnavailableReason::NotFound
            }]
        );
    }
}
