import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Tauri の API と、文書を読むトークンの読み出しを差し替える（Node の上で組み立てを確かめる）
const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
const listen = vi.fn<(event: string, handler: unknown) => Promise<() => void>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
  Channel: class {},
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: (event: string, handler: unknown) => listen(event, handler) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.1.0") }));
vi.mock("../theme/canvas_colors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../theme/canvas_colors")>()),
  readDocumentCanvasColors: () => ({ theme: "dark" }),
  watchCanvasColors: () => () => {},
}));

import { RUNTIME_STORE_KEY, createRuntimeStore } from "../app/runtime_store";
import { CONFIG_STORE_KEY, createConfigStore } from "../config/config_store";
import { createDefaultState } from "../config/persisted_state";
import type { Config } from "../config/types";
import { i18n } from "../i18n";
import { moduleRegistry } from "../modules";
import MeterScreen from "./MeterScreen.vue";

/** 既定の状態の構成のストア（recipe で今の構成を変えられる）を provide して組み立てる */
async function render(
  props: { scanline?: boolean } = {},
  recipe?: (config: Config) => void,
  runtime = createRuntimeStore(),
): Promise<string> {
  const config = createConfigStore({
    persistence: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    createDefault: () => createDefaultState({ registry: moduleRegistry, defaultName: "既定" }),
  });
  if (recipe) config.updateCurrent(recipe);
  const app = createSSRApp({ render: () => h(MeterScreen, props) });
  app.use(i18n);
  app.provide(CONFIG_STORE_KEY, config);
  app.provide(RUNTIME_STORE_KEY, runtime);
  return renderToString(app);
}

function placedKinds(html: string): string[] {
  return [...html.matchAll(/<section[^>]*data-kind="(\w+)"/g)].map((m) => m[1]);
}

describe("MeterScreen", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
    listen.mockReset();
    listen.mockResolvedValue(() => {});
  });

  it("タイトル帯・メーターの格子・状態の表示を、この順に重ねて組み立てる", async () => {
    const html = await render();
    const titleBar = html.indexOf("title-bar");
    const grid = html.indexOf("meter-grid");
    const overlay = html.indexOf("status-overlay");
    expect(titleBar).toBeGreaterThan(-1);
    expect(grid).toBeGreaterThan(titleBar);
    expect(overlay).toBeGreaterThan(grid);
    // 状態がまだ届いていないので、起動中として表示する
    expect(html).toContain("is-opening");
    expect(html).toContain("入力源を開いています");
  });

  it("走査線と周辺減光は、画面全体の最後（いちばん上）に重ねる。scanline が false なら出さない", async () => {
    const html = await render();
    const overlay = html.indexOf("status-overlay");
    const crt = html.indexOf("crt-overlay");
    expect(crt).toBeGreaterThan(overlay);
    expect(html.indexOf("crt-overlay", crt + 1)).toBe(-1);

    expect(await render({ scanline: false })).not.toContain("crt-overlay");
  });

  it("登録されたモジュール（レベル・波形・スペクトラム・位相2つ・スペクトログラム・LOUD）の既定のインスタンスを、格子の位置に置く", async () => {
    const html = await render();
    const frames = [...html.matchAll(/<section[^>]*data-kind="(\w+)"[^>]*style="grid-area:([^";]+)/g)].map((m) => [
      m[1],
      m[2].trim(),
    ]);
    expect(frames.map(([kind]) => kind)).toEqual(["level", "wave", "spec", "stereo", "gram", "loud", "stereo"]);
    for (const [, area] of frames) expect(area).toMatch(/^\d+ \/ \d+ \/ span \d+ \/ span \d+$/);
    // 2つの位相は別の位置に置く（2つ目は周波数別の定位の専用の位置）
    const stereoAreas = frames.filter(([kind]) => kind === "stereo").map(([, area]) => area);
    expect(new Set(stereoAreas).size).toBe(2);
  });

  it("構成のストアの今の構成を表示する。無効にしたインスタンスは置かず、手動配置では rect の位置に置く", async () => {
    const html = await render({}, (config) => {
      for (const instance of config.layout.instances) instance.enabled = instance.kind === "level" || instance.kind === "spec";
      config.layout.mode = "manual";
      const [level, , spec] = config.layout.instances;
      level.rect = { c: 1, r: 1, cs: 2, rs: 8 };
      spec.rect = { c: 3, r: 1, cs: 10, rs: 8 };
    });
    expect(placedKinds(html)).toEqual(["level", "spec"]);
    expect(html).toMatch(/data-kind="level"[^>]*style="grid-area:1 \/ 1 \/ span 8 \/ span 2;/);
    expect(html).toMatch(/data-kind="spec"[^>]*style="grid-area:1 \/ 3 \/ span 8 \/ span 10;/);
  });

  it("設定パネル（S02）は、ドロワーが settings のときだけ、状態の表示より上・走査線より下に重ねる", async () => {
    expect(await render()).not.toContain("settings-drawer");
    const runtime = createRuntimeStore();
    runtime.openDrawer("settings");
    const html = await render({}, undefined, runtime);
    const overlay = html.indexOf("status-overlay");
    const drawer = html.indexOf("settings-drawer");
    expect(drawer).toBeGreaterThan(overlay);
    expect(html.indexOf("crt-overlay")).toBeGreaterThan(drawer);
  });

  it("起動時に source-status の listen を始め、必要な解析（レベル・波形・スペクトラム・位相・ラウドネス。スペクトログラムはスペクトラムを使う）を Rust に伝える", async () => {
    await render();
    expect(listen).toHaveBeenCalledWith("source-status", expect.any(Function));
    expect(invoke).toHaveBeenCalledWith("set_active_sections", { ids: [1, 2, 3, 4, 5] });
  });
});
