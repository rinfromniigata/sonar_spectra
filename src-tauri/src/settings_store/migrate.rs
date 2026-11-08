//! `schema` の確認と移行
//!
//! 形式を変えるときは、`model::SCHEMA` を1つ上げ、旧版から新版へ JSON を書き換える関数を
//! `STEPS` の末尾に足す。読み込み時に、ファイルの `schema` から今の版まで順に当てる。
//! schema 1 が最初の形式なので、今は移行の手順がない。

use std::fmt;

use serde_json::{Map, Value};

use super::model::SCHEMA;

/// 1つの版を次の版へ書き換える。`schema` の書き換えは呼び出し側が行う
pub type Step = fn(Map<String, Value>) -> Result<Map<String, Value>, String>;

/// `STEPS[i]` は schema `i + 1` → `i + 2` の移行
pub const STEPS: &[Step] = &[];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MigrateError {
    NotAnObject,
    MissingSchema,
    /// 新しい版のアプリが書いたもの。読むと中身を落とすおそれがある
    Newer(u64),
    Unknown(u64),
    Step {
        from: u64,
        detail: String,
    },
}

impl fmt::Display for MigrateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotAnObject => write!(f, "state is not a JSON object"),
            Self::MissingSchema => write!(f, "schema is missing or not an integer"),
            Self::Newer(found) => write!(f, "schema {found} is newer than this app ({SCHEMA})"),
            Self::Unknown(found) => write!(f, "unknown schema {found}"),
            Self::Step { from, detail } => {
                write!(f, "migration from schema {from} failed: {detail}")
            }
        }
    }
}

impl std::error::Error for MigrateError {}

/// 結果。`migrated` は1つ以上の手順を当てたか
#[derive(Debug, Clone, PartialEq)]
pub struct Migrated {
    pub value: Value,
    pub from: u64,
    pub migrated: bool,
}

/// 今の版へ移行する
pub fn migrate(value: Value) -> Result<Migrated, MigrateError> {
    migrate_with(value, STEPS)
}

/// 手順を差し替えて移行する（`steps` の長さ + 1 が到達する版）
pub fn migrate_with(value: Value, steps: &[Step]) -> Result<Migrated, MigrateError> {
    let Value::Object(mut map) = value else {
        return Err(MigrateError::NotAnObject);
    };
    let target = steps.len() as u64 + 1;
    let from = map
        .get("schema")
        .and_then(Value::as_u64)
        .ok_or(MigrateError::MissingSchema)?;
    if from > target {
        return Err(MigrateError::Newer(from));
    }
    if from == 0 {
        return Err(MigrateError::Unknown(from));
    }
    let mut version = from;
    while version < target {
        let step = steps[(version - 1) as usize];
        map = step(map).map_err(|detail| MigrateError::Step {
            from: version,
            detail,
        })?;
        version += 1;
        map.insert("schema".into(), Value::from(version));
    }
    Ok(Migrated {
        value: Value::Object(map),
        from,
        migrated: from != target,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// 架空の schema 1 → 2：`dirty` がなかった旧版に `dirty: false` を足す
    fn add_dirty(mut map: Map<String, Value>) -> Result<Map<String, Value>, String> {
        map.entry("dirty").or_insert(Value::Bool(false));
        Ok(map)
    }

    /// 架空の schema 2 → 3：`theme` を `current` の中へ移す
    fn move_theme(mut map: Map<String, Value>) -> Result<Map<String, Value>, String> {
        let theme = map.remove("theme").ok_or("theme is missing")?;
        let current = map
            .get_mut("current")
            .and_then(Value::as_object_mut)
            .ok_or("current is missing")?;
        current.insert("theme".into(), theme);
        Ok(map)
    }

    #[test]
    fn current_schema_passes_through() {
        assert_eq!(SCHEMA as usize, STEPS.len() + 1);
        let value = json!({ "schema": SCHEMA, "x": 1 });
        let out = migrate(value.clone()).unwrap();
        assert_eq!(out.value, value);
        assert!(!out.migrated);
    }

    #[test]
    fn old_schema_runs_each_step_in_order() {
        let old = json!({ "schema": 1, "theme": "light", "current": {} });
        let out = migrate_with(old, &[add_dirty, move_theme]).unwrap();
        assert_eq!(
            out.value,
            json!({ "schema": 3, "dirty": false, "current": { "theme": "light" } })
        );
        assert_eq!(out.from, 1);
        assert!(out.migrated);
    }

    #[test]
    fn middle_schema_runs_only_remaining_steps() {
        let old = json!({ "schema": 2, "dirty": true, "theme": "dark", "current": {} });
        let out = migrate_with(old, &[add_dirty, move_theme]).unwrap();
        assert_eq!(
            out.value,
            json!({ "schema": 3, "dirty": true, "current": { "theme": "dark" } })
        );
    }

    #[test]
    fn step_failure_reports_its_source_schema() {
        let old = json!({ "schema": 2, "current": {} });
        let err = migrate_with(old, &[add_dirty, move_theme]).unwrap_err();
        assert_eq!(
            err,
            MigrateError::Step {
                from: 2,
                detail: "theme is missing".into()
            }
        );
    }

    #[test]
    fn rejects_newer_missing_zero_and_non_object() {
        assert_eq!(
            migrate(json!({ "schema": SCHEMA + 1 })).unwrap_err(),
            MigrateError::Newer(u64::from(SCHEMA) + 1)
        );
        assert_eq!(migrate(json!({})).unwrap_err(), MigrateError::MissingSchema);
        assert_eq!(
            migrate(json!({ "schema": "1" })).unwrap_err(),
            MigrateError::MissingSchema
        );
        assert_eq!(
            migrate(json!({ "schema": 0 })).unwrap_err(),
            MigrateError::Unknown(0)
        );
        assert_eq!(migrate(json!([1])).unwrap_err(), MigrateError::NotAnObject);
    }
}
