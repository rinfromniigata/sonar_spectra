//! `state.json` のデータモデル（imple 5.1）
//!
//! JSON のキーはキャメルケース（UI の型と同じ）。種類ごとの設定（`options`）の中身は
//! モジュールのレジストリ（UI）が正本なので、ここではオブジェクトであることだけを確かめる。
//! 知らないキーは読み飛ばす（書き戻すときには残らない）。

use std::collections::HashSet;
use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// 今の `state.json` の形式の版
pub const SCHEMA: u32 = 2;

/// 選べるフレームレートの上限（fps。`src/config/types.ts` の `FRAME_LIMITS` と同じ）
pub const FRAME_LIMITS: [u32; 3] = [60, 45, 30];

/// フレームレートの上限の既定（1→2の移行もこの値を足す）
pub const DEFAULT_FRAME_LIMIT: u32 = 60;

/// 配置の格子（imple 4.3。`src/layout/grid.ts` の `GRID_COLUMNS`・`GRID_ROWS` と同じ）
pub const GRID_COLUMNS: u32 = 12;
pub const GRID_ROWS: u32 = 8;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedState {
    pub schema: u32,
    /// 今表示している構成（作業中の写し）
    pub current: Config,
    /// 使用中の保存済み構成
    pub active_config_id: String,
    /// 保存後に変更があるか（S02 の「保存後に変更あり」）
    pub dirty: bool,
    pub saved_configs: Vec<SavedConfig>,
    /// 入力源。構成には含めない
    pub source: SourceSetting,
    /// アプリ全体の設定（v4）。構成には含めない
    pub app: AppSettings,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// フレームレートの上限（fps）。`FRAME_LIMITS` のどれか
    pub frame_limit: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceSetting {
    /// `None`（`null`）は既定の出力デバイス
    pub device_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedConfig {
    pub id: String,
    pub name: String,
    /// ISO 8601
    pub saved_at: String,
    #[serde(flatten)]
    pub config: Config,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub layout: Layout,
    /// 自分で作った配色
    pub custom_palettes: Vec<Palette>,
    pub theme: Theme,
    pub display: Display,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub mode: LayoutMode,
    pub instances: Vec<Instance>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LayoutMode {
    Auto,
    Manual,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
    System,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub scanline: bool,
    pub always_on_top: bool,
    pub start_fullscreen: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instance {
    pub id: String,
    pub kind: ModuleKind,
    pub enabled: bool,
    /// 自動配置中は `None`（`null`）
    pub rect: Option<Rect>,
    /// 既定の配置で専用の位置を持つもの
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot: Option<Slot>,
    /// `None`（`null`）は方向なし
    pub direction: Option<Direction>,
    /// `"preset.a"` など、または自分で作った配色の ID
    pub palette_id: String,
    /// 初版は `"default"` だけ
    pub source_id: String,
    /// 種類ごとの設定。中身はモジュールのレジストリ（UI）が正本
    pub options: Map<String, Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ModuleKind {
    Level,
    Wave,
    Spec,
    Stereo,
    Gram,
    Loud,
    Vu,
    Chroma,
    Centroid,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Slot {
    Pan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Up,
    Right,
    Down,
    Left,
}

/// 格子の上の位置（1始まり。`c`・`r` は左上のマス、`cs`・`rs` はマスの数）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub c: u32,
    pub r: u32,
    pub cs: u32,
    pub rs: u32,
}

/// 自分で作った配色（ダーク用の値）
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Palette {
    pub id: String,
    pub name: String,
    pub main: String,
    pub sub: String,
    pub accent: String,
}

/// 型としては読めたが、中身の決まりに合わない
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Invalid {
    Schema(u32),
    NoSavedConfig,
    ActiveConfigMissing(String),
    DuplicateSavedConfigId(String),
    DuplicateInstanceId(String),
    RectOutsideGrid(String),
    FrameLimit(u32),
}

impl fmt::Display for Invalid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Schema(found) => write!(f, "unexpected schema {found} (expected {SCHEMA})"),
            Self::NoSavedConfig => write!(f, "no saved config"),
            Self::ActiveConfigMissing(id) => write!(f, "active config not found: {id}"),
            Self::DuplicateSavedConfigId(id) => write!(f, "duplicate saved config id: {id}"),
            Self::DuplicateInstanceId(id) => write!(f, "duplicate instance id: {id}"),
            Self::RectOutsideGrid(id) => write!(f, "rect outside the grid: {id}"),
            Self::FrameLimit(value) => write!(f, "unsupported frame limit: {value}"),
        }
    }
}

impl std::error::Error for Invalid {}

impl Rect {
    /// 1マス以上で、12×8 の格子の中に収まるか
    pub fn inside_grid(&self) -> bool {
        self.c >= 1
            && self.r >= 1
            && self.cs >= 1
            && self.rs >= 1
            && self.c.saturating_add(self.cs) - 1 <= GRID_COLUMNS
            && self.r.saturating_add(self.rs) - 1 <= GRID_ROWS
    }
}

impl Config {
    /// インスタンスの ID が重ならず、位置が格子の中にあるか
    pub fn validate(&self) -> Result<(), Invalid> {
        let mut ids = HashSet::new();
        for instance in &self.layout.instances {
            if !ids.insert(instance.id.as_str()) {
                return Err(Invalid::DuplicateInstanceId(instance.id.clone()));
            }
            if instance.rect.is_some_and(|rect| !rect.inside_grid()) {
                return Err(Invalid::RectOutsideGrid(instance.id.clone()));
            }
        }
        Ok(())
    }
}

impl PersistedState {
    /// 型では表せない決まりを確かめる
    ///
    /// - `schema` が今の版である
    /// - 保存済みの構成が1件以上あり、ID が重ならず、使用中の構成がその中にある（使用中は削除できないため）
    /// - 各構成のインスタンスの ID が重ならず、位置が格子の中にある
    /// - フレームレートの上限が `FRAME_LIMITS` のどれかである
    ///
    /// 重なり・推奨の形との適合・配色の参照先は、UI 側の配置と配色が扱う（ここでは確かめない）。
    pub fn validate(&self) -> Result<(), Invalid> {
        if self.schema != SCHEMA {
            return Err(Invalid::Schema(self.schema));
        }
        if !FRAME_LIMITS.contains(&self.app.frame_limit) {
            return Err(Invalid::FrameLimit(self.app.frame_limit));
        }
        if self.saved_configs.is_empty() {
            return Err(Invalid::NoSavedConfig);
        }
        let mut ids = HashSet::new();
        for saved in &self.saved_configs {
            if !ids.insert(saved.id.as_str()) {
                return Err(Invalid::DuplicateSavedConfigId(saved.id.clone()));
            }
            saved.config.validate()?;
        }
        if !ids.contains(self.active_config_id.as_str()) {
            return Err(Invalid::ActiveConfigMissing(self.active_config_id.clone()));
        }
        self.current.validate()
    }
}
