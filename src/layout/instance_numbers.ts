// 同じ種類のインスタンスの番号（見出しの「位相 2」の 2、置いたモジュールの一覧）。
// 並びは構成のインスタンスの順で、無効なものも数える（有効・無効を切り替えても番号が変わらないように）。

import type { Instance } from "../config/types";

/** インスタンスのID → 同じ種類の中での番号（1始まり） */
export function instanceNumbers(instances: readonly Instance[]): Map<string, number> {
  const counts = new Map<string, number>();
  const numbers = new Map<string, number>();
  for (const instance of instances) {
    const next = (counts.get(instance.kind) ?? 0) + 1;
    counts.set(instance.kind, next);
    numbers.set(instance.id, next);
  }
  return numbers;
}
