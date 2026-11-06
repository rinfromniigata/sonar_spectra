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

import { i18n } from "../i18n";
import MeterScreen from "./MeterScreen.vue";

async function render(): Promise<string> {
  const app = createSSRApp({ render: () => h(MeterScreen) });
  app.use(i18n);
  return renderToString(app);
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

  it("登録されたモジュール（レベル・波形・スペクトラム・位相2つ・スペクトログラム）の既定のインスタンスを、格子の位置に置く", async () => {
    const html = await render();
    const frames = [...html.matchAll(/<section[^>]*data-kind="(\w+)"[^>]*style="grid-area:([^";]+)/g)].map((m) => [
      m[1],
      m[2].trim(),
    ]);
    expect(frames.map(([kind]) => kind)).toEqual(["level", "wave", "spec", "stereo", "gram", "stereo"]);
    for (const [, area] of frames) expect(area).toMatch(/^\d+ \/ \d+ \/ span \d+ \/ span \d+$/);
    // 2つの位相は別の位置に置く（2つ目は周波数別の定位の専用の位置）
    const stereoAreas = frames.filter(([kind]) => kind === "stereo").map(([, area]) => area);
    expect(new Set(stereoAreas).size).toBe(2);
  });

  it("起動時に source-status の listen を始め、必要な解析（レベル・波形・スペクトラム・位相。スペクトログラムはスペクトラムを使う）を Rust に伝える", async () => {
    await render();
    expect(listen).toHaveBeenCalledWith("source-status", expect.any(Function));
    expect(invoke).toHaveBeenCalledWith("set_active_sections", { ids: [1, 2, 3, 4] });
  });
});
