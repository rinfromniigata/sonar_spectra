import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

// W4-2：設定を変えて再起動すると引き継がれる。invoke を「ファイル」に見立てた保存先に差し替え、
// アプリを2回起動する（setupStores → bindTheme → 画面の組み立て）。1回目の保存を2回目の load_state が返す。
const disk = vi.hoisted(() => ({ file: null as unknown, invoked: [] as { command: string; args: unknown }[] }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args?: unknown) => {
    disk.invoked.push({ command, args });
    if (command === "load_state") return Promise.resolve(disk.file === null ? null : structuredClone(disk.file));
    if (command === "save_state") {
      disk.file = structuredClone((args as { state: unknown }).state);
      return Promise.resolve();
    }
    return Promise.resolve(undefined);
  },
  Channel: class {},
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("0.1.0") }));
vi.mock("../theme/canvas_colors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../theme/canvas_colors")>()),
  readDocumentCanvasColors: () => ({ theme: "dark" }),
  watchCanvasColors: () => () => {},
}));

import MeterScreen from "../components/MeterScreen.vue";
import { createDeviceSelection } from "../source";
import { applyTheme, bindTheme, type ThemeRoot } from "../theme/apply_theme";
import { WINDOW_CONTROLLER_KEY, type WindowController } from "../window";
import { i18n } from "../i18n";
import type { PersistedState } from "../config/types";
import { setupStores } from "./stores";

const windowController: WindowController = {
  start: () => Promise.resolve(),
  toggleFullscreen: () => Promise.resolve(),
  leaveFullscreenForClose: () => Promise.resolve(),
  dispose: () => {},
};

/** アプリを1回起動する：ストアの復元 → テーマの反映 → 画面の組み立て */
async function launch() {
  const root: ThemeRoot = { dataset: { theme: "dark" } };
  const app = createSSRApp(defineComponent({ render: () => h(MeterScreen) }));
  app.use(i18n);
  app.provide(WINDOW_CONTROLLER_KEY, windowController);
  const stores = await setupStores(app);
  bindTheme(stores.config, root);
  disk.invoked.length = 0;
  const html = await renderToString(app);
  return { ...stores, root, html, invoked: [...disk.invoked] };
}

describe("W4-2 再起動での引き継ぎ", () => {
  beforeEach(() => {
    disk.file = null;
    disk.invoked.length = 0;
  });

  it("初回起動で、保存済みの構成「既定」ができて保存される（ダーク・走査線オン・既定のデバイス）", async () => {
    const first = await launch();
    const saved = disk.file as PersistedState;
    expect(saved.savedConfigs.map((c) => c.name)).toEqual(["既定"]);
    expect(saved.activeConfigId).toBe(saved.savedConfigs[0].id);
    expect(saved.dirty).toBe(false);
    expect(first.root.dataset.theme).toBe("dark");
    expect(first.html).toContain("crt-overlay");
    expect(saved.source.deviceId).toBeNull();
  });

  it("テーマ・走査線・入力源のデバイスを変えて再起動すると、すべて引き継がれる", async () => {
    const first = await launch();
    // 設定パネルの操作と同じ経路：テーマ・表示は updateCurrent、デバイスは createDeviceSelection.choose
    first.config.updateCurrent((c) => {
      c.theme = "light";
    });
    first.config.updateCurrent((c) => {
      c.display.scanline = false;
    });
    createDeviceSelection(first.config, () => Promise.resolve()).choose("{dev-usb}");
    await first.config.flush(); // 終了時の保存（閉じる前の後始末）
    const saved = disk.file as PersistedState;
    expect(saved.current.theme).toBe("light");
    expect(saved.current.display.scanline).toBe(false);
    expect(saved.source.deviceId).toBe("{dev-usb}");

    disk.invoked.length = 0;
    const second = await launch();
    expect(second.config.current.value.theme).toBe("light");
    expect(second.root.dataset.theme).toBe("light"); // 最初の表示の前に data-theme へ反映される
    expect(second.config.current.value.display.scanline).toBe(false);
    expect(second.html).not.toContain("crt-overlay");
    expect(second.config.deviceId.value).toBe("{dev-usb}");
    // 変更ありの印と、保存済みの構成（変更前の「既定」）も引き継がれる
    expect(second.config.dirty.value).toBe(true);
    expect(second.config.activeConfig.value?.name).toBe("既定");
    expect(second.config.activeConfig.value?.theme).toBe("dark");
    // 復元しただけでは保存し直さない
    expect(disk.invoked.filter((i) => i.command === "save_state")).toEqual([]);
  });

  it("再起動で、保存した入力源のデバイスを start_stream の前に選び直す", async () => {
    const first = await launch();
    createDeviceSelection(first.config, () => Promise.resolve()).choose("{dev-usb}");
    await first.config.flush();

    const second = await launch();
    const select = vi.fn<(id: string | null) => Promise<void>>(() => Promise.resolve());
    await createDeviceSelection(second.config, select).restore();
    expect(select).toHaveBeenCalledWith("{dev-usb}");
  });

  it("「OS設定」も引き継がれ、再起動で data-theme が外れる", async () => {
    const first = await launch();
    first.config.updateCurrent((c) => {
      c.theme = "system";
    });
    await first.config.flush();
    const second = await launch();
    expect(second.config.current.value.theme).toBe("system");
    expect("theme" in second.root.dataset).toBe(false);
    // 実際の文書への反映も同じ関数
    const doc: ThemeRoot = { dataset: { theme: "dark" } };
    applyTheme(second.config.current.value.theme, doc);
    expect("theme" in doc.dataset).toBe(false);
  });
});
