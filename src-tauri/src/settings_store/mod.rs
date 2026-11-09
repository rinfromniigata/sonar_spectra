//! 保存（設定と構成の JSON）
//!
//! アプリのデータフォルダの `state.json` を読み書きする（imple 3.4）。
//!
//! - 書き込みは、同じフォルダの `state.json.tmp` に書いて同期してから `state.json` へ置き換える。
//!   書き込みの途中で止まっても、前回の `state.json` が残る
//! - 読み込みでは `schema` を確かめ、古い版は移行する（`migrate.rs`）
//! - 読めない（JSON でない、版が分からない・新しすぎる、型や決まりに合わない）ときは、元のファイルを
//!   `state.broken-{日時}.json` に名前を変えて残し、保存された状態がないものとして返す
//! - 既定の状態は作らない。既定の構成の名前（辞書）とインスタンスの既定値（モジュールのレジストリ）は
//!   UI が正本なので、`load` が `None` を返したら UI が既定の状態を作って保存する

pub mod config_file;
pub mod migrate;
pub mod model;

use std::fmt;
use std::fs::{self, File};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub use model::{PersistedState, SCHEMA};

const STATE_FILE: &str = "state.json";
const TEMP_FILE: &str = "state.json.tmp";
const BROKEN_PREFIX: &str = "state.broken-";

/// 読み込みの結果
#[derive(Debug, Clone, PartialEq)]
pub enum LoadOutcome {
    Loaded(PersistedState),
    /// `state.json` がない（初めての起動）
    Missing,
    /// 読めなかったので退避した。`backup` は名前を変えた先
    Recovered {
        backup: PathBuf,
        reason: String,
    },
}

impl LoadOutcome {
    /// 保存された状態。`None` なら既定の状態で起動する
    pub fn into_state(self) -> Option<PersistedState> {
        match self {
            Self::Loaded(state) => Some(state),
            Self::Missing | Self::Recovered { .. } => None,
        }
    }
}

#[derive(Debug)]
pub enum StoreError {
    Io(io::Error),
    Invalid(model::Invalid),
    Encode(serde_json::Error),
}

impl fmt::Display for StoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(e) => write!(f, "settings file error: {e}"),
            Self::Invalid(e) => write!(f, "invalid state: {e}"),
            Self::Encode(e) => write!(f, "failed to encode state: {e}"),
        }
    }
}

impl std::error::Error for StoreError {}

impl From<io::Error> for StoreError {
    fn from(e: io::Error) -> Self {
        Self::Io(e)
    }
}

/// `state.json` の読み書き。同時に呼ばれないよう、アプリでは `Mutex` に入れて持つ
#[derive(Debug, Clone)]
pub struct SettingsStore {
    dir: PathBuf,
}

impl SettingsStore {
    /// `dir` はアプリのデータフォルダ。なければ保存のときに作る
    pub fn new(dir: impl Into<PathBuf>) -> Self {
        Self { dir: dir.into() }
    }

    pub fn state_path(&self) -> PathBuf {
        self.dir.join(STATE_FILE)
    }

    fn temp_path(&self) -> PathBuf {
        self.dir.join(TEMP_FILE)
    }

    /// 読み込む。ファイルが読めない（権限など）ときだけ `Err` を返す
    pub fn load(&self) -> Result<LoadOutcome, StoreError> {
        let path = self.state_path();
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(LoadOutcome::Missing),
            // UTF-8 でない中身も「読めない」として退避する
            Err(e) if e.kind() == io::ErrorKind::InvalidData => {
                return self.recover(format!("not UTF-8: {e}"));
            }
            Err(e) => return Err(e.into()),
        };
        match parse(&text) {
            Ok(state) => Ok(LoadOutcome::Loaded(state)),
            Err(reason) => self.recover(reason),
        }
    }

    /// 保存する。決まりに合わない状態は書かない（次の起動で退避されるのを防ぐ）
    pub fn save(&self, state: &PersistedState) -> Result<(), StoreError> {
        state.validate().map_err(StoreError::Invalid)?;
        let mut bytes = serde_json::to_vec_pretty(state).map_err(StoreError::Encode)?;
        bytes.push(b'\n');
        fs::create_dir_all(&self.dir)?;
        let temp = self.temp_path();
        write_synced(&temp, &bytes)?;
        fs::rename(&temp, self.state_path())?;
        Ok(())
    }

    fn recover(&self, reason: String) -> Result<LoadOutcome, StoreError> {
        let backup = self.backup_path(SystemTime::now());
        fs::rename(self.state_path(), &backup)?;
        Ok(LoadOutcome::Recovered { backup, reason })
    }

    /// `state.broken-{日時}.json`。日時は UTC（`20261108T051530Z`）。同じ秒に重なったら番号を付ける
    fn backup_path(&self, now: SystemTime) -> PathBuf {
        let stamp = utc_stamp(now);
        let mut path = self.dir.join(format!("{BROKEN_PREFIX}{stamp}.json"));
        let mut n = 2;
        while path.exists() {
            path = self.dir.join(format!("{BROKEN_PREFIX}{stamp}-{n}.json"));
            n += 1;
        }
        path
    }
}

/// JSON の解釈 → 移行 → 型 → 決まりの確認。失敗したら理由を返す
fn parse(text: &str) -> Result<PersistedState, String> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("not JSON: {e}"))?;
    let migrated = migrate::migrate(value).map_err(|e| e.to_string())?;
    let state: PersistedState =
        serde_json::from_value(migrated.value).map_err(|e| format!("unexpected shape: {e}"))?;
    state.validate().map_err(|e| e.to_string())?;
    Ok(state)
}

fn write_synced(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = File::create(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// UNIX 時刻を UTC の `yyyyMMddTHHmmssZ` にする
fn utc_stamp(now: SystemTime) -> String {
    let secs = now
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (days, rem) = (secs / 86_400, secs % 86_400);
    let (y, m, d) = civil_from_days(days as i64);
    format!(
        "{y:04}{m:02}{d:02}T{:02}{:02}{:02}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

/// 1970-01-01 からの日数を年月日にする（Howard Hinnant の civil_from_days）
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::model::*;
    use super::*;
    use serde_json::{Value, json};
    use std::time::Duration;

    /// テストごとの作業用フォルダ。終わったら消す
    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "sonar_spectra_settings_store_{name}_{}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&dir);
            Self(dir)
        }

        fn store(&self) -> SettingsStore {
            SettingsStore::new(&self.0)
        }

        fn files(&self) -> Vec<String> {
            let mut names: Vec<String> = fs::read_dir(&self.0)
                .map(|it| {
                    it.filter_map(|e| e.ok())
                        .map(|e| e.file_name().to_string_lossy().into_owned())
                        .collect()
                })
                .unwrap_or_default();
            names.sort();
            names
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// imple 5.2 の手順4・5のあとに近い状態（ライト、手動配置、自分で作った配色1件）
    fn sample_json() -> Value {
        let instance = |id: &str, kind: &str, rect: Value, options: Value| {
            json!({
                "id": id, "kind": kind, "enabled": true, "rect": rect,
                "direction": "up", "paletteId": "preset.a", "sourceId": "default",
                "options": options
            })
        };
        let config = |theme: &str, mode: &str, rects: bool| {
            let r = |c, r, cs, rs| {
                if rects {
                    json!({ "c": c, "r": r, "cs": cs, "rs": rs })
                } else {
                    Value::Null
                }
            };
            let mut pan = instance(
                "i-pan",
                "stereo",
                r(9, 5, 4, 4),
                json!({ "mode": "lissajous", "dots": "both", "blur": true }),
            );
            pan["slot"] = json!("pan");
            pan["direction"] = Value::Null;
            json!({
                "layout": { "mode": mode, "instances": [
                    instance("i-level", "level", r(1, 1, 1, 8), json!({})),
                    instance("i-wave", "wave", r(2, 1, 11, 4), json!({ "channel": "stereo", "showNow": true, "split": 72, "histColor": "solid", "speed": 1 })),
                    instance("i-spec", "spec", r(2, 5, 7, 4), json!({ "mode": "fill", "ghost": true })),
                    pan,
                ]},
                "customPalettes": [
                    { "id": "p-1", "name": "夜明け", "main": "#ff3d9a", "sub": "#3df0ff", "accent": "#ffd23d" }
                ],
                "theme": theme,
                "display": { "scanline": true, "alwaysOnTop": false, "startFullscreen": false }
            })
        };
        let mut saved = config("dark", "auto", false);
        saved["id"] = json!("c-default");
        saved["name"] = json!("既定");
        saved["savedAt"] = json!("2026-11-08T05:15:30.000Z");
        json!({
            "schema": 1,
            "current": config("light", "manual", true),
            "activeConfigId": "c-default",
            "dirty": true,
            "savedConfigs": [saved],
            "source": { "deviceId": "{0.0.0.00000000}.{abc}" }
        })
    }

    fn sample() -> PersistedState {
        serde_json::from_value(sample_json()).unwrap()
    }

    fn write_state(dir: &TestDir, text: &str) {
        fs::create_dir_all(&dir.0).unwrap();
        fs::write(dir.0.join(STATE_FILE), text).unwrap();
    }

    #[test]
    fn sample_is_valid() {
        sample().validate().unwrap();
    }

    #[test]
    fn missing_file_starts_from_default() {
        let dir = TestDir::new("missing");
        assert_eq!(dir.store().load().unwrap(), LoadOutcome::Missing);
        assert!(dir.files().is_empty());
    }

    #[test]
    fn save_then_load_gives_the_same_state() {
        let dir = TestDir::new("roundtrip");
        let store = dir.store();
        let state = sample();
        store.save(&state).unwrap();
        assert_eq!(store.load().unwrap(), LoadOutcome::Loaded(state.clone()));
        // 一時ファイルは残らない
        assert_eq!(dir.files(), vec![STATE_FILE.to_string()]);

        // 上書きしても同じ
        let mut next = state;
        next.dirty = false;
        next.source.device_id = None;
        next.current.theme = Theme::System;
        store.save(&next).unwrap();
        assert_eq!(store.load().unwrap(), LoadOutcome::Loaded(next));
    }

    #[test]
    fn saved_json_keeps_the_ui_field_names() {
        let dir = TestDir::new("names");
        let store = dir.store();
        store.save(&sample()).unwrap();
        let text = fs::read_to_string(store.state_path()).unwrap();
        let written: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(written, sample_json());
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let dir = TestDir::new("unknown");
        let mut value = sample_json();
        value["extra"] = json!(1);
        value["current"]["layout"]["instances"][0]["extra"] = json!("x");
        write_state(&dir, &value.to_string());
        assert_eq!(dir.store().load().unwrap(), LoadOutcome::Loaded(sample()));
    }

    fn assert_recovered(name: &str, text: &str) {
        let dir = TestDir::new(name);
        write_state(&dir, text);
        let outcome = dir.store().load().unwrap();
        let LoadOutcome::Recovered { backup, reason } = outcome else {
            panic!("{name}: expected Recovered, got {outcome:?}");
        };
        assert!(!reason.is_empty());
        // 元のファイルは退避先に中身ごと残り、state.json はなくなる
        assert_eq!(fs::read_to_string(&backup).unwrap(), text, "{name}");
        let files = dir.files();
        assert_eq!(files.len(), 1, "{name}: {files:?}");
        assert!(files[0].starts_with(BROKEN_PREFIX) && files[0].ends_with(".json"));
        // 退避のあとは初めての起動と同じ
        assert_eq!(dir.store().load().unwrap(), LoadOutcome::Missing);
    }

    #[test]
    fn broken_files_are_moved_aside() {
        assert_recovered("truncated", &sample_json().to_string()[..40]);
        assert_recovered("empty", "");
        assert_recovered("not_object", "[1, 2]");
        assert_recovered("no_schema", r#"{ "current": {} }"#);

        let mut newer = sample_json();
        newer["schema"] = json!(SCHEMA + 1);
        assert_recovered("newer", &newer.to_string());

        let mut wrong_kind = sample_json();
        wrong_kind["current"]["layout"]["instances"][0]["kind"] = json!("oscilloscope");
        assert_recovered("wrong_kind", &wrong_kind.to_string());

        let mut no_active = sample_json();
        no_active["activeConfigId"] = json!("c-gone");
        assert_recovered("no_active", &no_active.to_string());

        let mut outside = sample_json();
        outside["current"]["layout"]["instances"][1]["rect"] =
            json!({ "c": 2, "r": 1, "cs": 12, "rs": 4 });
        assert_recovered("outside", &outside.to_string());
    }

    #[test]
    fn non_utf8_file_is_moved_aside() {
        let dir = TestDir::new("non_utf8");
        fs::create_dir_all(&dir.0).unwrap();
        fs::write(dir.0.join(STATE_FILE), [0xff, 0xfe, 0x00, 0x7b]).unwrap();
        let outcome = dir.store().load().unwrap();
        assert!(
            matches!(outcome, LoadOutcome::Recovered { .. }),
            "{outcome:?}"
        );
        assert_eq!(dir.store().load().unwrap(), LoadOutcome::Missing);
    }

    #[test]
    fn backups_in_the_same_second_do_not_collide() {
        let dir = TestDir::new("collide");
        let store = dir.store();
        fs::create_dir_all(&dir.0).unwrap();
        let now = UNIX_EPOCH + Duration::from_secs(1_794_028_530); // 2026-11-07T05:15:30Z
        let first = store.backup_path(now);
        assert_eq!(
            first.file_name().unwrap(),
            "state.broken-20261107T051530Z.json"
        );
        fs::write(&first, "x").unwrap();
        let second = store.backup_path(now);
        assert_eq!(
            second.file_name().unwrap(),
            "state.broken-20261107T051530Z-2.json"
        );
    }

    #[test]
    fn interrupted_write_keeps_the_previous_state() {
        let dir = TestDir::new("interrupted");
        let store = dir.store();
        let before = sample();
        store.save(&before).unwrap();

        // 一時ファイルへ書いている途中で止まった（置き換えの前）
        let mut after = before.clone();
        after.current.theme = Theme::Dark;
        let full = serde_json::to_vec_pretty(&after).unwrap();
        fs::write(dir.0.join(TEMP_FILE), &full[..full.len() / 2]).unwrap();

        assert_eq!(store.load().unwrap(), LoadOutcome::Loaded(before));
        // 次の保存は書きかけの一時ファイルを上書きして、置き換えまで終える
        store.save(&after).unwrap();
        assert_eq!(store.load().unwrap(), LoadOutcome::Loaded(after));
        assert_eq!(dir.files(), vec![STATE_FILE.to_string()]);
    }

    /// 書き込みが失敗したとき（一時ファイルを作れない）、前の `state.json` を触らないこと。
    /// `state.json` に直接書く実装では、ここで `state.json` が先に壊れる
    #[test]
    fn failed_write_leaves_the_previous_state_untouched() {
        let dir = TestDir::new("failed_write");
        let store = dir.store();
        let before = sample();
        store.save(&before).unwrap();
        let bytes_before = fs::read(store.state_path()).unwrap();

        // 一時ファイルの場所を同じ名前のフォルダでふさぎ、書き込みを失敗させる
        fs::create_dir(dir.0.join(TEMP_FILE)).unwrap();
        let mut after = before.clone();
        after.current.theme = Theme::Dark;
        after.source.device_id = None;
        assert!(matches!(store.save(&after), Err(StoreError::Io(_))));

        assert_eq!(fs::read(store.state_path()).unwrap(), bytes_before);
        assert_eq!(store.load().unwrap(), LoadOutcome::Loaded(before));
    }

    #[test]
    fn invalid_state_is_not_saved() {
        let dir = TestDir::new("invalid_save");
        let store = dir.store();
        let before = sample();
        store.save(&before).unwrap();

        let mut bad = before.clone();
        bad.active_config_id = "c-gone".into();
        assert!(matches!(
            store.save(&bad),
            Err(StoreError::Invalid(Invalid::ActiveConfigMissing(_)))
        ));
        let mut dup = before.clone();
        let copy = dup.current.layout.instances[0].clone();
        dup.current.layout.instances.push(copy);
        assert!(matches!(
            store.save(&dup),
            Err(StoreError::Invalid(Invalid::DuplicateInstanceId(_)))
        ));
        let mut old = before.clone();
        old.schema = SCHEMA + 1;
        assert!(matches!(
            store.save(&old),
            Err(StoreError::Invalid(Invalid::Schema(_)))
        ));

        assert_eq!(store.load().unwrap(), LoadOutcome::Loaded(before));
    }

    #[test]
    fn rect_must_fit_the_grid() {
        let rect = |c, r, cs, rs| Rect { c, r, cs, rs };
        assert!(rect(1, 1, 12, 8).inside_grid());
        assert!(rect(12, 8, 1, 1).inside_grid());
        assert!(!rect(0, 1, 1, 1).inside_grid());
        assert!(!rect(1, 1, 0, 1).inside_grid());
        assert!(!rect(12, 1, 2, 1).inside_grid());
        assert!(!rect(1, 8, 1, 2).inside_grid());
        assert!(!rect(u32::MAX, 1, 2, 1).inside_grid());
    }

    #[test]
    fn utc_stamp_formats_known_dates() {
        let at = |secs| utc_stamp(UNIX_EPOCH + Duration::from_secs(secs));
        assert_eq!(at(0), "19700101T000000Z");
        assert_eq!(at(951_782_400), "20000229T000000Z");
        assert_eq!(at(1_794_028_530), "20261107T051530Z");
    }
}
