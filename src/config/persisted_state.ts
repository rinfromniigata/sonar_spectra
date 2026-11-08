// 既定の状態（imple 5.2 の1）と、復元した状態の整え直し。
// - 既定の状態：既定の構成を作り、保存済みの構成「既定」としてその写しを1件置き、使用中にする
// - 整え直し：保存したあとでモジュールの設定項目が増えても読めるよう、各インスタンスの options に
//   モジュールの定義の既定値を補う（知らない種類のインスタンスはそのまま残す。格子には置かれない）

import type { ModuleKind } from "../modules/options";
import type { ModuleRegistry } from "../modules/registry";
import type { ModuleDefinition } from "../modules/types";
import { createDefaultInstances, createInstanceId } from "./default_instances";
import { STATE_SCHEMA, type Config, type Instance, type PersistedState, type SavedConfig } from "./types";

/** 新しい構成の ID */
export function createConfigId(): string {
  return crypto.randomUUID();
}

/** 既定の構成：自動配置、テーマはダーク、走査線はオン、常に最前面と起動時の全画面はオフ（SPEC 3節） */
export function createDefaultConfig(registry: ModuleRegistry, newId: () => string = createInstanceId): Config {
  return {
    layout: { mode: "auto", instances: createDefaultInstances(registry, newId) },
    customPalettes: [],
    theme: "dark",
    display: { scanline: true, alwaysOnTop: false, startFullscreen: false },
  };
}

export interface DefaultStateOptions {
  registry: ModuleRegistry;
  /** 保存済みの構成「既定」の名前（辞書の config.default_name） */
  defaultName: string;
  now?: () => Date;
  newConfigId?: () => string;
  newInstanceId?: () => string;
}

/** 初めての起動の状態 */
export function createDefaultState(options: DefaultStateOptions): PersistedState {
  const config = createDefaultConfig(options.registry, options.newInstanceId);
  const saved: SavedConfig = {
    ...structuredClone(config),
    id: (options.newConfigId ?? createConfigId)(),
    name: options.defaultName,
    savedAt: (options.now?.() ?? new Date()).toISOString(),
  };
  return {
    schema: STATE_SCHEMA,
    current: config,
    activeConfigId: saved.id,
    dirty: false,
    savedConfigs: [saved],
    source: { deviceId: null },
  };
}

function normalizeInstance(instance: Instance, registry: ModuleRegistry): Instance {
  const definition = registry.get(instance.kind) as ModuleDefinition<ModuleKind> | undefined;
  if (!definition) return instance;
  return { ...instance, options: { ...definition.defaultOptions, ...instance.options } } as Instance;
}

function normalizeConfig<C extends Config>(config: C, registry: ModuleRegistry): C {
  return {
    ...config,
    layout: { ...config.layout, instances: config.layout.instances.map((i) => normalizeInstance(i, registry)) },
  };
}

/** 復元した状態の各構成に、モジュールの設定の既定値を補う */
export function normalizeState(state: PersistedState, registry: ModuleRegistry): PersistedState {
  return {
    ...state,
    current: normalizeConfig(state.current, registry),
    savedConfigs: state.savedConfigs.map((c) => normalizeConfig(c, registry)),
  };
}
