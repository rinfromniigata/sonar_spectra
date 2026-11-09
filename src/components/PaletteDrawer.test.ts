import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import { RUNTIME_STORE_KEY, createRuntimeStore, type RuntimeStore } from "../app/runtime_store";
import { CONFIG_STORE_KEY, createConfigStore, type ConfigStore } from "../config/config_store";
import { customSwatchColors } from "../config/palettes";
import { createDefaultState } from "../config/persisted_state";
import type { Palette } from "../config/types";
import { i18n } from "../i18n";
import ja from "../i18n/locales/ja";
import { moduleRegistry } from "../modules";
import PaletteDrawer from "./PaletteDrawer.vue";

const MINE: Palette = { id: "custom.mine", name: "マイ配色 1", main: "#b7ff3c", sub: "#8b5cff", accent: "#ffb547" };
const DAWN: Palette = { id: "custom.dawn", name: "夜明け", main: "#ff3d9a", sub: "#3df0ff", accent: "#ffd23d" };

function configStore(customPalettes: Palette[] = []): ConfigStore {
  return createConfigStore({
    persistence: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    createDefault: () => {
      const state = createDefaultState({ registry: moduleRegistry, defaultName: "既定" });
      state.current.customPalettes = customPalettes;
      return state;
    },
  });
}

async function render(config: ConfigStore, runtime: RuntimeStore = createRuntimeStore()): Promise<string> {
  const app = createSSRApp({ render: () => h(PaletteDrawer) });
  app.use(i18n);
  app.provide(CONFIG_STORE_KEY, config);
  app.provide(RUNTIME_STORE_KEY, runtime);
  return renderToString(app);
}

/** 一覧の行：配色ID・名前・「標準」の印・複製と削除のボタンの数・編集中か */
function rows(html: string) {
  return [...html.matchAll(/<li class="([^"]*)"[^>]*data-palette-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({
    id: m[2],
    name: /<span class="name-text"[^>]*>([^<]*)<\/span>/.exec(m[3])![1],
    builtin: m[3].includes(`>${ja.palette.builtin}</span>`),
    duplicate: m[3].split(`aria-label="${ja.common.duplicate}"`).length - 1,
    remove: m[3].split(`aria-label="${ja.common.delete}"`).length - 1,
    picked: m[1].split(" ").includes("is-picked"),
  }));
}

describe("PaletteDrawer", () => {
  it("見出しは「配色の管理」。一覧は標準の3つ（「標準」の印、複製だけ）→ 自分で作った配色（複製・削除）の順で、下に「＋ 配色を作る」", async () => {
    const html = await render(configStore([MINE, DAWN]));
    expect(html).toContain(`>${ja.palette.title}</h2>`);
    expect(html).toContain(`>${ja.palette.list}</h3>`);
    expect(rows(html)).toEqual([
      { id: "preset.a", name: ja.palette.preset_magenta, builtin: true, duplicate: 1, remove: 0, picked: false },
      { id: "preset.b", name: ja.palette.preset_cyan, builtin: true, duplicate: 1, remove: 0, picked: false },
      { id: "preset.c", name: ja.palette.preset_amber, builtin: true, duplicate: 1, remove: 0, picked: false },
      { id: MINE.id, name: MINE.name, builtin: false, duplicate: 1, remove: 1, picked: false },
      { id: DAWN.id, name: DAWN.name, builtin: false, duplicate: 1, remove: 1, picked: false },
    ]);
    expect(html.indexOf(`>${ja.palette.new}<`)).toBeGreaterThan(html.indexOf(DAWN.name));
  });

  it("自分で作った配色だけ、名前が編集を選ぶボタンになる。見本はテーマに合わせた色（light-dark）", async () => {
    const html = await render(configStore([MINE]));
    const row = /data-palette-id="custom\.mine"[\s\S]*?<\/li>/.exec(html)![0];
    expect(row).toMatch(/<button type="button" class="row-name is-button ui-focusable"/);
    const [main, sub] = customSwatchColors(MINE);
    expect(row).toContain(`background:${main}`);
    expect(row).toContain(`background:${sub}`);
    const preset = /data-palette-id="preset\.a"[\s\S]*?<\/li>/.exec(html)![0];
    expect(preset).not.toContain("<button type=\"button\" class=\"row-name");
    expect(preset).toContain("background:var(--color-neon-a)");
  });

  it("編集する配色がなければ編集の欄を出さない", async () => {
    const html = await render(configStore([MINE]));
    expect(html).not.toContain('class="editor"');
    expect(html).not.toContain(ja.palette.light_note);
  });

  it("編集中の配色：行を強調し、「編集中：{name}」・名前・主色・副色・強調色（ダーク用の値）・ライトの注記を出す", async () => {
    const runtime = createRuntimeStore();
    runtime.editPalette(DAWN.id);
    const html = await render(configStore([MINE, DAWN]), runtime);
    expect(rows(html).filter((r) => r.picked).map((r) => r.id)).toEqual([DAWN.id]);

    const editor = /<section[^>]*class="editor"[\s\S]*?<\/section>/.exec(html)![0];
    expect(editor).toContain(`>${ja.palette.editing.replace("{name}", DAWN.name)}</h3>`);
    expect(editor).toMatch(new RegExp(`<label class="label"[^>]*for="([^"]+)"[^>]*>${ja.palette.name}</label>`));
    expect(editor).toMatch(new RegExp(`<input[^>]*type="text"[^>]*value="${DAWN.name}"`));
    const colors = [...editor.matchAll(/data-role="(\w+)"[\s\S]*?<input[^>]*type="color"[^>]*value="([^"]+)"[^>]*aria-label="([^"]+)"[\s\S]*?<code[^>]*>([^<]*)<\/code>/g)].map(
      (m) => [m[1], m[2], m[3], m[4]],
    );
    expect(colors).toEqual([
      ["main", DAWN.main, ja.palette.role_main, DAWN.main],
      ["sub", DAWN.sub, ja.palette.role_sub, DAWN.sub],
      ["accent", DAWN.accent, ja.palette.role_accent, DAWN.accent],
    ]);
    expect(editor).toContain(ja.palette.light_note);
  });

  it("編集中のIDの配色がない（消えた）ときは編集の欄を出さない", async () => {
    const runtime = createRuntimeStore();
    runtime.editPalette("custom.removed");
    expect(await render(configStore([MINE]), runtime)).not.toContain('class="editor"');
  });

  it("見出しのボタンは、設定パネルから開いたときは「戻る」、そうでなければ「閉じる」", async () => {
    /** 見出し（header）のボタンの文言（スロットの印を除く） */
    const headButton = (html: string) =>
      /<header[^>]*>[\s\S]*?<button[^>]*>([\s\S]*?)<\/button>/.exec(html)![1].replace(/<!--[\s\S]*?-->/g, "");

    const back = createRuntimeStore();
    back.openDrawer("palettes", "settings");
    expect(headButton(await render(configStore(), back))).toBe(ja.common.back);

    const plain = createRuntimeStore();
    plain.openDrawer("palettes");
    expect(headButton(await render(configStore(), plain))).toBe(ja.common.close);
  });
});
