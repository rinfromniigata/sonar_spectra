//! 構成ファイル（書き出し・読み込み。imple 5.2 の12・13）
//!
//! 形式は `{ "format": "sonar_spectra.config", "schema": 2, "config": SavedConfig }`。
//! 書き出しは UI が行う（選んだ場所に `tauri-plugin-fs` で書く）。読み込みでは、UI が読んだ本文を
//! `validate_config_file` で確かめ、保存済み構成として返す。新しい ID を振って一覧に足すのは UI。
//!
//! - `format` が違う・JSON でない・版が分からない／新しすぎる・型や決まりに合わない・名前が空のものは拒否する
//! - `schema` は `state.json` と同じ版を使う。古い版は `CONFIG_STEPS` で移行する
//!   （`state.json` の移行 `migrate::STEPS` と同じ数だけ手順を持つ）

use serde::Deserialize;
use serde_json::{Map, Value};

use super::migrate::{self, Step};
use super::model::SavedConfig;

/// 構成ファイルの `format`
pub const CONFIG_FORMAT: &str = "sonar_spectra.config";

/// `CONFIG_STEPS[i]` は構成ファイルの schema `i + 1` → `i + 2` の移行（対象はファイル全体のオブジェクト）
pub const CONFIG_STEPS: &[Step] = &[unchanged];

/// schema 1 → 2：構成ファイルの中身は変わらない（`app` は構成に含めない）
fn unchanged(map: Map<String, Value>) -> Result<Map<String, Value>, String> {
    Ok(map)
}

#[derive(Debug, Deserialize)]
struct ConfigFile {
    config: SavedConfig,
}

/// 構成ファイルの本文を確かめ、中の保存済み構成を返す。拒否したときは理由を返す
pub fn parse_config_file(text: &str) -> Result<SavedConfig, String> {
    parse_with(text, CONFIG_STEPS)
}

fn parse_with(text: &str, steps: &[Step]) -> Result<SavedConfig, String> {
    let value: Value = serde_json::from_str(text).map_err(|e| format!("not JSON: {e}"))?;
    let format = value.get("format").and_then(Value::as_str);
    if format != Some(CONFIG_FORMAT) {
        return Err(format!("not a {CONFIG_FORMAT} file"));
    }
    let migrated = migrate::migrate_with(value, steps).map_err(|e| e.to_string())?;
    let file: ConfigFile =
        serde_json::from_value(migrated.value).map_err(|e| format!("unexpected shape: {e}"))?;
    if file.config.name.trim().is_empty() {
        return Err("config name is empty".into());
    }
    file.config.config.validate().map_err(|e| e.to_string())?;
    Ok(file.config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settings_store::model::{LayoutMode, Theme};
    use crate::settings_store::{SCHEMA, migrate::STEPS};
    use serde_json::json;

    fn instance(id: &str, rect: Value) -> Value {
        json!({
            "id": id, "kind": "spec", "enabled": true, "rect": rect, "direction": "up",
            "paletteId": "custom.p1", "sourceId": "default", "options": { "mode": "bars" }
        })
    }

    /// UI が書き出す形（`src/config/config_file.ts` の `buildConfigFile`）
    fn file() -> Value {
        json!({
            "format": CONFIG_FORMAT,
            "schema": SCHEMA,
            "config": {
                "id": "c-club", "name": "クラブ用", "savedAt": "2026-11-09T01:00:00.000Z",
                "layout": { "mode": "manual", "instances": [instance("i-1", json!({ "c": 1, "r": 1, "cs": 12, "rs": 8 }))] },
                "customPalettes": [{ "id": "custom.p1", "name": "夜明け", "main": "#ff3d9a", "sub": "#3df0ff", "accent": "#ffd23d" }],
                "theme": "light",
                "display": { "scanline": false, "alwaysOnTop": true, "startFullscreen": false }
            }
        })
    }

    fn with(edit: impl FnOnce(&mut Value)) -> String {
        let mut value = file();
        edit(&mut value);
        value.to_string()
    }

    #[test]
    fn config_steps_follow_the_state_schema() {
        assert_eq!(CONFIG_STEPS.len(), STEPS.len());
        assert_eq!(SCHEMA as usize, CONFIG_STEPS.len() + 1);
    }

    #[test]
    fn reads_the_saved_config() {
        let saved = parse_config_file(&file().to_string()).unwrap();
        assert_eq!(saved.id, "c-club");
        assert_eq!(saved.name, "クラブ用");
        assert_eq!(saved.saved_at, "2026-11-09T01:00:00.000Z");
        assert_eq!(saved.config.layout.mode, LayoutMode::Manual);
        assert_eq!(saved.config.theme, Theme::Light);
        assert_eq!(saved.config.custom_palettes[0].name, "夜明け");
        assert!(saved.config.display.always_on_top);
        assert_eq!(saved.config.layout.instances[0].options["mode"], "bars");
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let text = with(|v| {
            v["extra"] = json!(1);
            v["config"]["window"] = json!({ "x": 10 });
            v["config"]["source"] = json!({ "deviceId": "dev-1" });
        });
        let saved = parse_config_file(&text).unwrap();
        // ウィンドウの位置と入力源のデバイスは構成に含めない：紛れ込んでいても、UI に返す値には入らない
        let returned = serde_json::to_string(&saved).unwrap();
        assert!(!returned.contains("window") && !returned.contains("deviceId") && !returned.contains("dev-1"));
    }

    #[test]
    fn rejects_other_files() {
        assert!(parse_config_file("not json").unwrap_err().starts_with("not JSON"));
        for text in [
            with(|v| v["format"] = json!("other")),
            with(|v| {
                v.as_object_mut().unwrap().remove("format");
            }),
            json!([1, 2]).to_string(),
        ] {
            assert!(parse_config_file(&text).unwrap_err().contains(CONFIG_FORMAT), "{text}");
        }
    }

    #[test]
    fn rejects_unknown_or_newer_schema() {
        assert!(parse_config_file(&with(|v| v["schema"] = json!(SCHEMA + 1))).is_err());
        assert!(parse_config_file(&with(|v| v["schema"] = json!(0))).is_err());
        assert!(
            parse_config_file(&with(|v| {
                v.as_object_mut().unwrap().remove("schema");
            }))
            .is_err()
        );
    }

    #[test]
    fn rejects_wrong_shapes_and_broken_rules() {
        let cases = [
            with(|v| v["config"]["theme"] = json!("neon")),
            with(|v| {
                v["config"].as_object_mut().unwrap().remove("layout");
            }),
            with(|v| v["config"]["layout"]["instances"][0]["kind"] = json!("radar")),
            with(|v| v["config"]["name"] = json!("  ")),
            // 格子の外
            with(|v| v["config"]["layout"]["instances"][0]["rect"] = json!({ "c": 6, "r": 1, "cs": 8, "rs": 8 })),
            // インスタンスの ID の重なり
            with(|v| {
                let first = v["config"]["layout"]["instances"][0].clone();
                v["config"]["layout"]["instances"].as_array_mut().unwrap().push(first);
            }),
        ];
        for text in cases {
            assert!(parse_config_file(&text).is_err(), "{text}");
        }
    }

    /// UI と共有する見本（`fixtures/config_file_v2.json`）。UI の `buildConfigFile` が書いたとおりの本文で、
    /// UI 側（`src/config/config_flow.test.ts`）は「この見本の構成を書き出すと、同じ本文になる」を確かめる
    const SHARED_FIXTURE: &str = include_str!("fixtures/config_file_v2.json");

    /// v3までのアプリが書いた schema 1 の構成ファイル（`fixtures/config_file_v1.json`）も、同じ構成として読める
    #[test]
    fn schema_1_file_is_still_readable() {
        let old = parse_config_file(include_str!("fixtures/config_file_v1.json")).unwrap();
        assert_eq!(old, parse_config_file(SHARED_FIXTURE).unwrap());
    }

    #[test]
    fn accepts_the_file_the_ui_writes() {
        let saved = parse_config_file(SHARED_FIXTURE).unwrap();
        assert_eq!(saved.id, "c-club");
        assert_eq!(saved.name, "クラブ用");
        assert_eq!(saved.config.layout.instances.len(), 8);
        // 専用の位置・方向なし・無効で位置なしのインスタンスも読める
        let instances = &saved.config.layout.instances;
        assert!(instances.iter().any(|i| i.slot.is_some()));
        assert!(instances.iter().any(|i| i.direction.is_none()));
        assert!(instances.iter().any(|i| !i.enabled && i.rect.is_none()));
        assert_eq!(saved.config.custom_palettes[0].id, "custom.p1");
    }

    #[test]
    fn returns_the_same_config_the_ui_wrote() {
        // UI が受け取る値（Rust が JSON にしたもの）が、書き出した構成と同じ中身になる
        let saved = parse_config_file(SHARED_FIXTURE).unwrap();
        let file: Value = serde_json::from_str(SHARED_FIXTURE).unwrap();
        assert_eq!(serde_json::to_value(&saved).unwrap(), file["config"]);
    }

    /// 架空の schema 1 → 2：`config.theme` がなかった旧版に `"dark"` を足す
    fn add_theme(mut map: Map<String, Value>) -> Result<Map<String, Value>, String> {
        let config = map
            .get_mut("config")
            .and_then(Value::as_object_mut)
            .ok_or("config is missing")?;
        config.entry("theme").or_insert(json!("dark"));
        Ok(map)
    }

    #[test]
    fn old_schema_is_migrated() {
        let text = with(|v| {
            v["schema"] = json!(1);
            v["config"].as_object_mut().unwrap().remove("theme");
        });
        let saved = parse_with(&text, &[add_theme]).unwrap();
        assert_eq!(saved.config.theme, Theme::Dark);
    }
}
