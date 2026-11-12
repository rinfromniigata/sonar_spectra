//! ウィンドウとOSの差（imple 3.6）
//!
//! - OSの種類：UI がタイトル帯の形と全画面の方式を選ぶため、`get_platform` で返す
//! - App Nap の抑止（macOS）：起動中は「ユーザーが始めた活動」を保ち、VJツールを前面にしても
//!   取得・送出・描画が間引かれないようにする（`app_nap`）
//!
//! タイトルバー（Overlay・信号機ボタンの位置）は `tauri.macos.conf.json` に、全画面は UI が
//! `setSimpleFullscreen` で行い、メニューは UI が辞書の文言で組む（ここにはコードを持たない）。

#[cfg(target_os = "macos")]
pub mod app_nap;

use serde::Serialize;

/// アプリが動いているOSの種類。UI へは `"windows"`・`"macos"`・`"other"` で渡る
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Windows,
    Macos,
    Other,
}

impl Platform {
    /// 今のOS（ビルドの対象で決まる）
    pub const fn current() -> Self {
        if cfg!(target_os = "windows") {
            Self::Windows
        } else if cfg!(target_os = "macos") {
            Self::Macos
        } else {
            Self::Other
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_the_names_the_ui_expects() {
        let names = [Platform::Windows, Platform::Macos, Platform::Other]
            .map(|p| serde_json::to_string(&p).unwrap());
        assert_eq!(names, [r#""windows""#, r#""macos""#, r#""other""#]);
    }

    #[test]
    fn current_matches_the_build_target() {
        let expected = if cfg!(target_os = "windows") {
            Platform::Windows
        } else if cfg!(target_os = "macos") {
            Platform::Macos
        } else {
            Platform::Other
        };
        assert_eq!(Platform::current(), expected);
    }
}
