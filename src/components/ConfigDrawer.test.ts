import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }));

import { RUNTIME_STORE_KEY, createRuntimeStore, type RuntimeStore } from "../app/runtime_store";
import { CONFIG_STORE_KEY, createConfigStore, type ConfigStore } from "../config/config_store";
import { createDefaultState } from "../config/persisted_state";
import { formatDate } from "../i18n/format";
import { i18n } from "../i18n";
import ja from "../i18n/locales/ja";
import { moduleRegistry } from "../modules";
import { createConfigManager, type ConfigManager } from "./config_manager";
import ConfigDrawer from "./ConfigDrawer.vue";

const SAVED_AT = "2026-11-04T03:00:00.000Z";

/** 「既定」（自動配置・使用中）と「クラブ用」（手動配置・有効なモジュール2つ）の構成のストア */
function configStore(): ConfigStore {
  let n = 0;
  const store = createConfigStore({
    persistence: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    createDefault: () => createDefaultState({ registry: moduleRegistry, defaultName: "既定", newConfigId: () => "c-default", now: () => new Date(SAVED_AT) }),
    newConfigId: () => `c-${++n}`,
    now: () => new Date(SAVED_AT),
  });
  store.updateCurrent((c) => {
    c.layout.mode = "manual";
    c.layout.instances.forEach((instance, index) => {
      instance.enabled = index < 2;
      instance.rect = index < 2 ? { c: 1 + index * 6, r: 1, cs: 6, rs: 8 } : null;
    });
  });
  store.saveAs("クラブ用");
  store.switchConfig("c-default");
  return store;
}

function managerFor(config: ConfigStore): ConfigManager {
  return createConfigManager({
    config,
    names: { copy: (name) => `${name}のコピー`, filterName: () => "f", fallbackFileName: () => "x" },
  });
}

async function render(config: ConfigStore, options: { runtime?: RuntimeStore; manager?: ConfigManager } = {}): Promise<string> {
  const app = createSSRApp({ render: () => h(ConfigDrawer, { manager: options.manager }) });
  app.use(i18n);
  app.provide(CONFIG_STORE_KEY, config);
  app.provide(RUNTIME_STORE_KEY, options.runtime ?? createRuntimeStore());
  return renderToString(app);
}

/** 一覧の行：ID・名前・使用中・説明・削除できるか */
function rows(html: string) {
  return [...html.matchAll(/<li class="([^"]*)"[^>]*data-config-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({
    id: m[2],
    name: /<button[^>]*class="row-name[^"]*"[^>]*>([^<]*)<\/button>/.exec(m[3])![1].trim(),
    active: m[1].split(" ").includes("is-picked") && m[3].includes(`>${ja.config.in_use}</span>`),
    meta: /<span class="meta"[^>]*>([^<]*)<\/span>/.exec(m[3])![1],
    removable: !new RegExp(`aria-label="${ja.common.delete}"[^>]*disabled`).test(m[3]),
  }));
}

describe("ConfigDrawer", () => {
  it("見出しは「構成の管理」。説明 → 一覧 →「名前を付けて保存」「ファイルから読み込む」の順", async () => {
    const html = await render(configStore());
    expect(html).toContain(`>${ja.config.title}</h2>`);
    const order = [ja.config.hint, "data-config-id", `>${ja.config.save_as}<`, `>${ja.config.import}<`].map((text) => html.indexOf(text));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("一覧：名前・使用中・配置の種類とモジュール数（有効なもの）と保存日。使用中の構成は削除できない", async () => {
    const html = await render(configStore());
    const date = formatDate(SAVED_AT);
    expect(rows(html)).toEqual([
      {
        id: "c-default",
        name: "既定",
        active: true,
        meta: `${ja.layout_edit.mode_auto}・モジュール7・${date}`,
        removable: false,
      },
      {
        id: "c-1",
        name: "クラブ用",
        active: false,
        meta: `${ja.layout_edit.mode_manual}・モジュール2・${date}`,
        removable: true,
      },
    ]);
  });

  it("行の名前は、その構成に切り替えるボタン（読み上げは「{name}に切り替える」）。書き出し・複製・削除のボタンを持つ", async () => {
    const html = await render(configStore());
    const row = /data-config-id="c-1"[\s\S]*?<\/li>/.exec(html)![0];
    expect(row).toContain(`aria-label="${ja.config.switch_to.replace("{name}", "クラブ用")}"`);
    for (const label of [ja.config.export, ja.common.duplicate, ja.common.delete]) expect(row).toContain(`aria-label="${label}"`);
  });

  it("変更があるときの切り替えでは、確認（上書き・別の名前で保存・破棄・キャンセル）を出す", async () => {
    const config = configStore();
    config.updateCurrent((c) => {
      c.theme = "light";
    });
    const manager = managerFor(config);
    manager.requestSwitch("c-1");
    const html = await render(config, { manager });
    const confirm = /<section[^>]*class="inline confirm"[\s\S]*?<\/section>/.exec(html)![0];
    expect(confirm).toContain(ja.config.confirm_switch.replace("{name}", "クラブ用"));
    const buttons = [...confirm.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<!--[\s\S]*?-->/g, ""));
    expect(buttons).toEqual([
      ja.config.confirm_overwrite.replace("{name}", "既定"),
      ja.config.confirm_save_as,
      ja.config.confirm_discard,
      ja.common.cancel,
    ]);
  });

  it("名前の入力は、ラベルつきの入力欄（初めの値は「{使用中の名前}のコピー」）と保存・キャンセル。確認の代わりに出す", async () => {
    const config = configStore();
    const manager = managerFor(config);
    manager.startSaveAs();
    const html = await render(config, { manager });
    expect(html).not.toContain("inline confirm");
    const form = /<form[^>]*class="inline name-form"[\s\S]*?<\/form>/.exec(html)![0];
    const label = new RegExp(`<label class="label"[^>]*for="([^"]+)"[^>]*>${ja.config.name}</label>`).exec(form)!;
    expect(form).toMatch(new RegExp(`<input id="${label[1]}"[^>]*value="既定のコピー"`));
    expect(form).toContain(`>${ja.common.save}<`);
    expect(form).toContain(`>${ja.common.cancel}<`);
  });

  it("お知らせを出す（書き出し・読み込みの結果）。失敗は強調する", async () => {
    const config = configStore();
    const manager = managerFor(config);
    manager.notice.value = { kind: "imported", name: "クラブ用" };
    expect(await render(config, { manager })).toMatch(
      new RegExp(`<p class="notice" role="status"[^>]*>${ja.config.imported.replace("{name}", "クラブ用")}</p>`),
    );
    manager.notice.value = { kind: "import_failed" };
    const failed = new RegExp(`<p class="([^"]*)" role="status"[^>]*>${ja.config.import_failed}</p>`).exec(await render(config, { manager }))!;
    expect(failed[1].split(" ").sort()).toEqual(["is-error", "notice"]);
  });

  it("見出しのボタンは、設定パネルから開いたときは「戻る」、そうでなければ「閉じる」", async () => {
    const headButton = (html: string) =>
      /<header[^>]*>[\s\S]*?<button[^>]*>([\s\S]*?)<\/button>/.exec(html)![1].replace(/<!--[\s\S]*?-->/g, "");
    const back = createRuntimeStore();
    back.openDrawer("configs", "settings");
    expect(headButton(await render(configStore(), { runtime: back }))).toBe(ja.common.back);
    expect(headButton(await render(configStore()))).toBe(ja.common.close);
  });
});
