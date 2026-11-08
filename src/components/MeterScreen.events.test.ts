import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 子のコンポーネントを、組み立てのときに決めたイベントを出すだけの代役に替え、
// MeterScreen がイベントを設定パネルの開閉・デバイスの切り替えにつないでいることを確かめる（DOM なしで確かめるため）
const plan = vi.hoisted(() => ({
  titleBar: [] as ("settings" | "source" | "fullscreen")[],
  overlaySettings: false,
  drawerDevice: undefined as string | null | undefined,
}));

vi.mock("./TitleBar.vue", async () => {
  const vue = await import("vue");
  return {
    default: vue.defineComponent({
      emits: ["settings", "source", "layoutEdit", "fullscreen"],
      setup(_, { emit }) {
        for (const event of plan.titleBar) emit(event);
        return () => vue.h("header", { class: "title-bar" });
      },
    }),
  };
});
vi.mock("./StatusOverlay.vue", async () => {
  const vue = await import("vue");
  return {
    default: vue.defineComponent({
      emits: ["openSettings"],
      setup(_, { emit }) {
        if (plan.overlaySettings) emit("openSettings");
        return () => vue.h("div", { class: "status-overlay" });
      },
    }),
  };
});
vi.mock("./SettingsDrawer.vue", async () => {
  const vue = await import("vue");
  return {
    default: vue.defineComponent({
      emits: ["selectDevice"],
      setup(_, { emit }) {
        if (plan.drawerDevice !== undefined) emit("selectDevice", plan.drawerDevice);
        return () => vue.h("aside", { class: "settings-drawer" });
      },
    }),
  };
});

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => invoke(command, args),
  Channel: class {},
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.1.0") }));
vi.mock("../theme/canvas_colors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../theme/canvas_colors")>()),
  readDocumentCanvasColors: () => ({ theme: "dark" }),
  watchCanvasColors: () => () => {},
}));

import { RUNTIME_STORE_KEY, createRuntimeStore, type RuntimeStore } from "../app/runtime_store";
import { CONFIG_STORE_KEY, createConfigStore, type ConfigStore } from "../config/config_store";
import { createDefaultState } from "../config/persisted_state";
import { i18n } from "../i18n";
import { moduleRegistry } from "../modules";
import { WINDOW_CONTROLLER_KEY, type WindowController } from "../window";
import MeterScreen from "./MeterScreen.vue";

const toggles = { count: 0 };
const windowController: WindowController = {
  start: () => Promise.resolve(),
  toggleFullscreen: () => {
    toggles.count++;
    return Promise.resolve();
  },
  leaveFullscreenForClose: () => Promise.resolve(),
  dispose: () => {},
};

async function render(runtime: RuntimeStore): Promise<ConfigStore> {
  const config = createConfigStore({
    persistence: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    createDefault: () => createDefaultState({ registry: moduleRegistry, defaultName: "既定" }),
  });
  const app = createSSRApp(defineComponent({ render: () => h(MeterScreen) }));
  app.use(i18n);
  app.provide(CONFIG_STORE_KEY, config);
  app.provide(RUNTIME_STORE_KEY, runtime);
  app.provide(WINDOW_CONTROLLER_KEY, windowController);
  await renderToString(app);
  return config;
}

describe("MeterScreen のイベントのつながり", () => {
  beforeEach(() => {
    plan.titleBar = [];
    plan.overlaySettings = false;
    plan.drawerDevice = undefined;
    toggles.count = 0;
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("タイトル帯の設定ボタンで設定パネルを開き、もう1度押すと閉じる", async () => {
    plan.titleBar = ["settings"];
    const once = createRuntimeStore();
    await render(once);
    expect(once.drawer.value).toBe("settings");

    plan.titleBar = ["settings", "settings"];
    const twice = createRuntimeStore();
    await render(twice);
    expect(twice.drawer.value).toBeNull();
  });

  it("タイトル帯の全画面ボタンで、ウィンドウの扱いの全画面の切り替えを呼ぶ", async () => {
    plan.titleBar = ["fullscreen", "fullscreen"];
    await render(createRuntimeStore());
    expect(toggles.count).toBe(2);
  });

  it("出力系統のチップは設定パネルを開く（開いていれば開いたまま）", async () => {
    plan.titleBar = ["source", "source"];
    const runtime = createRuntimeStore();
    await render(runtime);
    expect(runtime.drawer.value).toBe("settings");
  });

  it("S01c の「設定」は設定パネルを開く", async () => {
    plan.overlaySettings = true;
    const runtime = createRuntimeStore();
    await render(runtime);
    expect(runtime.drawer.value).toBe("settings");
  });

  it("設定パネルで選んだ出力デバイスを保存し、select_output_device で切り替える。「保存後に変更あり」にはしない", async () => {
    plan.drawerDevice = "{dev-1}";
    const runtime = createRuntimeStore();
    runtime.openDrawer("settings");
    const config = await render(runtime);
    expect(config.deviceId.value).toBe("{dev-1}");
    expect(config.dirty.value).toBe(false);
    expect(invoke).toHaveBeenCalledWith("select_output_device", { deviceId: "{dev-1}" });
  });
});
