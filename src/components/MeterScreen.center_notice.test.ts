import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it, vi } from "vitest";

// MeterGrid が描画の層の状態を知らせたあと、MeterScreen が入力源の状態の表示（StatusOverlay）を出し分けることを確かめる。
// MeterGrid は、決めた状態を知らせるだけの代役にする。SSR は、格子のあとに並ぶ StatusOverlay を、格子の通知のあとに評価する。
// （格子の中の「描画を開始できません」を出すか〔showRenderUnavailable〕は、SSR では通知より前に決まってしまうため、
//   出し分けの判定そのものを source_status.test.ts の centerNotice で確かめている）

const plan = vi.hoisted(() => ({ renderUnavailable: false }));

vi.mock("../i18n/use_t", () => ({ useT: () => ({ t: (key: string) => key }) }));
vi.mock("./TitleBar.vue", () => ({ default: { render: () => null } }));
vi.mock("./CrtOverlay.vue", () => ({ default: { render: () => null } }));
vi.mock("./StatusOverlay.vue", async () => {
  const vue = await import("vue");
  return { default: vue.defineComponent({ emits: ["openSettings"], setup: () => () => vue.h("div", { class: "status-overlay" }) }) };
});
vi.mock("./MeterGrid.vue", async () => {
  const vue = await import("vue");
  return {
    default: vue.defineComponent({
      props: ["instances", "mode", "registry", "editing", "selectedId", "customPalettes", "showRenderUnavailable"],
      emits: ["select", "update", "direction", "settings", "renderUnavailable"],
      setup(_props, { emit }) {
        emit("renderUnavailable", plan.renderUnavailable);
        return () => vue.h("div", { class: "meter-grid" });
      },
    }),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: () => Promise.resolve(undefined), Channel: class {} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.1.0") }));
vi.mock("../theme/canvas_colors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../theme/canvas_colors")>()),
  readDocumentCanvasColors: () => ({ theme: "dark" }),
  watchCanvasColors: () => () => {},
}));

import { RUNTIME_STORE_KEY, createRuntimeStore } from "../app/runtime_store";
import { CONFIG_STORE_KEY, createConfigStore } from "../config/config_store";
import { createDefaultState } from "../config/persisted_state";
import { moduleRegistry } from "../modules";
import type { SourceStatus } from "../source";
import { WINDOW_CONTROLLER_KEY, type WindowController } from "../window";
import MeterScreen from "./MeterScreen.vue";

const windowController: WindowController = {
  start: () => Promise.resolve(),
  toggleFullscreen: () => Promise.resolve(),
  leaveFullscreenForClose: () => Promise.resolve(),
  dispose: () => {},
};

/** 格子が描画の層の状態を知らせたあと、入力源の状態の表示が出ているか */
async function overlayShown(status: SourceStatus | null, renderUnavailable: boolean): Promise<boolean> {
  plan.renderUnavailable = renderUnavailable;
  const runtime = createRuntimeStore();
  runtime.source.value = status ? { status, device: null } : null;
  const config = createConfigStore({
    persistence: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    createDefault: () => createDefaultState({ registry: moduleRegistry, defaultName: "既定" }),
  });
  const app = createSSRApp(defineComponent({ render: () => h(MeterScreen) }));
  app.provide(CONFIG_STORE_KEY, config);
  app.provide(RUNTIME_STORE_KEY, runtime);
  app.provide(WINDOW_CONTROLLER_KEY, windowController);
  return (await renderToString(app)).includes("status-overlay");
}

describe("MeterScreen：描画を開始できない表示と入力源の状態の表示は、中央に1つだけ出す（S01）", () => {
  it("描画の層が使えるとき：取得中は何も出さず、無音・使えない・開いている途中は入力源の表示を出す", async () => {
    expect(await overlayShown({ state: "live" }, false)).toBe(false);
    expect(await overlayShown({ state: "silent" }, false)).toBe(true);
    expect(await overlayShown({ state: "unavailable", reason: "inUse" }, false)).toBe(true);
    expect(await overlayShown({ state: "opening" }, false)).toBe(true);
  });

  it("無音（S01b）：描画を開始できないときは、無音の表示を出さない（描画を開始できない表示だけになる）", async () => {
    expect(await overlayShown({ state: "silent" }, true)).toBe(false);
  });

  it("使えない（S01c）・開いている途中（S01d。状態が未着の起動直後を含む）：入力源の表示を出す", async () => {
    expect(await overlayShown({ state: "unavailable", reason: "inUse" }, true)).toBe(true);
    expect(await overlayShown({ state: "opening" }, true)).toBe(true);
    expect(await overlayShown(null, true)).toBe(true);
  });

  it("取得中でも描画を開始できなければ、入力源の表示は出さない", async () => {
    expect(await overlayShown({ state: "live" }, true)).toBe(false);
  });
});
