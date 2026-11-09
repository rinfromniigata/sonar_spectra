import { describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "../modules/registry";
import { testDefinition } from "../modules/test_definitions";
import {
  CONFIG_FORMAT,
  buildConfigFile,
  configFileName,
  exportConfigFile,
  readConfigFile,
  type ConfigFileIo,
} from "./config_file";
import { createDefaultState } from "./persisted_state";
import { configOf } from "./saved_configs";
import { STATE_SCHEMA, type SavedConfig } from "./types";

function saved(): SavedConfig {
  const registry = new ModuleRegistry();
  registry.register(testDefinition("spec", { mode: "fill", ghost: true }, [{ enabled: true }]));
  let n = 0;
  const state = createDefaultState({
    registry,
    defaultName: "クラブ用",
    now: () => new Date("2026-11-09T01:00:00.000Z"),
    newConfigId: () => "c-club",
    newInstanceId: () => `i-${++n}`,
  });
  return state.savedConfigs[0];
}

function fakeIo(overrides: Partial<ConfigFileIo> = {}) {
  const writes: [string, string][] = [];
  const io: ConfigFileIo = {
    chooseSavePath: vi.fn(() => Promise.resolve<string | null>("C:/out/club.json")),
    chooseOpenPath: vi.fn(() => Promise.resolve<string | null>("C:/in/club.json")),
    readText: vi.fn(() => Promise.resolve(buildConfigFile(saved()))),
    writeText: vi.fn((path: string, text: string) => {
      writes.push([path, text]);
      return Promise.resolve();
    }),
    validate: vi.fn((text: string) => Promise.resolve((JSON.parse(text) as { config: SavedConfig }).config)),
    ...overrides,
  };
  return { io, writes };
}

const LABELS = { filterName: "構成ファイル", fallbackFileName: "構成" };

describe("buildConfigFile", () => {
  it("{ format, schema, config } の JSON にする。config は保存済み構成の中身と id・name・savedAt だけ", () => {
    const source = { ...saved(), window: { x: 1 }, source: { deviceId: "dev-1" } } as SavedConfig;
    const text = buildConfigFile(source);
    expect(text.endsWith("\n")).toBe(true);
    const file = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(file)).toEqual(["format", "schema", "config"]);
    expect(file.format).toBe(CONFIG_FORMAT);
    expect(file.schema).toBe(STATE_SCHEMA);
    const config = file.config as SavedConfig;
    expect(Object.keys(config).sort()).toEqual(["customPalettes", "display", "id", "layout", "name", "savedAt", "theme"]);
    expect(config).toEqual({ id: "c-club", name: "クラブ用", savedAt: "2026-11-09T01:00:00.000Z", ...configOf(source) });
  });
});

describe("configFileName", () => {
  it("名前に .json を付け、Windows のファイル名に使えない文字と末尾の点・空白を除く", () => {
    expect(configFileName("クラブ用", "構成")).toBe("クラブ用.json");
    expect(configFileName('a<b>c:d"e/f\\g|h?i*j', "構成")).toBe("a_b_c_d_e_f_g_h_i_j.json");
    expect(configFileName("末尾. ", "構成")).toBe("末尾.json");
    expect(configFileName("  ", "構成")).toBe("構成.json");
    expect(configFileName("...", "構成")).toBe("構成.json");
  });
});

describe("exportConfigFile", () => {
  it("保存ダイアログで選んだ場所に、構成ファイルを書く（初めのファイル名は構成の名前）", async () => {
    const { io, writes } = fakeIo();
    expect(await exportConfigFile(saved(), io, LABELS)).toBe("exported");
    expect(io.chooseSavePath).toHaveBeenCalledWith("クラブ用.json", "構成ファイル");
    expect(writes).toEqual([["C:/out/club.json", buildConfigFile(saved())]]);
  });

  it("ダイアログで選ばなければ書かない", async () => {
    const { io, writes } = fakeIo({ chooseSavePath: () => Promise.resolve(null) });
    expect(await exportConfigFile(saved(), io, LABELS)).toBe("cancelled");
    expect(writes).toEqual([]);
  });

  it("書けなければ失敗する", async () => {
    const { io } = fakeIo({ writeText: () => Promise.reject(new Error("denied")) });
    await expect(exportConfigFile(saved(), io, LABELS)).rejects.toThrow("denied");
  });
});

describe("readConfigFile", () => {
  it("開くダイアログで選んだファイルを読み、Rust の検証を通した構成を返す", async () => {
    const { io } = fakeIo();
    expect(await readConfigFile(io, LABELS)).toEqual(saved());
    expect(io.chooseOpenPath).toHaveBeenCalledWith("構成ファイル");
    expect(io.readText).toHaveBeenCalledWith("C:/in/club.json");
    expect(io.validate).toHaveBeenCalledWith(buildConfigFile(saved()));
  });

  it("ダイアログで選ばなければ null。検証で拒否されれば失敗する", async () => {
    expect(await readConfigFile(fakeIo({ chooseOpenPath: () => Promise.resolve(null) }).io, LABELS)).toBeNull();
    const { io } = fakeIo({ validate: () => Promise.reject(new Error("not a sonar_spectra.config file")) });
    await expect(readConfigFile(io, LABELS)).rejects.toThrow("sonar_spectra.config");
  });
});
