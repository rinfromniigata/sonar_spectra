//! 入力源（audio_source）
//!
//! 音声のフレームを出す共通のインターフェース。解析・送出はこのモジュールの型だけを知り、
//! 取得方式（初版は WASAPI のループバック）の違いは `AudioSource` の実装に閉じ込める。
//! Mac の取得方式や入力デバイスは、`AudioSource` の実装を足すだけで済むようにする。

mod ring_buffer;

use std::fmt;
use std::sync::Arc;

use serde::Serialize;

pub use ring_buffer::{DEFAULT_RING_FRAMES, FrameReader, FrameSink, WindowInfo, frame_ring};

/// 出力デバイスの情報（出力系統のチップと、デバイスの選択肢に使う）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// 取得方式ごとの識別子。保存して次回の起動で同じデバイスを選ぶのに使う
    pub id: String,
    /// 利用者に見せるデバイス名
    pub name: String,
    /// OS の既定の出力デバイスかどうか
    pub is_default: bool,
}

/// 入力源の状態（S01b〜S01d の表示に使う）
///
/// 取得中であること（`Live`）と、取得しているが音が来ていないこと（`Silent`）を区別する。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
pub enum SourceStatus {
    /// 起動中・切り替え中（S01d）
    Opening,
    /// 取得中で、音が来ている
    Live,
    /// 取得中だが、一定時間しきい値以下（S01b）
    Silent,
    /// 入力源が使えない（S01c）
    Unavailable { reason: UnavailableReason },
}

/// 入力源が使えない理由
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UnavailableReason {
    /// 指定のデバイス（または既定の出力デバイス）が見つからない
    NotFound,
    /// 取得中にデバイスが切断された・無効にされた
    Disconnected,
    /// ほかのアプリが排他的に使っている
    InUse,
    /// 上記以外
    Other,
}

/// 状態の通知。イベント `source-status` の中身になる
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEvent {
    pub status: SourceStatus,
    /// 対象のデバイス。デバイスが決まっていない（見つからない等）ときは `None`
    pub device: Option<DeviceInfo>,
}

/// 取得するデバイスの形式
///
/// `channels` はデバイス本来のチャンネル数。`FrameSink` に渡すフレームは、
/// チャンネル数によらず常にステレオ・f32・インターリーブに揃える。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AudioFormat {
    pub sample_rate: u32,
    pub channels: u16,
}

/// 入力源の操作の失敗
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SourceError {
    /// デバイスが見つからない
    NotFound(String),
    /// ほかのアプリが排他的に使っている
    InUse(String),
    /// 取得方式（OS の API）の失敗
    Backend(String),
}

impl SourceError {
    /// 状態の表示に使う、使えない理由への対応
    pub fn reason(&self) -> UnavailableReason {
        match self {
            Self::NotFound(_) => UnavailableReason::NotFound,
            Self::InUse(_) => UnavailableReason::InUse,
            Self::Backend(_) => UnavailableReason::Other,
        }
    }
}

impl fmt::Display for SourceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(detail) => write!(f, "audio device not found: {detail}"),
            Self::InUse(detail) => write!(f, "audio device in use: {detail}"),
            Self::Backend(detail) => write!(f, "audio backend error: {detail}"),
        }
    }
}

impl std::error::Error for SourceError {}

/// 状態の通知先。取得スレッドから呼ばれるため `Send + Sync` を求める
#[derive(Clone)]
pub struct StatusSink(Arc<dyn Fn(StatusEvent) + Send + Sync>);

impl StatusSink {
    pub fn new(callback: impl Fn(StatusEvent) + Send + Sync + 'static) -> Self {
        Self(Arc::new(callback))
    }

    pub fn emit(&self, status: SourceStatus, device: Option<DeviceInfo>) {
        (self.0)(StatusEvent { status, device });
    }
}

impl fmt::Debug for StatusSink {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("StatusSink")
    }
}

/// 音声のフレームを出す入力源
pub trait AudioSource: Send {
    /// 取得できる出力デバイスの一覧
    fn list_devices(&self) -> Result<Vec<DeviceInfo>, SourceError>;

    /// 取得を始める。`device_id` が `None` なら既定の出力デバイス。
    ///
    /// `sink` にはステレオ・f32・インターリーブのフレームを渡す。デバイスを開き直して
    /// サンプルレートが変わるときは、`FrameSink::reset` で新しいサンプルレートを伝える。
    /// 状態の変化（開き直し・無音・切断を含む）は `on_status` に通知する。
    /// 戻り値は、開いたデバイスの形式。
    fn start(
        &mut self,
        device_id: Option<&str>,
        sink: FrameSink,
        on_status: StatusSink,
    ) -> Result<AudioFormat, SourceError>;

    /// 取得を止める。止めていないときに呼んでもよい
    fn stop(&mut self);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// インターフェースの形を確かめるための、決まったフレームを書くだけの入力源
    struct FakeSource {
        running: bool,
    }

    impl AudioSource for FakeSource {
        fn list_devices(&self) -> Result<Vec<DeviceInfo>, SourceError> {
            Ok(vec![DeviceInfo {
                id: "fake".into(),
                name: "Fake Output".into(),
                is_default: true,
            }])
        }

        fn start(
            &mut self,
            device_id: Option<&str>,
            sink: FrameSink,
            on_status: StatusSink,
        ) -> Result<AudioFormat, SourceError> {
            let device = match device_id {
                None | Some("fake") => self.list_devices()?.remove(0),
                Some(other) => return Err(SourceError::NotFound(other.into())),
            };
            on_status.emit(SourceStatus::Opening, Some(device.clone()));
            sink.reset(48_000);
            sink.push(&[0.5, -0.5, 0.25, -0.25]);
            self.running = true;
            on_status.emit(SourceStatus::Live, Some(device));
            Ok(AudioFormat {
                sample_rate: 48_000,
                channels: 2,
            })
        }

        fn stop(&mut self) {
            self.running = false;
        }
    }

    #[test]
    fn trait_is_object_safe_and_delivers_frames_and_status() {
        let mut source: Box<dyn AudioSource> = Box::new(FakeSource { running: false });
        let (sink, reader) = frame_ring(16);
        let events = Arc::new(Mutex::new(Vec::new()));
        let events_in = Arc::clone(&events);
        let on_status = StatusSink::new(move |e| events_in.lock().unwrap().push(e.status));

        let format = source.start(None, sink, on_status).unwrap();
        assert_eq!(format.sample_rate, 48_000);

        let mut window = [9.0; 4];
        let info = reader.copy_latest(&mut window);
        assert_eq!(window, [0.5, -0.5, 0.25, -0.25]);
        assert_eq!(info.sample_rate, 48_000);
        assert_eq!(
            *events.lock().unwrap(),
            vec![SourceStatus::Opening, SourceStatus::Live]
        );

        source.stop();
        source.stop(); // 止めていないときに呼んでもよい
    }

    #[test]
    fn start_reports_missing_device_as_not_found() {
        let mut source = FakeSource { running: false };
        let (sink, _reader) = frame_ring(16);
        let err = source
            .start(Some("missing"), sink, StatusSink::new(|_| {}))
            .unwrap_err();
        assert_eq!(err.reason(), UnavailableReason::NotFound);
        assert!(!source.running);
    }

    #[test]
    fn status_event_serializes_for_the_ui() {
        let event = StatusEvent {
            status: SourceStatus::Unavailable {
                reason: UnavailableReason::Disconnected,
            },
            device: Some(DeviceInfo {
                id: "id-1".into(),
                name: "Speakers".into(),
                is_default: true,
            }),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "status": { "state": "unavailable", "reason": "disconnected" },
                "device": { "id": "id-1", "name": "Speakers", "isDefault": true }
            })
        );
        let live = serde_json::to_value(SourceStatus::Live).unwrap();
        assert_eq!(live, serde_json::json!({ "state": "live" }));
    }
}
