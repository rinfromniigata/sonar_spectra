pub mod analysis;
pub mod audio_engine;
pub mod audio_source;
pub mod commands;
pub mod frame_transport;
pub mod settings_store;

use std::sync::Mutex;

use tauri::{Emitter, Manager};
use tauri_plugin_window_state::StateFlags;

use audio_engine::{AudioEngine, SOURCE_STATUS_EVENT};
use settings_store::SettingsStore;

/// ウィンドウの状態のうち、記憶して次の起動で復元するもの
///
/// 位置・大きさ（ディスプレイを含む）・最大化・表示・装飾を記憶し、**全画面は記憶しない**。
/// 全画面で始めるかは、設定の「起動時にボーダレスフルスクリーン」（`display.startFullscreen`）に任せる（SPEC 5節）。
pub fn window_state_flags() -> StateFlags {
    StateFlags::all() - StateFlags::FULLSCREEN
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(window_state_flags())
                .build(),
        )
        // 構成の書き出し・読み込み。fs の権限には場所を書かず、ダイアログで選んだファイルだけが
        // その都度許可される（tauri-plugin-dialog が選んだパスを fs の範囲に足す）
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let engine = AudioEngine::new(audio_source::default_source(), move |event| {
                let _ = handle.emit(SOURCE_STATUS_EVENT, event);
            });
            app.manage(Mutex::new(engine));
            // %APPDATA%\com.rinontech.sonar-spectra\state.json
            let data_dir = app.path().app_data_dir()?;
            app.manage(Mutex::new(SettingsStore::new(data_dir)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_stream,
            commands::list_output_devices,
            commands::select_output_device,
            commands::retry_source,
            commands::set_render_paused,
            commands::set_active_sections,
            commands::load_state,
            commands::save_state,
            commands::validate_config_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_state_remembers_geometry_but_not_fullscreen() {
        let flags = window_state_flags();
        assert!(!flags.contains(StateFlags::FULLSCREEN));
        for kept in [
            StateFlags::SIZE,
            StateFlags::POSITION,
            StateFlags::MAXIMIZED,
            StateFlags::VISIBLE,
            StateFlags::DECORATIONS,
        ] {
            assert!(flags.contains(kept), "{kept:?}");
        }
    }
}
