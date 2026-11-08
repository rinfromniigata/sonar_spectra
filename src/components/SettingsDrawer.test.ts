import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve([]) }));

import { RUNTIME_STORE_KEY, createRuntimeStore } from "../app/runtime_store";
import { CONFIG_STORE_KEY, createConfigStore, type ConfigStore } from "../config/config_store";
import { createDefaultState } from "../config/persisted_state";
import type { PersistedState } from "../config/types";
import { i18n } from "../i18n";
import ja from "../i18n/locales/ja";
import { moduleRegistry } from "../modules";
import SettingsDrawer from "./SettingsDrawer.vue";

function configStore(edit?: (state: PersistedState) => void): ConfigStore {
  return createConfigStore({
    persistence: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    createDefault: () => {
      const state = createDefaultState({ registry: moduleRegistry, defaultName: "既定" });
      edit?.(state);
      return state;
    },
  });
}

async function render(config: ConfigStore = configStore()): Promise<string> {
  const app = createSSRApp({ render: () => h(SettingsDrawer) });
  app.use(i18n);
  app.provide(CONFIG_STORE_KEY, config);
  app.provide(RUNTIME_STORE_KEY, createRuntimeStore());
  return renderToString(app);
}

/** セレクトの選択肢（スコープ付きのスタイルの属性を挟んでもよい） */
function option(value: string, label: string, selected: boolean): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`<option value="${escaped}"(?: data-v-\\w+)*${selected ? " selected" : ""}>${label}</option>`);
}

/** 欄の見出し（legend）を上から順に */
function legends(html: string): string[] {
  return [...html.matchAll(/<legend class="legend"[^>]*>([^<]*)<\/legend>/g)].map((m) => m[1]);
}

describe("SettingsDrawer", () => {
  it("見出しは「設定」。欄はモックの順（構成・入力源・テーマ・配色・レイアウト・表示）で、下に「閉じる」を置く", async () => {
    const html = await render();
    expect(html).toContain(`>${ja.settings.title}</h2>`);
    expect(legends(html)).toEqual([
      ja.config.section,
      ja.settings.source,
      ja.settings.theme,
      ja.settings.palette,
      ja.settings.layout,
      ja.settings.display,
    ]);
    // 見出しの横と、下の帯の2か所
    expect(html.split(`>${ja.common.close}<`).length - 1).toBe(2);
    for (const text of [ja.config.save_as, ja.config.manage, ja.settings.manage_palette, ja.settings.edit_layout, ja.settings.palette_note]) {
      expect(html).toContain(text);
    }
  });

  it("構成の欄：保存済みの構成を選択肢にし、使用中の構成を選ぶ。「保存後に変更あり」は変更があるときだけ出す", async () => {
    const clean = await render(
      configStore((state) => {
        state.savedConfigs.push({ ...structuredClone(state.savedConfigs[0]), id: "c-club", name: "クラブ用" });
        state.activeConfigId = "c-club";
      }),
    );
    const defaultId = [...clean.matchAll(/<option value="([^"]+)"[^>]*>既定<\/option>/g)].map((m) => m[1]);
    expect(defaultId).toHaveLength(1);
    expect(clean).toMatch(option(defaultId[0], "既定", false));
    expect(clean).toMatch(option("c-club", "クラブ用", true));
    expect(clean).not.toContain(ja.config.modified);

    const store = configStore();
    store.updateCurrent((c) => {
      c.theme = "light";
    });
    expect(await render(store)).toContain(ja.config.modified);
  });

  it("入力源の欄：出力音声（ループバック）を選び、出力デバイスのセレクトは既定のデバイス。入力デバイスは「今後対応」で無効", async () => {
    const html = await render();
    expect(html).toMatch(/<label class="option is-checked"[^>]*><input class="radio ui-focusable" type="radio" name="[^"]+" checked/);
    expect(html).toContain(ja.settings.source_loopback);
    expect(html).toContain(ja.settings.source_loopback_desc);
    expect(html).toMatch(new RegExp(`aria-label="${ja.settings.source_device}"`));
    expect(html).toMatch(option("", ja.settings.source_device_default_plain, true));
    expect(html).toMatch(/<label class="option is-disabled"[^>]*><input class="radio" type="radio" name="[^"]+" disabled/);
    expect(html).toMatch(new RegExp(`<span class="badge"[^>]*>${ja.settings.coming_soon}</span>`));
  });

  it("選んでいるデバイスがまだ一覧にないときは、「見つからないデバイス」として選んだままにする", async () => {
    const html = await render(
      configStore((state) => {
        state.source.deviceId = "{dev-1}";
      }),
    );
    expect(html).toMatch(option("{dev-1}", ja.settings.source_device_missing, true));
    expect(html).toMatch(option("", ja.settings.source_device_default_plain, false));
  });

  it("テーマと表示の切り替えは、今の構成の値を映す", async () => {
    const dark = await render();
    expect(dark).toMatch(new RegExp(`aria-pressed="true"[^>]*>${ja.settings.theme_dark}<`));
    expect(dark).toMatch(new RegExp(`data-setting="scanline"[\\s\\S]*?aria-checked="true"`));
    expect(dark).toMatch(new RegExp(`data-setting="alwaysOnTop"[\\s\\S]*?aria-checked="false"`));
    expect(dark).toMatch(new RegExp(`data-setting="startFullscreen"[\\s\\S]*?aria-checked="false"`));

    const store = configStore();
    store.updateCurrent((c) => {
      c.theme = "system";
      c.display = { scanline: false, alwaysOnTop: true, startFullscreen: true };
    });
    const changed = await render(store);
    expect(changed).toMatch(new RegExp(`aria-pressed="true"[^>]*>${ja.settings.theme_system}<`));
    expect(changed).toMatch(new RegExp(`data-setting="scanline"[\\s\\S]*?aria-checked="false"`));
    expect(changed).toMatch(new RegExp(`data-setting="alwaysOnTop"[\\s\\S]*?aria-checked="true"`));
    expect(changed).toMatch(new RegExp(`data-setting="startFullscreen"[\\s\\S]*?aria-checked="true"`));
  });
});
