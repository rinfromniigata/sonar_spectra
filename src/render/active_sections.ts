// 有効なモジュールが必要とする解析（セクション）の一覧。Rust の set_active_sections に渡し、
// 使うモジュールが1つもない解析を止める。

import type { Instance } from "../config/types";
import type { ModuleRegistry } from "../modules/registry";

/** 有効なインスタンスの定義が持つセクションの和（重なりなし、昇順） */
export function activeSections(instances: readonly Instance[], registry: ModuleRegistry): number[] {
  const ids = new Set<number>();
  for (const instance of instances) {
    if (!instance.enabled) continue;
    for (const id of registry.get(instance.kind)?.sections ?? []) ids.add(id);
  }
  return [...ids].sort((a, b) => a - b);
}
