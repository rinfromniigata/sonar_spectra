import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 子のコンポーネントを、組み立てのときに決めたイベントを出すだけの代役に替え、
// MeterScreen がイベントを設定パネルの開閉・デバイスの切り替えにつないでいることを確かめる（DOM なしで確かめるため）
const plan = vi.hoisted(() => ({
  titleBar: [] as ("settings" | "source" | "fullscreen" | "layoutEdit")[],
  overlaySettings: false,
  drawerDevice: undefined as string | null | undefined,
  drawerEditLayout: false,
  gridSelect: null as string | null,
  gridUpdate: null as unknown[] | null,
  panel: [] as ("autoArrange" | "done")[],
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
      emits: ["selectDevice", "editLayout"],
      setup(_, { emit }) {
        if (plan.drawerDevice !== undefined) emit("selectDevice", plan.drawerDevice);
        if (plan.drawerEditLayout) emit("editLayout");
        return () => vue.h("aside", { class: "settings-drawer" });
      },
    }),
  };
});
vi.mock("./MeterGrid.vue", async () => {
  const vue = await import("vue");
  return {
    default: vue.defineComponent({
      props: ["instances", "mode", "registry", "editing", "selectedId"],
      emits: ["select", "update"],
      setup(_, { emit }) {
        if (plan.gridSelect !== null) emit("select", plan.gridSelect);
        if (plan.gridUpdate !== null) emit("update", plan.gridUpdate);
        return () => vue.h("div", { class: "meter-grid" });
      },
    }),
  };
});
vi.mock("./LayoutEditPanel.vue", async () => {
  const vue = await import("vue");
  return {
    default: vue.defineComponent({
      props: ["mode"],
      emits: ["autoArrange", "done"],
      setup(_, { emit }) {
        for (const event of plan.panel) emit(event);
        return () => vue.h("aside", { class: "layout-edit-panel" });
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
    plan.drawerEditLayout = false;
    plan.gridSelect = null;
    plan.gridUpdate = null;
    plan.panel = [];
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

describe("MeterScreen のレイアウト編集のつながり", () => {
  beforeEach(() => {
    plan.titleBar = [];
    plan.overlaySettings = false;
    plan.drawerDevice = undefined;
    plan.drawerEditLayout = false;
    plan.gridSelect = null;
    plan.gridUpdate = null;
    plan.panel = [];
    invoke.mockReset();
    invoke.mockResolvedValue(undefined);
  });

  it("タイトル帯のレイアウト編集ボタンで編集を始め、もう1度押すと終える", async () => {
    plan.titleBar = ["layoutEdit"];
    const once = createRuntimeStore();
    await render(once);
    expect(once.layoutEditing.value).toBe(true);

    plan.titleBar = ["layoutEdit", "layoutEdit"];
    const twice = createRuntimeStore();
    await render(twice);
    expect(twice.layoutEditing.value).toBe(false);
  });

  it("設定パネルの「レイアウトを編集」で、設定パネルを閉じて編集を始める", async () => {
    plan.drawerEditLayout = true;
    const runtime = createRuntimeStore();
    runtime.openDrawer("settings");
    await render(runtime);
    expect(runtime.drawer.value).toBeNull();
    expect(runtime.layoutEditing.value).toBe(true);
  });

  it("格子で選んだモジュールを、実行中の状態のストアに持つ", async () => {
    plan.gridSelect = "x";
    const runtime = createRuntimeStore();
    runtime.setLayoutEditing(true);
    await render(runtime);
    expect(runtime.selectedInstanceId.value).toBe("x");
  });

  it("格子で配置を変えると、手動配置にしてインスタンスの並びを置き換え、「保存後に変更あり」になる", async () => {
    const instances = createDefaultState({ registry: moduleRegistry, defaultName: "既定" }).current.layout.instances.map((i, n) => ({
      ...i,
      rect: i.enabled ? { c: 1 + n, r: 1, cs: 1, rs: 1 } : null,
    }));
    plan.gridUpdate = instances;
    const runtime = createRuntimeStore();
    runtime.setLayoutEditing(true);
    const config = await render(runtime);
    expect(config.current.value.layout.mode).toBe("manual");
    expect(config.current.value.layout.instances).toEqual(instances);
    expect(config.dirty.value).toBe(true);
  });

  it("「自動整列」で自動配置に戻し、位置を捨てる。「完了」で編集を終え、選択を外す", async () => {
    plan.gridUpdate = createDefaultState({ registry: moduleRegistry, defaultName: "既定" }).current.layout.instances.map((i) => ({
      ...i,
      rect: { c: 1, r: 1, cs: 1, rs: 1 },
    }));
    plan.gridSelect = "x";
    plan.panel = ["autoArrange", "done"];
    const runtime = createRuntimeStore();
    runtime.setLayoutEditing(true);
    const config = await render(runtime);
    expect(config.current.value.layout.mode).toBe("auto");
    expect(config.current.value.layout.instances.every((i) => i.rect === null)).toBe(true);
    expect(runtime.layoutEditing.value).toBe(false);
    expect(runtime.selectedInstanceId.value).toBeNull();
  });

  it("自動配置のときの「自動整列」は何も変えない（「保存後に変更あり」にしない）", async () => {
    plan.panel = ["autoArrange"];
    const runtime = createRuntimeStore();
    runtime.setLayoutEditing(true);
    const config = await render(runtime);
    expect(config.current.value.layout.mode).toBe("auto");
    expect(config.dirty.value).toBe(false);
  });
});
