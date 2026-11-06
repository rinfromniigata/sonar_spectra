//! 取得の状態：無音の判定と、状態の通知の重複を除く仕組み
//!
//! 取得方式によらない部分なので、OS の API から切り離して単体で確かめられるようにする。

use super::{DeviceInfo, SourceStatus, StatusSink, UnavailableReason};

/// 無音とみなす振幅（-70 dBFS）
pub const SILENCE_THRESHOLD: f32 = 3.162_277_7e-4;

/// しきい値以下がこの時間続いたら無音とみなす（曲間の短い無音で表示がちらつかないように）
pub const SILENCE_HOLD_SECONDS: f64 = 2.0;

/// 無音の判定。時間はフレーム数で数える（取得の遅れや詰まりに左右されないように）
#[derive(Debug, Clone)]
pub struct SilenceDetector {
    hold_frames: u64,
    quiet_frames: u64,
    silent: bool,
}

impl SilenceDetector {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            hold_frames: (f64::from(sample_rate) * SILENCE_HOLD_SECONDS).round() as u64,
            quiet_frames: 0,
            silent: false,
        }
    }

    /// ステレオ・インターリーブのフレームを受けて、判定を進める
    pub fn feed(&mut self, frames: &[f32]) {
        let loud = frames.iter().any(|s| s.abs() > SILENCE_THRESHOLD);
        if loud {
            self.quiet_frames = 0;
            self.silent = false;
        } else {
            self.feed_quiet((frames.len() / 2) as u64);
        }
    }

    /// 音が届かなかった時間を、無音のフレームとして数える
    pub fn feed_quiet(&mut self, frame_count: u64) {
        self.quiet_frames = self.quiet_frames.saturating_add(frame_count);
        if self.quiet_frames >= self.hold_frames {
            self.silent = true;
        }
    }

    /// 判定の結果を状態にする
    pub fn status(&self) -> SourceStatus {
        if self.silent {
            SourceStatus::Silent
        } else {
            SourceStatus::Live
        }
    }
}

/// 状態が変わったときだけ通知する
#[derive(Debug)]
pub struct StatusReporter {
    sink: StatusSink,
    last: Option<(SourceStatus, Option<DeviceInfo>)>,
}

impl StatusReporter {
    pub fn new(sink: StatusSink) -> Self {
        Self { sink, last: None }
    }

    /// 前回と状態・デバイスが同じなら何もしない
    pub fn report(&mut self, status: SourceStatus, device: Option<&DeviceInfo>) {
        if self
            .last
            .as_ref()
            .is_some_and(|(s, d)| *s == status && d.as_ref() == device)
        {
            return;
        }
        let device = device.cloned();
        self.sink.emit(status, device.clone());
        self.last = Some((status, device));
    }

    /// 開き直しに失敗したときの通知
    ///
    /// 切断の後の再試行で「見つからない」が返るのは当然なので、理由は「切断された」のまま保つ。
    pub fn report_unavailable(&mut self, reason: UnavailableReason, device: Option<&DeviceInfo>) {
        let reason = match (&self.last, reason) {
            (
                Some((
                    SourceStatus::Unavailable {
                        reason: UnavailableReason::Disconnected,
                    },
                    _,
                )),
                UnavailableReason::NotFound,
            ) => UnavailableReason::Disconnected,
            _ => reason,
        };
        self.report(SourceStatus::Unavailable { reason }, device);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn becomes_silent_only_after_the_hold_time() {
        let mut d = SilenceDetector::new(1_000); // 2秒 = 2,000フレーム
        assert_eq!(d.status(), SourceStatus::Live);

        d.feed(&[0.0; 2 * 1_999]);
        assert_eq!(d.status(), SourceStatus::Live);
        d.feed(&[1e-5, -1e-5]);
        assert_eq!(d.status(), SourceStatus::Silent);
    }

    #[test]
    fn sound_above_the_threshold_returns_to_live_at_once() {
        let mut d = SilenceDetector::new(1_000);
        d.feed_quiet(5_000);
        assert_eq!(d.status(), SourceStatus::Silent);

        d.feed(&[0.0, 0.01]);
        assert_eq!(d.status(), SourceStatus::Live);

        // 戻った後は、また保持時間を数え直す
        d.feed_quiet(1_999);
        assert_eq!(d.status(), SourceStatus::Live);
    }

    #[test]
    fn short_gaps_between_sounds_do_not_count_as_silence() {
        let mut d = SilenceDetector::new(1_000);
        for _ in 0..10 {
            d.feed(&[0.0; 2 * 1_500]);
            d.feed(&[0.5, 0.5]);
        }
        assert_eq!(d.status(), SourceStatus::Live);
    }

    fn recorder() -> (StatusReporter, Arc<Mutex<Vec<SourceStatus>>>) {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_in = Arc::clone(&seen);
        let sink = StatusSink::new(move |e| seen_in.lock().unwrap().push(e.status));
        (StatusReporter::new(sink), seen)
    }

    fn device(id: &str) -> DeviceInfo {
        DeviceInfo {
            id: id.into(),
            name: id.into(),
            is_default: true,
        }
    }

    #[test]
    fn reporter_skips_repeated_states() {
        let (mut r, seen) = recorder();
        let a = device("a");
        r.report(SourceStatus::Live, Some(&a));
        r.report(SourceStatus::Live, Some(&a));
        r.report(SourceStatus::Silent, Some(&a));
        r.report(SourceStatus::Silent, Some(&a));
        r.report(SourceStatus::Live, Some(&device("b"))); // デバイスが変われば通知する
        assert_eq!(
            *seen.lock().unwrap(),
            [SourceStatus::Live, SourceStatus::Silent, SourceStatus::Live]
        );
    }

    #[test]
    fn retries_after_a_disconnect_keep_the_disconnected_reason() {
        let (mut r, seen) = recorder();
        let a = device("a");
        r.report(
            SourceStatus::Unavailable {
                reason: UnavailableReason::Disconnected,
            },
            Some(&a),
        );
        r.report_unavailable(UnavailableReason::NotFound, None);
        r.report_unavailable(UnavailableReason::InUse, None);
        let disconnected = SourceStatus::Unavailable {
            reason: UnavailableReason::Disconnected,
        };
        assert_eq!(
            *seen.lock().unwrap(),
            [
                disconnected,
                disconnected, // デバイスが分からなくなった（None）ので通知はするが、理由は保つ
                SourceStatus::Unavailable {
                    reason: UnavailableReason::InUse
                },
            ]
        );
    }
}
