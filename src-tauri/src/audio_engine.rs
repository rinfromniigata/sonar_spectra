//! 取得・解析・送出の組み立て
//!
//! 入力源・リングバッファ・送出をまとめて持ち、UI からのコマンド（`commands.rs`）を受ける。
//! コマンドは薄い入口にとどめ、状態と手順はここに置く（入力源と送り先を差し替えて確かめられるように）。
//!
//! - リングバッファは起動から終了まで1つ。入力源を切り替えても、送出は同じ読み出し口から読み続ける
//! - 入力源の状態は、変わるたびにイベント `source-status` で UI に知らせ、最後の状態を覚えておく。
//!   `start_stream` が呼び直されたとき（ページの再読み込み）は、最後の状態を送り直す
//! - UI は、`source-status` を listen してから `start_stream` を呼ぶ（起動直後の `Opening` を取りこぼさないため）

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use crate::analysis::Pipeline;
use crate::audio_source::{
    AudioSource, DEFAULT_RING_FRAMES, DeviceInfo, FrameReader, FrameSink, SourceError, StatusEvent,
    StatusSink, frame_ring,
};
use crate::frame_transport::FrameTransport;

/// 入力源の状態を UI に知らせるイベントの名前
pub const SOURCE_STATUS_EVENT: &str = "source-status";

type Emit = dyn Fn(&StatusEvent) + Send + Sync;

/// 状態の通知と、最後の状態の記憶
///
/// 取得スレッドからも呼ばれる。エンジン本体のロックとは別にし、エンジンが入力源の開始を
/// 待っている間に取得スレッドが通知しても、互いに待ち合わない。
#[derive(Clone)]
struct StatusHub {
    last: Arc<Mutex<Option<StatusEvent>>>,
    emit: Arc<Emit>,
}

impl StatusHub {
    fn lock(&self) -> MutexGuard<'_, Option<StatusEvent>> {
        self.last.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn sink(&self) -> StatusSink {
        let hub = self.clone();
        StatusSink::new(move |event| {
            // 記憶と通知を同じロックの中で行い、送り直しと順序が入れ替わらないようにする
            let mut last = hub.lock();
            (hub.emit)(&event);
            *last = Some(event);
        })
    }

    fn reemit(&self) {
        let last = self.lock();
        if let Some(event) = last.as_ref() {
            (self.emit)(event);
        }
    }

    fn last(&self) -> Option<StatusEvent> {
        self.lock().clone()
    }
}

/// 取得・解析・送出の組み立て
pub struct AudioEngine {
    source: Box<dyn AudioSource>,
    sink: FrameSink,
    reader: FrameReader,
    transport: Option<FrameTransport>,
    status: StatusHub,
    /// 選んでいる出力デバイス。`None` は既定の出力デバイスに追従する
    device_id: Option<String>,
    source_started: bool,
    paused: bool,
    active_sections: Option<Vec<u8>>,
}

impl AudioEngine {
    /// `emit` は状態が変わるたびに呼ばれる（取得スレッドから呼ばれることもある）
    pub fn new(
        source: Box<dyn AudioSource>,
        emit: impl Fn(&StatusEvent) + Send + Sync + 'static,
    ) -> Self {
        let (sink, reader) = frame_ring(DEFAULT_RING_FRAMES);
        Self {
            source,
            sink,
            reader,
            transport: None,
            status: StatusHub {
                last: Arc::new(Mutex::new(None)),
                emit: Arc::new(emit),
            },
            device_id: None,
            source_started: false,
            paused: false,
            active_sections: None,
        }
    }

    /// 送出を `output` へ向けて始める。入力源がまだなら開始する
    ///
    /// 呼び直されたら（ページの再読み込み）、送出を新しい `output` に付け替え、
    /// 入力源はそのままにして最後の状態を送り直す。
    pub fn start_stream(&mut self, output: impl FnMut(Vec<u8>) + Send + 'static) {
        // 古い送出を先に止める（同じ読み出し口を2つのスレッドが読まないように）
        self.transport = None;
        let transport = FrameTransport::start(self.reader.clone(), Pipeline::default(), output);
        if let Some(ids) = &self.active_sections {
            transport.set_active_sections(ids.clone());
        }
        transport.set_paused(self.paused);
        self.transport = Some(transport);

        if self.source_started {
            self.status.reemit();
        } else {
            self.start_source();
        }
    }

    /// 選べる出力デバイスの一覧
    pub fn list_output_devices(&self) -> Result<Vec<DeviceInfo>, SourceError> {
        self.source.list_devices()
    }

    /// 入力源を切り替える。`None` は既定の出力デバイスに追従する
    ///
    /// 結果（`Opening` → `Live`、または `Unavailable`）は `source-status` で届く。
    pub fn select_output_device(&mut self, device_id: Option<String>) {
        self.device_id = device_id;
        self.restart_source();
    }

    /// 入力源を開き直す（S01c の「再試行」）
    pub fn retry_source(&mut self) {
        self.restart_source();
    }

    /// 解析と送出を止める・再開する（ウィンドウの最小化）。取得は続ける
    pub fn set_render_paused(&mut self, paused: bool) {
        self.paused = paused;
        if let Some(transport) = &self.transport {
            transport.set_paused(paused);
        }
    }

    /// 有効にするセクションを指定する（`analysis::SectionId` の値の一覧）。送出を始め直しても引き継ぐ
    pub fn set_active_sections(&mut self, ids: Vec<u8>) {
        if let Some(transport) = &self.transport {
            transport.set_active_sections(ids.clone());
        }
        self.active_sections = Some(ids);
    }

    /// 最後に通知した状態
    pub fn last_status(&self) -> Option<StatusEvent> {
        self.status.last()
    }

    /// 選んでいる出力デバイス
    pub fn device_id(&self) -> Option<&str> {
        self.device_id.as_deref()
    }

    fn restart_source(&mut self) {
        self.source.stop();
        self.start_source();
    }

    fn start_source(&mut self) {
        // 失敗は入力源が `Unavailable` として通知する。再試行は UI の「再試行」から行う
        let _ = self.source.start(
            self.device_id.as_deref(),
            self.sink.clone(),
            self.status.sink(),
        );
        self.source_started = true;
    }
}

impl Drop for AudioEngine {
    fn drop(&mut self) {
        self.transport = None;
        self.source.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::SectionId;
    use crate::audio_source::{AudioFormat, SourceStatus, UnavailableReason};
    use crate::frame_transport::format::decode;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    /// 呼ばれ方を記録する入力源。"missing" は見つからないデバイスとして扱う
    #[derive(Clone, Default)]
    struct Calls(Arc<Mutex<Vec<String>>>);

    impl Calls {
        fn push(&self, call: String) {
            self.0.lock().unwrap().push(call);
        }
        fn take(&self) -> Vec<String> {
            std::mem::take(&mut *self.0.lock().unwrap())
        }
    }

    struct FakeSource {
        calls: Calls,
    }

    fn device(id: &str) -> DeviceInfo {
        DeviceInfo {
            id: id.into(),
            name: format!("Device {id}"),
            is_default: id == "default",
        }
    }

    impl AudioSource for FakeSource {
        fn list_devices(&self) -> Result<Vec<DeviceInfo>, SourceError> {
            Ok(vec![device("default"), device("usb")])
        }

        fn start(
            &mut self,
            device_id: Option<&str>,
            sink: FrameSink,
            on_status: StatusSink,
        ) -> Result<AudioFormat, SourceError> {
            let id = device_id.unwrap_or("default");
            self.calls.push(format!("start {id}"));
            if id == "missing" {
                on_status.emit(
                    SourceStatus::Unavailable {
                        reason: UnavailableReason::NotFound,
                    },
                    None,
                );
                return Err(SourceError::NotFound(id.into()));
            }
            on_status.emit(SourceStatus::Opening, Some(device(id)));
            sink.reset(48_000);
            sink.push(&vec![0.25; 4_800 * 2]);
            on_status.emit(SourceStatus::Live, Some(device(id)));
            Ok(AudioFormat {
                sample_rate: 48_000,
                channels: 2,
            })
        }

        fn stop(&mut self) {
            self.calls.push("stop".into());
        }
    }

    struct Harness {
        engine: AudioEngine,
        calls: Calls,
        events: Arc<Mutex<Vec<StatusEvent>>>,
    }

    impl Harness {
        fn new() -> Self {
            let calls = Calls::default();
            let events = Arc::new(Mutex::new(Vec::new()));
            let events_in = Arc::clone(&events);
            let engine = AudioEngine::new(
                Box::new(FakeSource {
                    calls: calls.clone(),
                }),
                move |e| events_in.lock().unwrap().push(e.clone()),
            );
            Self {
                engine,
                calls,
                events,
            }
        }

        fn statuses(&self) -> Vec<SourceStatus> {
            std::mem::take(&mut *self.events.lock().unwrap())
                .into_iter()
                .map(|e| e.status)
                .collect()
        }
    }

    fn collecting_output() -> (
        impl FnMut(Vec<u8>) + Send + 'static,
        mpsc::Receiver<Vec<u8>>,
    ) {
        let (tx, rx) = mpsc::channel();
        (
            move |bytes| {
                let _ = tx.send(bytes);
            },
            rx,
        )
    }

    #[test]
    fn start_stream_starts_the_source_once_and_sends_frames() {
        let mut h = Harness::new();
        let (output, rx) = collecting_output();
        h.engine.start_stream(output);

        assert_eq!(h.calls.take(), ["start default"]);
        assert_eq!(h.statuses(), [SourceStatus::Opening, SourceStatus::Live]);

        let bytes = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        let frame = decode(&bytes).unwrap();
        assert_eq!(frame.header.sample_rate, 48_000);
        assert!(!frame.sections.is_empty());
    }

    #[test]
    fn restarting_the_stream_moves_output_and_reemits_the_last_status() {
        let mut h = Harness::new();
        let (first, first_rx) = collecting_output();
        h.engine.start_stream(first);
        h.statuses();

        let (second, second_rx) = collecting_output();
        h.engine.start_stream(second);
        // 入力源は開き直さず、最後の状態だけを送り直す
        assert_eq!(h.calls.take(), ["start default"]);
        assert_eq!(h.statuses(), [SourceStatus::Live]);

        assert!(second_rx.recv_timeout(Duration::from_secs(1)).is_ok());
        // 古い送り先には、もう届かない
        let _ = first_rx.try_iter().count();
        thread::sleep(Duration::from_millis(60));
        assert_eq!(first_rx.try_iter().count(), 0);
    }

    #[test]
    fn selecting_a_device_restarts_the_source_with_it() {
        let mut h = Harness::new();
        let (output, _rx) = collecting_output();
        h.engine.start_stream(output);
        h.calls.take();
        h.statuses();

        h.engine.select_output_device(Some("usb".into()));
        assert_eq!(h.calls.take(), ["stop", "start usb"]);
        assert_eq!(h.engine.device_id(), Some("usb"));
        let last = h.engine.last_status().unwrap();
        assert_eq!(last.status, SourceStatus::Live);
        assert_eq!(last.device.unwrap().id, "usb");

        h.engine.select_output_device(None);
        assert_eq!(h.calls.take(), ["stop", "start default"]);
    }

    #[test]
    fn missing_device_is_reported_and_retry_reopens_it() {
        let mut h = Harness::new();
        h.engine.select_output_device(Some("missing".into()));
        assert_eq!(
            h.statuses(),
            [SourceStatus::Unavailable {
                reason: UnavailableReason::NotFound
            }]
        );

        h.engine.retry_source();
        assert_eq!(
            h.calls.take(),
            ["stop", "start missing", "stop", "start missing"]
        );

        // 送出を始めると、入力源は開き直さずに最後の状態（使えない）を送り直す
        let (output, _rx) = collecting_output();
        h.engine.start_stream(output);
        assert!(h.calls.take().is_empty());
        assert_eq!(
            h.statuses().last(),
            Some(&SourceStatus::Unavailable {
                reason: UnavailableReason::NotFound
            })
        );
    }

    #[test]
    fn list_comes_from_the_source() {
        let h = Harness::new();
        let ids: Vec<String> = h
            .engine
            .list_output_devices()
            .unwrap()
            .into_iter()
            .map(|d| d.id)
            .collect();
        assert_eq!(ids, ["default", "usb"]);
    }

    #[test]
    fn pause_and_sections_are_kept_across_stream_restarts() {
        let mut h = Harness::new();
        h.engine.set_render_paused(true);
        h.engine.set_active_sections(vec![SectionId::Level.as_u8()]);

        let (output, rx) = collecting_output();
        h.engine.start_stream(output);
        thread::sleep(Duration::from_millis(80));
        assert_eq!(rx.try_iter().count(), 0, "paused stream must not send");

        h.engine.set_render_paused(false);
        let bytes = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        let ids: Vec<u8> = decode(&bytes)
            .unwrap()
            .sections
            .iter()
            .map(|(id, _)| *id)
            .collect();
        assert_eq!(ids, [SectionId::Level.as_u8()]);
    }

    // 実機の出力デバイスが必要なので、既定では実行しない（`-- --ignored` で実行する）
    #[cfg(windows)]
    #[test]
    #[ignore = "実機の出力デバイスが必要"]
    fn real_source_streams_frames_through_the_engine() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let events_in = Arc::clone(&events);
        let mut engine = AudioEngine::new(crate::audio_source::default_source(), move |e| {
            events_in.lock().unwrap().push(e.status)
        });
        let (output, rx) = collecting_output();
        engine.start_stream(output);
        thread::sleep(Duration::from_millis(300));

        let frames: Vec<_> = rx.try_iter().map(|b| decode(&b).unwrap()).collect();
        assert!(frames.len() >= 10, "only {} frames", frames.len());
        let last = frames.last().unwrap();
        assert!(last.header.sample_rate > 0);
        let ids: Vec<u8> = last.sections.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids, [SectionId::Level.as_u8(), SectionId::Waveform.as_u8()]);
        assert_eq!(
            events.lock().unwrap()[..2],
            [SourceStatus::Opening, SourceStatus::Live]
        );

        let devices = engine.list_output_devices().unwrap();
        let default = devices.iter().find(|d| d.is_default).unwrap().id.clone();
        engine.select_output_device(Some(default.clone()));
        assert_eq!(engine.last_status().unwrap().device.unwrap().id, default);
    }

    #[test]
    fn dropping_the_engine_stops_the_source() {
        let h = Harness::new();
        let calls = h.calls.clone();
        drop(h);
        assert_eq!(calls.take(), ["stop"]);
    }
}
