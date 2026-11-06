// 単体テスト用のモジュールの定義（描画はしない）。

import type { ModuleKind, ModuleOptions } from "./options";
import type { DefaultInstanceSpec, ModuleDefinition } from "./types";

const noopRenderer = { resize() {}, draw() {}, dispose() {} };

export function testDefinition<K extends ModuleKind>(
  kind: K,
  defaultOptions: ModuleOptions[K],
  defaultInstances: DefaultInstanceSpec<K>[] = [{ enabled: true }],
  baseDirection: ModuleDefinition<K>["baseDirection"] = null,
): ModuleDefinition<K> {
  return {
    kind,
    labelKey: "modules.level",
    shape: "free",
    baseDirection,
    flows: false,
    sections: [],
    defaultOptions,
    inspectorFields: [],
    defaultInstances,
    createRenderer: () => noopRenderer,
  };
}
