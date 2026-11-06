pub mod analysis;
pub mod audio_engine;
pub mod audio_source;
pub mod commands;
pub mod frame_transport;

use std::sync::Mutex;

use tauri::{Emitter, Manager};

use audio_engine::{AudioEngine, SOURCE_STATUS_EVENT};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let handle = app.handle().clone();
            let engine = AudioEngine::new(audio_source::default_source(), move |event| {
                let _ = handle.emit(SOURCE_STATUS_EVENT, event);
            });
            app.manage(Mutex::new(engine));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::start_stream,
            commands::list_output_devices,
            commands::select_output_device,
            commands::retry_source,
            commands::set_render_paused,
            commands::set_active_sections,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
