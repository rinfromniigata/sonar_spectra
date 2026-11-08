// インスタンスの設定に出す項目（定義の inspectorFields）のうち、今の設定で出すものを選ぶ。
// 例：「今の波形を表示」がオフのときは境目を出さない。位相はリサージュのとき点描、周波数別の定位のときモーションブラーを出す。

import type { InspectorField } from "./types";

/** 今の設定で出す項目（定義の並びのまま） */
export function visibleFields<O extends object>(
  fields: readonly InspectorField<O>[],
  options: O,
): InspectorField<O>[] {
  const values = options as Record<string, unknown>;
  return fields.filter((field) => !field.visibleWhen || values[field.visibleWhen.key] === field.visibleWhen.equals);
}
