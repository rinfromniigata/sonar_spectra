//! UI から呼ぶコマンド
//!
//! どのコマンドも `AudioEngine` に渡すだけの薄い入口にする。デバイスを開く処理で UI を
//! 止めないよう、すべて `async` 属性でメインスレッドの外（スレッドプール）で実行する。
//!
//! JavaScript からの引数名はキャメルケース（`onFrame`、`deviceId`、`paused`、`ids`）。
//! 入力源の状態はイベント `source-status`（`audio_engine::SOURCE_STATUS_EVENT`）で届く。
//! 保存（`load_state`・`save_state`）は `SettingsStore` に渡すだけにする。
//! 構成ファイルの検証（`validate_config_file`）は `settings_store::config_file` に渡すだけにする
//! （ファイルの読み書き自体は、UI が `tauri-plugin-dialog` で選んだパスに `tauri-plugin-fs` で行う）。

use std::sync::{Mutex, MutexGuard, PoisonError};

use tauri::State;
use tauri::ipc::{Channel, InvokeResponseBody};

use crate::audio_engine::AudioEngine;
use crate::audio_source::DeviceInfo;
use crate::frame_transport::channel_output;
use crate::settings_store::config_file::parse_config_file;
use crate::settings_store::model::SavedConfig;
use crate::settings_store::{LoadOutcome, PersistedState, SettingsStore};

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

/// アプリが管理する `state.json` の読み書き。保存が重ならないよう `Mutex` に入れる
pub type StoreState = Mutex<SettingsStore>;

fn lock_store<'a>(store: &'a State<'_, StoreState>) -> MutexGuard<'a, SettingsStore> {
    store.lock().unwrap_or_else(PoisonError::into_inner)
}

/// 保存された状態を読む。`null` なら、UI が既定の状態を作って保存する
///
/// ファイルがない（初めての起動）ときと、読めずに `state.broken-{日時}.json` へ退避したときに `null` になる。
/// 古い `schema` は移行してから返す。
#[tauri::command(async)]
pub fn load_state(store: State<'_, StoreState>) -> Result<Option<PersistedState>, String> {
    let outcome = lock_store(&store).load().map_err(|e| e.to_string())?;
    if let LoadOutcome::Recovered { backup, reason } = &outcome {
        eprintln!(
            "state.json could not be read ({reason}); moved to {}",
            backup.display()
        );
    }
    Ok(outcome.into_state())
}

/// 状態を保存する（一時ファイルに書いてから置き換える）。決まりに合わない状態は書かずに `Err` を返す
#[tauri::command(async)]
pub fn save_state(store: State<'_, StoreState>, state: PersistedState) -> Result<(), String> {
    lock_store(&store).save(&state).map_err(|e| e.to_string())
}

/// 読み込んだ構成ファイルの本文を確かめ（古い `schema` は移行し）、中の保存済み構成を返す。
/// 形式の違う・壊れたファイルは `Err`（理由）を返す。`state.json` には触れない
#[tauri::command]
pub fn validate_config_file(text: String) -> Result<SavedConfig, String> {
    parse_config_file(&text)
}
