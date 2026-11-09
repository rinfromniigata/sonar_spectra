import { describe, expect, it, vi } from "vitest";
import { createConfigStore, type ConfigStore } from "../config/config_store";
import { buildConfigFile, type ConfigFileIo } from "../config/config_file";
import { createDefaultState } from "../config/persisted_state";
import type { SavedConfig } from "../config/types";
import { moduleRegistry } from "../modules";
import { createConfigManager, type ConfigManager } from "./config_manager";

function fakeIo(overrides: Partial<ConfigFileIo> = {}) {
  const writes: [string, string][] = [];
  const io: ConfigFileIo = {
    chooseSavePath: () => Promise.resolve("C:/out/x.json"),
    chooseOpenPath: () => Promise.resolve("C:/in/x.json"),
    readText: () => Promise.reject(new Error("no file")),
    writeText: (path, text) => {
      writes.push([path, text]);
      return Promise.resolve();
    },
    validate: (text) => Promise.resolve((JSON.parse(text) as { config: SavedConfig }).config),
    ...overrides,
  };
  return { io, writes };
}

interface Setup {
  config: ConfigStore;
  manager: ConfigManager;
  errors: unknown[];
  writes: [string, string][];
}

function setup(io: Partial<ConfigFileIo> = {}): Setup {
  let n = 0;
  const config = createConfigStore({
    persistence: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    createDefault: () => createDefaultState({ registry: moduleRegistry, defaultName: "既定", newConfigId: () => "c-default" }),
    newConfigId: () => `c-${++n}`,
  });
  const errors: unknown[] = [];
  const fake = fakeIo(io);
  const manager = createConfigManager({
    config,
    io: fake.io,
    names: { copy: (name) => `${name}のコピー`, filterName: () => "構成ファイル", fallbackFileName: () => "構成" },
    onError: (error) => errors.push(error),
  });
  return { config, manager, errors, writes: fake.writes };
}

const names = (s: Setup) => s.config.state.value.savedConfigs.map((c) => c.name);

describe("createConfigManager：切り替え", () => {
  it("変更がなければ、確かめずに切り替える", () => {
    const s = setup();
    s.config.saveAs("クラブ用");
    expect(s.manager.requestSwitch("c-default")).toBe("switched");
    expect(s.config.activeConfig.value?.name).toBe("既定");
    expect(s.manager.pendingSwitch.value).toBeNull();
  });

  it("変更があれば確認を出し、上書きか破棄を選ぶと切り替えて確認を閉じる", () => {
    const s = setup();
    s.config.saveAs("クラブ用");
    s.config.updateCurrent((c) => {
      c.theme = "light";
    });
    expect(s.manager.requestSwitch("c-default")).toBe("needsConfirm");
    expect(s.manager.pendingSwitch.value).toEqual({ id: "c-default" });
    expect(s.config.activeConfig.value?.name).toBe("クラブ用");

    s.manager.resolveSwitch("overwrite");
    expect(s.config.activeConfig.value?.name).toBe("既定");
    expect(s.config.state.value.savedConfigs[1].theme).toBe("light");
    expect(s.manager.pendingSwitch.value).toBeNull();

    s.config.updateCurrent((c) => {
      c.theme = "system";
    });
    s.manager.requestSwitch("c-1");
    s.manager.resolveSwitch("discard");
    expect(s.config.activeConfig.value?.name).toBe("クラブ用");
    expect(s.config.state.value.savedConfigs[0].theme).toBe("dark");
  });

  it("確認で「別の名前で保存」を選ぶと名前の入力に進み、確定すると保存してから切り替える", () => {
    const s = setup();
    s.config.updateCurrent((c) => {
      c.theme = "light";
    });
    s.config.saveAs("クラブ用");
    s.manager.requestSwitch("c-default");
    // 変更がない（保存した直後）ので切り替わった
    expect(s.config.activeConfig.value?.name).toBe("既定");

    s.config.updateCurrent((c) => {
      c.display.scanline = false;
    });
    s.manager.requestSwitch("c-1");
    s.manager.startSwitchSaveAs();
    expect(s.manager.nameForm.value).toEqual({ purpose: "switchSaveAs", initial: "既定のコピー" });
    expect(s.manager.submitName("  ")).toBe(false);
    expect(s.manager.nameForm.value).not.toBeNull();

    expect(s.manager.submitName("走査線なし")).toBe(true);
    expect(names(s)).toEqual(["既定", "クラブ用", "走査線なし"]);
    expect(s.config.state.value.savedConfigs[2].display.scanline).toBe(false);
    expect(s.config.activeConfig.value?.name).toBe("クラブ用");
    expect(s.manager.nameForm.value).toBeNull();
    expect(s.manager.pendingSwitch.value).toBeNull();
  });

  it("キャンセルで確認と名前の入力を閉じ、何も変えない", () => {
    const s = setup();
    s.config.saveAs("クラブ用");
    s.config.updateCurrent((c) => {
      c.theme = "light";
    });
    s.manager.requestSwitch("c-default");
    s.manager.startSwitchSaveAs();
    const before = s.config.state.value;
    s.manager.cancel();
    expect(s.manager.pendingSwitch.value).toBeNull();
    expect(s.manager.nameForm.value).toBeNull();
    expect(s.config.state.value).toBe(before);
  });
});

describe("createConfigManager：保存・複製・削除", () => {
  it("名前を付けて保存：初めの値は「{使用中の名前}のコピー」。確定すると保存して使用中にする", () => {
    const s = setup();
    s.manager.startSaveAs();
    expect(s.manager.nameForm.value).toEqual({ purpose: "saveAs", initial: "既定のコピー" });
    expect(s.manager.submitName("クラブ用")).toBe(true);
    expect(names(s)).toEqual(["既定", "クラブ用"]);
    expect(s.config.activeConfig.value?.name).toBe("クラブ用");
    // 名前の入力が開いていなければ何もしない
    expect(s.manager.submitName("x")).toBe(false);
  });

  it("複製は「{name}のコピー」を元のすぐ後ろに足す。使用中の構成は削除できない", () => {
    const s = setup();
    s.config.saveAs("クラブ用");
    s.manager.duplicate("c-default");
    expect(names(s)).toEqual(["既定", "既定のコピー", "クラブ用"]);
    s.manager.remove("c-1");
    expect(names(s)).toEqual(["既定", "既定のコピー", "クラブ用"]);
    s.manager.remove("c-default");
    expect(names(s)).toEqual(["既定のコピー", "クラブ用"]);
  });
});

describe("createConfigManager：書き出し・読み込み", () => {
  it("書き出し：選んだ場所に書き、お知らせを出す。選ばなければ何も出さない。書けなければ失敗のお知らせ", async () => {
    const s = setup();
    await s.manager.exportConfig("c-default");
    expect(s.writes).toEqual([["C:/out/x.json", buildConfigFile(s.config.state.value.savedConfigs[0])]]);
    expect(s.manager.notice.value).toEqual({ kind: "exported", name: "既定" });

    const cancelled = setup({ chooseSavePath: () => Promise.resolve(null) });
    await cancelled.manager.exportConfig("c-default");
    expect(cancelled.manager.notice.value).toBeNull();

    const failed = setup({ writeText: () => Promise.reject(new Error("denied")) });
    await failed.manager.exportConfig("c-default");
    expect(failed.manager.notice.value).toEqual({ kind: "export_failed" });
    expect(failed.errors).toHaveLength(1);
  });

  it("読み込み：検証した構成を新しい ID で足し、お知らせを出す。二重に読み込むと2件。使用中は変えない", async () => {
    const source = setup();
    source.config.updateCurrent((c) => {
      c.theme = "light";
    });
    source.config.saveAs("クラブ用");
    const text = buildConfigFile(source.config.state.value.savedConfigs[1]);

    const s = setup({ readText: () => Promise.resolve(text) });
    await s.manager.importConfig();
    await s.manager.importConfig();
    expect(names(s)).toEqual(["既定", "クラブ用", "クラブ用"]);
    expect(new Set(s.config.state.value.savedConfigs.map((c) => c.id)).size).toBe(3);
    expect(s.config.state.value.savedConfigs[1].theme).toBe("light");
    expect(s.config.activeConfig.value?.name).toBe("既定");
    expect(s.manager.notice.value).toEqual({ kind: "imported", name: "クラブ用" });
  });

  it("壊れた・形式の違うファイルは拒否し、一覧を変えずに失敗のお知らせを出す。選ばなければ何もしない", async () => {
    const s = setup({
      readText: () => Promise.resolve("{}"),
      validate: () => Promise.reject(new Error("not a sonar_spectra.config file")),
    });
    const before = s.config.state.value;
    await s.manager.importConfig();
    expect(s.config.state.value).toBe(before);
    expect(s.manager.notice.value).toEqual({ kind: "import_failed" });
    expect(s.errors).toHaveLength(1);

    const cancelled = setup({ chooseOpenPath: () => Promise.resolve(null) });
    await cancelled.manager.importConfig();
    expect(cancelled.manager.notice.value).toBeNull();
    expect(names(cancelled)).toEqual(["既定"]);
  });

  it("お知らせは、次の操作を始めるときと clearNotice で消える", async () => {
    const s = setup();
    await s.manager.exportConfig("c-default");
    s.manager.startSaveAs();
    expect(s.manager.notice.value).toBeNull();
    await s.manager.exportConfig("c-default");
    s.manager.clearNotice();
    expect(s.manager.notice.value).toBeNull();
  });
});

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }));
