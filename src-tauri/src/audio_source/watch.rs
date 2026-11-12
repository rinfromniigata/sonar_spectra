//! 取得中のストリームの見張り：開き直すかどうかの判定
//!
//! macOS の Process Tap は作成時のデバイスに固定され、既定の出力の変更は通知されない。
//! 取得スレッドは一定の間隔でデバイスの様子を調べ、ここの判定に従って開き直す。
//! OS の API から切り離し、判定だけを単体で確かめられるようにする。

use std::time::{Duration, Instant};

use super::{SourceStatus, UnavailableReason};

/// ストリームの側から届いた異常（cpal のエラーのコールバック）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamFault {
    /// デバイスが切断された・無効にされた
    Disconnected,
    /// ストリームが使えなくなった（標本化周波数の変更など）。開き直せば続けられる
    Invalidated,
    /// 上記以外
    Other,
}

/// 開いているストリームについて、調べた結果
#[derive(Debug, Clone, Copy)]
pub struct Observation<'a> {
    /// 既定の出力デバイスに追従しているか（`device_id` が `None`）
    pub following_default: bool,
    /// 開いているデバイスの識別子
    pub opened_id: &'a str,
    /// 開いたときの標本化周波数
    pub opened_rate: u32,
    /// 今の既定の出力デバイスの識別子（ないときは `None`）
    pub default_id: Option<&'a str>,
    /// 開いているデバイスが、まだ出力デバイスの一覧にあるか
    pub device_present: bool,
    /// 開いているデバイスの今の標本化周波数（調べられなかったときは `None`）
    pub current_rate: Option<u32>,
    /// ストリームから届いた異常
    pub fault: Option<StreamFault>,
    /// コールバックが一定時間届いていないか
    pub stalled: bool,
}

/// 判定の結果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    /// そのまま続ける
    Keep,
    /// 新しい既定の出力デバイスを開き直す（`Opening` を通知する）
    FollowDefault,
    /// 同じデバイスを開き直す（状態の通知は変えない）
    Reopen,
    /// 使えなくなった。理由を通知し、一定の間隔で開き直しを試す
    Lost(UnavailableReason),
}

/// 開いているストリームをどうするかを決める
pub fn decide(o: &Observation<'_>) -> Action {
    let default_moved = o.following_default && o.default_id != Some(o.opened_id);
    let gone = !o.device_present || o.fault == Some(StreamFault::Disconnected);

    if default_moved {
        // 既定がなくなった（出力デバイスが1つもない）ときは、追従先がない
        return match o.default_id {
            Some(_) => Action::FollowDefault,
            None => Action::Lost(UnavailableReason::Disconnected),
        };
    }
    if gone {
        return Action::Lost(UnavailableReason::Disconnected);
    }
    let rate_changed = o.current_rate.is_some_and(|rate| rate != o.opened_rate);
    if rate_changed || o.stalled || o.fault.is_some() {
        return Action::Reopen;
    }
    Action::Keep
}

/// 無音のあいだの作り直しの判定
///
/// 録音の許可を後から与えても、動いているストリームには0が来続け、作り直せば取れる（T12-1）。
/// 無音（`Silent`）が `interval` 続くたびに、作り直しの時期を知らせる。
#[derive(Debug, Clone)]
pub struct SilentRebuild {
    interval: Duration,
    /// 無音が始まった時刻、または最後に作り直した時刻
    since: Option<Instant>,
}

impl SilentRebuild {
    pub fn new(interval: Duration) -> Self {
        Self {
            interval,
            since: None,
        }
    }

    /// 今の状態を受けて、作り直す時期なら `true` を返す（返したら数え直す）
    pub fn due(&mut self, status: SourceStatus, now: Instant) -> bool {
        if status != SourceStatus::Silent {
            self.since = None;
            return false;
        }
        match self.since {
            None => {
                self.since = Some(now);
                false
            }
            Some(since) if now.duration_since(since) >= self.interval => {
                self.since = Some(now);
                true
            }
            Some(_) => false,
        }
    }
}

/// コールバックが届いているかの見張り
#[derive(Debug, Clone)]
pub struct StallWatch {
    after: Duration,
    last_count: u64,
    last_progress: Instant,
}

impl StallWatch {
    pub fn new(after: Duration, now: Instant) -> Self {
        Self {
            after,
            last_count: 0,
            last_progress: now,
        }
    }

    /// 受け取ったフレームの累計を受けて、`after` のあいだ増えていなければ `true` を返す
    pub fn stalled(&mut self, count: u64, now: Instant) -> bool {
        if count != self.last_count {
            self.last_count = count;
            self.last_progress = now;
            return false;
        }
        now.duration_since(self.last_progress) >= self.after
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn steady<'a>() -> Observation<'a> {
        Observation {
            following_default: true,
            opened_id: "speakers",
            opened_rate: 48_000,
            default_id: Some("speakers"),
            device_present: true,
            current_rate: Some(48_000),
            fault: None,
            stalled: false,
        }
    }

    #[test]
    fn nothing_changed_keeps_the_stream() {
        assert_eq!(decide(&steady()), Action::Keep);
        // 調べられなかった値は、変わったとはみなさない
        let unknown_rate = Observation {
            current_rate: None,
            ..steady()
        };
        assert_eq!(decide(&unknown_rate), Action::Keep);
    }

    #[test]
    fn follows_a_new_default_only_when_following() {
        let moved = Observation {
            default_id: Some("headphones"),
            ..steady()
        };
        assert_eq!(decide(&moved), Action::FollowDefault);

        let pinned = Observation {
            following_default: false,
            ..moved
        };
        assert_eq!(decide(&pinned), Action::Keep);
    }

    #[test]
    fn a_disconnected_default_follows_the_next_default() {
        // 既定のデバイスを抜くと、OS が別のデバイスを既定にする
        let unplugged = Observation {
            default_id: Some("speakers-2"),
            device_present: false,
            fault: Some(StreamFault::Disconnected),
            ..steady()
        };
        assert_eq!(decide(&unplugged), Action::FollowDefault);

        let no_output_left = Observation {
            default_id: None,
            device_present: false,
            ..steady()
        };
        assert_eq!(
            decide(&no_output_left),
            Action::Lost(UnavailableReason::Disconnected)
        );
    }

    #[test]
    fn a_disconnected_chosen_device_is_lost() {
        let chosen = Observation {
            following_default: false,
            ..steady()
        };
        let removed = Observation {
            device_present: false,
            ..chosen
        };
        assert_eq!(
            decide(&removed),
            Action::Lost(UnavailableReason::Disconnected)
        );
        let reported = Observation {
            fault: Some(StreamFault::Disconnected),
            ..chosen
        };
        assert_eq!(
            decide(&reported),
            Action::Lost(UnavailableReason::Disconnected)
        );
    }

    #[test]
    fn rate_changes_stalls_and_invalidation_reopen_the_same_device() {
        let rate = Observation {
            current_rate: Some(44_100),
            ..steady()
        };
        assert_eq!(decide(&rate), Action::Reopen);
        let invalidated = Observation {
            fault: Some(StreamFault::Invalidated),
            ..steady()
        };
        assert_eq!(decide(&invalidated), Action::Reopen);
        let other = Observation {
            fault: Some(StreamFault::Other),
            ..steady()
        };
        assert_eq!(decide(&other), Action::Reopen);
        let stalled = Observation {
            stalled: true,
            ..steady()
        };
        assert_eq!(decide(&stalled), Action::Reopen);
    }

    #[test]
    fn silent_rebuild_fires_every_interval_while_silent() {
        let start = Instant::now();
        let at = |s: u64| start + Duration::from_secs(s);
        let mut r = SilentRebuild::new(Duration::from_secs(10));

        assert!(!r.due(SourceStatus::Live, at(0)));
        assert!(!r.due(SourceStatus::Silent, at(1))); // 無音の始まり
        assert!(!r.due(SourceStatus::Silent, at(10)));
        assert!(r.due(SourceStatus::Silent, at(11)));
        // 作り直した後は、そこから数え直す
        assert!(!r.due(SourceStatus::Silent, at(20)));
        assert!(r.due(SourceStatus::Silent, at(21)));
    }

    #[test]
    fn silent_rebuild_restarts_when_sound_returns() {
        let start = Instant::now();
        let at = |s: u64| start + Duration::from_secs(s);
        let mut r = SilentRebuild::new(Duration::from_secs(10));

        assert!(!r.due(SourceStatus::Silent, at(0)));
        assert!(!r.due(SourceStatus::Live, at(5)));
        assert!(!r.due(SourceStatus::Silent, at(6)));
        assert!(!r.due(SourceStatus::Silent, at(15)));
        assert!(r.due(SourceStatus::Silent, at(16)));
        // 使えない・開いている途中は無音ではない
        assert!(!r.due(SourceStatus::Opening, at(30)));
        assert!(!r.due(SourceStatus::Silent, at(31)));
    }

    #[test]
    fn stall_watch_reports_only_when_frames_stop() {
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        let mut w = StallWatch::new(Duration::from_secs(2), at(0));

        assert!(!w.stalled(0, at(1_000)));
        assert!(!w.stalled(480, at(1_500)));
        assert!(!w.stalled(480, at(3_000)));
        assert!(w.stalled(480, at(3_500)));
        assert!(!w.stalled(960, at(3_600)));
    }
}
