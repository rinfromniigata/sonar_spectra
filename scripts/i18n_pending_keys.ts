// 使用予定のキー。辞書にはあるが、使う画面がまだできていないもの。
// 画面を作ってキーを使い始めたら、ここから外す（外し忘れは bun run check:i18n がエラーにする）。
// 開発時だけの画面（src/dev/）での使用は数えない（dev_gallery.* のキーを除く）。本物の画面で使ったときに外す。
// 初回リリース（0.1.0）の準備までに、この一覧は空になる。
export const PENDING_KEYS: readonly string[] = [
  // Phase 2：タイトル帯・状態の表示・最初のモジュール（T2-10〜T2-14）
  "app.window_title",

  // Phase 3：既定のモジュール一式（T3-2〜T3-5）

  // Phase 4：設定パネルとウィンドウ（T4-2〜T4-6）

  // Phase 5：レイアウト編集（T5-2〜T5-5）
  // 「既定に戻す」（パネルの下の帯）は、何を戻すかが未決定のため、まだ置いていない（T5-3の実施メモ）
  "layout_edit.reset",

  // Phase 6：インスタンスの設定（T6-1〜T6-4）
  "layout_edit.open_instance_settings",

  // Phase 7：配色と構成（T7-2〜T7-5）
  "common.back",
  "palette.title",
  "palette.list",
  "palette.builtin",
  "palette.new",
  "palette.new_name",
  "palette.editing",
  "palette.name",
  "palette.role_main",
  "palette.role_sub",
  "palette.role_accent",
  "palette.light_note",
  "config.title",
  "config.hint",
  "config.in_use",
  "config.export",
  "config.import",
  "config.meta",

  // Phase 8：追加のモジュール（T8-2〜T8-4）
  "modules.vu",
  "modules.chroma",
  "modules.chroma_key",
  "modules.centroid",
];
