// 既定のインスタンスを、レジストリに登録されたモジュールの定義から作る（imple 5.2 の1）。
// 各定義の defaultInstances の1つ目を種類の並び順に置き、2つ目以降（周波数別の定位など）をその後ろに置く。

import type { ModuleKind } from "../modules/options";
import type { ModuleRegistry } from "../modules/registry";
import type { DefaultInstanceSpec, ModuleDefinition } from "../modules/types";
import { DEFAULT_PALETTE_ID } from "./palettes";
import type { Instance, InstanceOf } from "./types";

/** インスタンスのID */
export function createInstanceId(): string {
  return crypto.randomUUID();
}

/** 定義と既定の指定から、インスタンスを1つ作る */
export function createInstance<K extends ModuleKind>(
  definition: ModuleDefinition<K>,
  spec: DefaultInstanceSpec<K>,
  id: string,
): InstanceOf<K> {
  const instance: InstanceOf<K> = {
    id,
    kind: definition.kind,
    enabled: spec.enabled,
    rect: null,
    direction: definition.baseDirection,
    paletteId: DEFAULT_PALETTE_ID,
    sourceId: "default",
    options: { ...definition.defaultOptions, ...spec.options },
  };
  if (spec.slot) instance.slot = spec.slot;
  return instance;
}

/** 既定の構成のインスタンス一式 */
export function createDefaultInstances(registry: ModuleRegistry, newId: () => string = createInstanceId): Instance[] {
  const definitions = registry.list() as ModuleDefinition<ModuleKind>[];
  const primary = definitions.flatMap((d) => d.defaultInstances.slice(0, 1).map((spec) => [d, spec] as const));
  const extra = definitions.flatMap((d) => d.defaultInstances.slice(1).map((spec) => [d, spec] as const));
  return [...primary, ...extra].map(([definition, spec]) => createInstance(definition, spec, newId()) as Instance);
}
