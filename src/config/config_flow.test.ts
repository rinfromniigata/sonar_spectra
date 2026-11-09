// W7-2：構成の操作を、imple 5.2 の手順9〜13の順に追い、5.4 の規則（使用中は削除できない、同名を許す、
// 二重の読み込みで2件、壊れたファイルの拒否）を確かめる。
// - 画面と同じ入口（config_manager・palette_actions）から操作し、保存は JSON にして持つディスクの代役で往復させる
// - 手順12・13は2台の PC（別々のストアとディスク）と、両方から見えるファイルの代役でつなぐ
// - ファイルの検証は Rust（validate_config_file）が行う。ここでは format・schema・JSON の確認だけをする代役を使い、
//   本物の検証は、同じ見本（src-tauri/src/settings_store/fixtures/config_file_v1.json）を Rust のテスト
//   （config_file.rs の accepts_the_file_the_ui_writes・returns_the_same_config_the_ui_wrote）が確かめる

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readTextFile: vi.fn(), writeTextFile: vi.fn() }));

import fixtureText from "../../src-tauri/src/settings_store/fixtures/config_file_v1.json?raw";
import { createRuntimeStore } from "../app/runtime_store";
import { createConfigManager, type ConfigManager } from "../components/config_manager";
import { createPaletteActions } from "../components/palette_actions";
import { moduleRegistry } from "../modules";
import { CONFIG_FORMAT, buildConfigFile, type ConfigFileIo } from "./config_file";
import { createConfigStore, type ConfigPersistence, type ConfigStore } from "./config_store";
import { createDefaultState, normalizeState } from "./persisted_state";
import { configOf, configsEqual } from "./saved_configs";
import { STATE_SCHEMA, type PersistedState, type SavedConfig } from "./types";

/** 両方の PC から見えるファイル（USB メモリなど）の代役 */
type Files = Map<string, string>;

/** JSON にして持つディスクの代役（Rust の state.json と同じ往復） */
function fakeDisk() {
  let file: string | null = null;
  const persistence: ConfigPersistence = {
    load: () => Promise.resolve(file ? (JSON.parse(file) as PersistedState) : null),
    save: vi.fn((state: PersistedState) => {
      file = JSON.stringify(state);
      return Promise.resolve();
    }),
  };
  return { persistence, saves: () => vi.mocked(persistence.save).mock.calls.length };
}

/** Rust の validate_config_file の代役（format・schema・JSON だけを確かめる） */
function validate(text: string): Promise<SavedConfig> {
  try {
    const file = JSON.parse(text) as { format?: unknown; schema?: unknown; config?: SavedConfig };
    if (file.format !== CONFIG_FORMAT) throw new Error(`not a ${CONFIG_FORMAT} file`);
    if (file.schema !== STATE_SCHEMA) throw new Error(`unexpected schema ${String(file.schema)}`);
    return Promise.resolve(file.config!);
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

interface Pc {
  disk: ReturnType<typeof fakeDisk>;
  config: ConfigStore;
  manager: ConfigManager;
  palettes: ReturnType<typeof createPaletteActions>;
  /** ダイアログで次に選ぶパス */
  pick: { path: string | null };
}

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

async function startPc(name: string, files: Files, disk = fakeDisk()): Promise<Pc> {
  let minutes = 0;
  const config = createConfigStore({
    persistence: disk.persistence,
    createDefault: () =>
      createDefaultState({
        registry: moduleRegistry,
        defaultName: "既定",
        newConfigId: counter(`${name}-default`),
        newInstanceId: counter(`${name}-i`),
        now: () => new Date("2026-11-08T07:00:00.000Z"),
      }),
    normalize: (s) => normalizeState(s, moduleRegistry),
    newConfigId: counter(`${name}-c`),
    now: () => new Date(Date.UTC(2026, 10, 9, 1, minutes++)),
  });
  await config.restore();
  const pick = { path: null as string | null };
  const io: ConfigFileIo = {
    chooseSavePath: () => Promise.resolve(pick.path),
    chooseOpenPath: () => Promise.resolve(pick.path),
    readText: (path) => {
      const text = files.get(path);
      return text === undefined ? Promise.reject(new Error("not found")) : Promise.resolve(text);
    },
    writeText: (path, text) => {
      files.set(path, text);
      return Promise.resolve();
    },
    validate,
  };
  const manager = createConfigManager({
    config,
    io,
    names: { copy: (n) => `${n}のコピー`, filterName: () => "構成", fallbackFileName: () => "構成" },
    onError: () => {},
  });
  const palettes = createPaletteActions({
    config,
    runtime: createRuntimeStore(),
    names: { fresh: (n) => `マイ配色 ${n}`, copy: (n) => `${n}のコピー`, preset: (p) => p.labelKey },
    newId: counter(`${name}-p`),
  });
  return { disk, config, manager, palettes, pick };
}

const names = (pc: Pc) => pc.config.state.value.savedConfigs.map((c) => c.name);

describe("共有の見本（構成ファイル）", () => {
  it("見本の構成を書き出すと、見本と同じ本文になる（Rust のテストと同じ見本を使う）", () => {
    const file = JSON.parse(fixtureText) as { config: SavedConfig };
    expect(buildConfigFile(file.config)).toBe(fixtureText);
  });
});

describe("imple 5.2 の手順9〜13（W7-2）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("保存 → 配色を作る → 確認して破棄で切り替え → 書き出し → 別の PC で読み込み", async () => {
    const files: Files = new Map();
    const a = await startPc("a", files);
    const defaultId = a.config.activeConfig.value!.id;

    // 4〜8 の代わり：テーマをライトにし、スペクトラムを右向きにする
    a.config.updateCurrent((c) => {
      c.theme = "light";
      c.layout.instances.find((i) => i.kind === "spec")!.direction = "right";
    });
    expect(a.config.dirty.value).toBe(true);

    // 9. 「名前を付けて保存」で「クラブ用」と付ける
    a.manager.startSaveAs();
    expect(a.manager.submitName("クラブ用")).toBe(true);
    const club = a.config.activeConfig.value!;
    expect(names(a)).toEqual(["既定", "クラブ用"]);
    expect(club.id).not.toBe(defaultId);
    expect(club.savedAt).toBe("2026-11-09T01:00:00.000Z");
    expect(configsEqual(club, a.config.current.value)).toBe(true);
    expect(a.config.dirty.value).toBe(false);

    // 10. 配色を作る → current.customPalettes に1件増え、変更あり。どのインスタンスもまだ使っていない
    a.palettes.create();
    const palette = a.config.current.value.customPalettes[0];
    expect(a.config.current.value.customPalettes).toHaveLength(1);
    expect(a.config.dirty.value).toBe(true);
    expect(a.config.current.value.layout.instances.some((i) => i.paletteId === palette.id)).toBe(false);

    // 11. 「既定」に切り替える → 変更があるので確認。破棄すると「既定」の写しになり、作った配色は消える
    expect(a.manager.requestSwitch(defaultId)).toBe("needsConfirm");
    expect(a.config.activeConfig.value!.id).toBe(club.id);
    a.manager.resolveSwitch("discard");
    expect(a.config.activeConfig.value!.id).toBe(defaultId);
    expect(a.config.current.value).toEqual(configOf(a.config.state.value.savedConfigs[0]));
    expect(a.config.current.value.theme).toBe("dark");
    expect(a.config.current.value.customPalettes).toEqual([]);
    expect(a.config.dirty.value).toBe(false);
    expect(a.config.state.value.savedConfigs[1].customPalettes).toEqual([]);

    // 12. 「クラブ用」を書き出す → state.json は変わらない。{ format, schema: 1, config: SavedConfig } を書く
    await vi.runAllTimersAsync();
    const savesBefore = a.disk.saves();
    const stateBefore = a.config.state.value;
    a.pick.path = "E:/クラブ用.json";
    await a.manager.exportConfig(club.id);
    await vi.runAllTimersAsync();
    expect(a.config.state.value).toBe(stateBefore);
    expect(a.disk.saves()).toBe(savesBefore);
    const written = JSON.parse(files.get("E:/クラブ用.json")!) as Record<string, unknown>;
    expect(Object.keys(written)).toEqual(["format", "schema", "config"]);
    expect(written.format).toBe(CONFIG_FORMAT);
    expect(written.schema).toBe(STATE_SCHEMA);
    expect(written.config).toEqual(a.config.state.value.savedConfigs[1]);

    // 13. 別の PC でそのファイルを読み込む → 検証してから新しい id で1件増やす。使用中は変えない
    const b = await startPc("b", files);
    const bDefault = b.config.activeConfig.value!.id;
    const bCurrent = b.config.current.value;
    b.pick.path = "E:/クラブ用.json";
    await b.manager.importConfig();
    expect(names(b)).toEqual(["既定", "クラブ用"]);
    const imported = b.config.state.value.savedConfigs[1];
    expect(imported.id).not.toBe(club.id);
    expect(imported.savedAt).toBe(club.savedAt);
    expect(configsEqual(imported, club)).toBe(true);
    expect(imported.theme).toBe("light");
    expect(b.config.activeConfig.value!.id).toBe(bDefault);
    expect(b.config.current.value).toBe(bCurrent);
    expect(b.config.dirty.value).toBe(false);

    // 読み込んだ構成は保存され、起動し直しても残る。一覧から切り替えて使える
    await vi.runAllTimersAsync();
    const bAgain = await startPc("b2", files, b.disk);
    expect(names(bAgain)).toEqual(["既定", "クラブ用"]);
    expect(bAgain.manager.requestSwitch(imported.id)).toBe("switched");
    expect(bAgain.config.current.value.theme).toBe("light");
  });
});

describe("imple 5.4 の規則（W7-2）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("使用中の構成は削除できない。それ以外は一覧から消えるだけで、今の構成は変わらない", async () => {
    const pc = await startPc("a", new Map());
    pc.manager.startSaveAs();
    pc.manager.submitName("クラブ用");
    const active = pc.config.activeConfig.value!.id;
    const other = pc.config.state.value.savedConfigs[0].id;
    expect(pc.config.canRemoveConfig(active)).toBe(false);
    pc.manager.remove(active);
    expect(names(pc)).toEqual(["既定", "クラブ用"]);

    const current = pc.config.current.value;
    pc.manager.remove(other);
    expect(names(pc)).toEqual(["クラブ用"]);
    expect(pc.config.current.value).toBe(current);
  });

  it("同じ名前での保存を許し、id で区別する。上書きは「上書き」の操作だけで行う", async () => {
    const pc = await startPc("a", new Map());
    for (let i = 0; i < 2; i++) {
      pc.manager.startSaveAs();
      pc.manager.submitName("既定");
    }
    const saved = pc.config.state.value.savedConfigs;
    expect(saved.map((c) => c.name)).toEqual(["既定", "既定", "既定"]);
    expect(new Set(saved.map((c) => c.id)).size).toBe(3);
    // 同じ名前で保存しても、元の「既定」は書き換わらない
    expect(saved[0].savedAt).toBe("2026-11-08T07:00:00.000Z");
  });

  it("同じファイルを2回読み込むと、それぞれ新しい id で2件増える", async () => {
    const files: Files = new Map([["E:/club.json", fixtureText]]);
    const pc = await startPc("a", files);
    pc.pick.path = "E:/club.json";
    await pc.manager.importConfig();
    await pc.manager.importConfig();
    const saved = pc.config.state.value.savedConfigs;
    expect(saved.map((c) => c.name)).toEqual(["既定", "クラブ用", "クラブ用"]);
    expect(new Set(saved.map((c) => c.id)).size).toBe(3);
    expect(saved.some((c) => c.id === "c-club")).toBe(false);
  });

  it("壊れた・形式の違うファイルは拒否し、状態も state.json も変えない", async () => {
    const valid = JSON.parse(fixtureText) as Record<string, unknown>;
    const files: Files = new Map([
      ["E:/broken.json", fixtureText.slice(0, 200)],
      ["E:/other.json", JSON.stringify({ ...valid, format: "other.app" })],
      ["E:/newer.json", JSON.stringify({ ...valid, schema: STATE_SCHEMA + 1 })],
      ["E:/state.json", JSON.stringify({ schema: 1, current: {} })],
    ]);
    const pc = await startPc("a", files);
    await vi.runAllTimersAsync();
    const saves = pc.disk.saves();
    const state = pc.config.state.value;
    for (const path of files.keys()) {
      pc.pick.path = path;
      await pc.manager.importConfig();
      expect(pc.manager.notice.value, path).toEqual({ kind: "import_failed" });
      expect(pc.config.state.value, path).toBe(state);
    }
    await vi.runAllTimersAsync();
    expect(pc.disk.saves()).toBe(saves);
  });
});
