// ストアを作ってアプリに provide する。マウントの前に呼び、保存された状態の復元を待つ
// （既定の状態を一瞬見せてから切り替わらないように）。

import type { App } from "vue";
import { i18n } from "../i18n";
import { loadState, saveState } from "../config/backend";
import { CONFIG_STORE_KEY, createConfigStore, type ConfigStore } from "../config/config_store";
import { createDefaultState, normalizeState } from "../config/persisted_state";
import { moduleRegistry } from "../modules";
import { RUNTIME_STORE_KEY, createRuntimeStore, type RuntimeStore } from "./runtime_store";

export interface AppStores {
  config: ConfigStore;
  runtime: RuntimeStore;
}

/** ロケールを確定したあとに呼ぶ（既定の構成の名前を辞書から引くため） */
export async function setupStores(app: App): Promise<AppStores> {
  const config = createConfigStore({
    persistence: { load: loadState, save: saveState },
    createDefault: () =>
      createDefaultState({ registry: moduleRegistry, defaultName: i18n.global.t("config.default_name") }),
    normalize: (state) => normalizeState(state, moduleRegistry),
  });
  const runtime = createRuntimeStore();
  await config.restore();
  app.provide(CONFIG_STORE_KEY, config);
  app.provide(RUNTIME_STORE_KEY, runtime);
  return { config, runtime };
}
