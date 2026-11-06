//! UI から呼ぶコマンド
//!
//! どのコマンドも `AudioEngine` に渡すだけの薄い入口にする。デバイスを開く処理で UI を
//! 止めないよう、すべて `async` 属性でメインスレッドの外（スレッドプール）で実行する。
//!
//! JavaScript からの引数名はキャメルケース（`onFrame`、`deviceId`、`paused`、`ids`）。
//! 入力源の状態はイベント `source-status`（`audio_engine::SOURCE_STATUS_EVENT`）で届く。

use std::sync::{Mutex, MutexGuard, PoisonError};

use tauri::State;
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::audio_engine::AudioEngine;
use crate::audio_source::DeviceInfo;
use crate::frame_transport::channel_output;

/// アプリが管理するエンジン
pub type EngineState = Mutex<AudioEngine>;

fn lock<'a>(engine: &'a State<'_, EngineState>) -> MutexGuard<'a, AudioEngine> {
    engine.lock().unwrap_or_else(PoisonError::into_inner)
}

/// 取得と送出を始める。解析結果のバイト列は `on_frame` に `ArrayBuffer` で届く
///
/// 先に `source-status` を listen しておくこと。呼び直すと、送り先を付け替えて最後の状態を送り直す。
#[tauri::command(async)]
pub fn start_stream(
    engine: State<'_, EngineState>,
    on_frame: Channel<InvokeResponseBody>,
) -> Result<(), String> {
    lock(&engine).start_stream(channel_output(on_frame));
    Ok(())
}

/// 選べる出力デバイスの一覧
#[tauri::command(async)]
pub fn list_output_devices(engine: State<'_, EngineState>) -> Result<Vec<DeviceInfo>, String> {
    lock(&engine)
        .list_output_devices()
        .map_err(|e| e.to_string())
}

/// 入力源を切り替える。`device_id` が `null` なら既定の出力デバイスに追従する
#[tauri::command(async)]
pub fn select_output_device(
    engine: State<'_, EngineState>,
    device_id: Option<String>,
) -> Result<(), String> {
    lock(&engine).select_output_device(device_id);
    Ok(())
}

/// 入力源を開き直す（S01c の「再試行」）
#[tauri::command(async)]
pub fn retry_source(engine: State<'_, EngineState>) -> Result<(), String> {
    lock(&engine).retry_source();
    Ok(())
}

/// 解析と送出を止める・再開する（ウィンドウの最小化）。取得は続ける
#[tauri::command(async)]
pub fn set_render_paused(engine: State<'_, EngineState>, paused: bool) -> Result<(), String> {
    lock(&engine).set_render_paused(paused);
    Ok(())
}

/// 有効にするセクション（`analysis::SectionId` の値）を指定する。知らない値は無視する
#[tauri::command(async)]
pub fn set_active_sections(engine: State<'_, EngineState>, ids: Vec<u8>) -> Result<(), String> {
    lock(&engine).set_active_sections(ids);
    Ok(())
}
