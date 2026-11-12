//! App Nap の抑止（macOS。imple 3.6）
//!
//! `NSProcessInfo` の `beginActivityWithOptions:reason:` で「ユーザーが始めた活動」を始め、
//! 返された印を持っているあいだ、App Nap（裏に回ったアプリのタイマーや処理の間引き）を止める。
//! システムのスリープは止めない（`UserInitiatedAllowingIdleSystemSleep`）。
//! アプリは起動中ずっと [`UserActivity`] を持ち（`lib.rs` で `manage` する）、落とすと活動を終える。

use objc2::rc::Retained;
use objc2::runtime::{NSObjectProtocol, ProtocolObject};
use objc2_foundation::{NSActivityOptions, NSProcessInfo, NSString};

/// 活動の印。落とすと活動を終える
pub struct UserActivity {
    token: Retained<ProtocolObject<dyn NSObjectProtocol>>,
}

// SAFETY: 印は `NSProcessInfo` に返すだけの不透明なオブジェクトで、中身には触れない。
// `NSProcessInfo` はスレッドをまたいで使える（Apple のドキュメント「Thread Safety Summary」）。
unsafe impl Send for UserActivity {}
unsafe impl Sync for UserActivity {}

/// 活動の種類。App Nap を止め、システムのスリープは許す
pub const ACTIVITY_OPTIONS: NSActivityOptions = NSActivityOptions::UserInitiatedAllowingIdleSystemSleep;

/// 活動を始める。`reason` はシステムの診断（`pmset -g assertions` など）に出る説明
pub fn begin_user_activity(reason: &str) -> UserActivity {
    let info = NSProcessInfo::processInfo();
    let token = info.beginActivityWithOptions_reason(ACTIVITY_OPTIONS, &NSString::from_str(reason));
    UserActivity { token }
}

impl Drop for UserActivity {
    fn drop(&mut self) {
        // SAFETY: `token` は `beginActivityWithOptions:reason:` が返した印そのもの
        unsafe { NSProcessInfo::processInfo().endActivity(&self.token) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_stop_app_nap_but_allow_system_sleep() {
        assert!(ACTIVITY_OPTIONS.contains(NSActivityOptions::UserInitiatedAllowingIdleSystemSleep));
        assert!(!ACTIVITY_OPTIONS.contains(NSActivityOptions::IdleSystemSleepDisabled));
    }

    #[test]
    fn activity_can_be_begun_and_ended() {
        let activity = begin_user_activity("sonar_spectra test");
        drop(activity);
    }
}
