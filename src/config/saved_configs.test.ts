import { describe, expect, it } from "vitest";
import { ModuleRegistry } from "../modules/registry";
import { testDefinition } from "../modules/test_definitions";
import { createDefaultState } from "./persisted_state";
import {
  CONFIG_NAME_MAX_LENGTH,
  canRemove,
  configOf,
  configsEqual,
  duplicate,
  importConfig,
  isModified,
  normalizeConfigName,
  overwrite,
  remove,
  saveAs,
  switchTo,
} from "./saved_configs";
import type { PersistedState } from "./types";

const T1 = new Date("2026-11-09T01:00:00.000Z");
const T2 = new Date("2026-11-09T02:00:00.000Z");

function base(): PersistedState {
  const registry = new ModuleRegistry();
  registry.register(testDefinition("level", {}, [{ enabled: true }], "up"));
  registry.register(testDefinition("spec", { mode: "fill", ghost: true }, [{ enabled: true }]));
  let n = 0;
  return createDefaultState({
    registry,
    defaultName: "既定",
    now: () => new Date("2026-11-08T07:00:00.000Z"),
    newConfigId: () => "c-default",
    newInstanceId: () => `i-${++n}`,
  });
}

/** 今の構成を変えた状態（変更ありは中身で決める） */
function edited(state: PersistedState, recipe: (s: PersistedState) => void): PersistedState {
  const next = structuredClone(state);
  recipe(next);
  return { ...next, dirty: isModified(next) };
}

describe("名前と中身", () => {
  it("名前は前後の空白を除き、上限の文字数までにする。空なら null", () => {
    expect(normalizeConfigName("  クラブ用 ")).toBe("クラブ用");
    expect(normalizeConfigName(" ")).toBeNull();
    expect([...normalizeConfigName("あ".repeat(CONFIG_NAME_MAX_LENGTH + 1))!]).toHaveLength(CONFIG_NAME_MAX_LENGTH);
  });

  it("構成の中身は、配置・自分で作った配色・テーマ・表示だけ（id・name・savedAt は含めない）の写し", () => {
    const saved = base().savedConfigs[0];
    const config = configOf(saved);
    expect(Object.keys(config).sort()).toEqual(["customPalettes", "display", "layout", "theme"]);
    expect(config.layout).toEqual(saved.layout);
    expect(config.layout).not.toBe(saved.layout);
  });

  it("中身の比較は、キーの順序と undefined の項目によらない（ファイルから読んだ構成と比べても同じになる）", () => {
    const a = configOf(base().current);
    const reordered = JSON.parse(JSON.stringify({ display: a.display, theme: a.theme, customPalettes: a.customPalettes, layout: a.layout }));
    expect(configsEqual(a, reordered)).toBe(true);
    const withUndefined = structuredClone(a);
    (withUndefined.layout.instances[0] as { slot?: "pan" }).slot = undefined;
    expect(configsEqual(a, withUndefined)).toBe(true);
    expect(configsEqual(a, { ...a, theme: "light" })).toBe(false);
  });

  it("変更ありは、今の構成と使用中の保存済み構成の中身を比べて決まる。変えて戻せば変更なし", () => {
    const state = base();
    expect(isModified(state)).toBe(false);
    const light = edited(state, (s) => {
      s.current.theme = "light";
    });
    expect(light.dirty).toBe(true);
    const back = edited(light, (s) => {
      s.current.theme = "dark";
    });
    expect(back.dirty).toBe(false);
    // 使用中の構成がない（壊れた状態）は、変更ありとみなす
    expect(isModified({ ...state, activeConfigId: "none" })).toBe(true);
  });
});

describe("保存済みの構成の操作", () => {
  it("名前を付けて保存：今の構成の写しを末尾に足し、使用中にし、変更なしにする（imple 5.2 の9）", () => {
    const state = edited(base(), (s) => {
      s.current.theme = "light";
    });
    const next = saveAs(state, " クラブ用 ", "c-club", T1)!;
    expect(next.savedConfigs.map((c) => [c.id, c.name])).toEqual([
      ["c-default", "既定"],
      ["c-club", "クラブ用"],
    ]);
    expect(next.savedConfigs[1]).toEqual({ ...configOf(state.current), id: "c-club", name: "クラブ用", savedAt: T1.toISOString() });
    expect(next.activeConfigId).toBe("c-club");
    expect(next.dirty).toBe(false);
    expect(isModified(next)).toBe(false);
    // 「既定」は変えない
    expect(next.savedConfigs[0]).toBe(state.savedConfigs[0]);
    expect(saveAs(state, "  ", "c-x", T1)).toBeNull();
  });

  it("同じ名前で保存しても、別の構成として足す（imple 5.4）", () => {
    const next = saveAs(saveAs(base(), "既定", "c-2", T1)!, "既定", "c-3", T2)!;
    expect(next.savedConfigs.map((c) => [c.id, c.name])).toEqual([
      ["c-default", "既定"],
      ["c-2", "既定"],
      ["c-3", "既定"],
    ]);
  });

  it("上書き：使用中の構成を今の構成の写しにし、保存日を更新する。名前と ID は変えない", () => {
    const state = edited(base(), (s) => {
      s.current.display.scanline = false;
    });
    const next = overwrite(state, T2)!;
    expect(next.savedConfigs[0]).toEqual({ ...configOf(state.current), id: "c-default", name: "既定", savedAt: T2.toISOString() });
    expect(next.dirty).toBe(false);
    expect(next.current).toBe(state.current);
    expect(overwrite({ ...state, activeConfigId: "none" }, T2)).toBeNull();
  });

  it("切り替え：今の構成を選んだ構成の写しにして使用中にし、変更なしにする。ない構成は null", () => {
    const club = saveAs(
      edited(base(), (s) => {
        s.current.theme = "light";
      }),
      "クラブ用",
      "c-club",
      T1,
    )!;
    const next = switchTo(club, "c-default")!;
    expect(next.activeConfigId).toBe("c-default");
    expect(next.current).toEqual(configOf(club.savedConfigs[0]));
    expect(next.current).not.toBe(club.savedConfigs[0].layout);
    expect(next.current.theme).toBe("dark");
    expect(next.dirty).toBe(false);
    expect(switchTo(club, "none")).toBeNull();
  });

  it("複製：元のすぐ後ろに新しい ID・名前・保存日で足す。使用中と今の構成は変えない", () => {
    const state = saveAs(base(), "クラブ用", "c-club", T1)!;
    const next = duplicate(state, "c-default", "既定のコピー", "c-copy", T2)!;
    expect(next.savedConfigs.map((c) => c.id)).toEqual(["c-default", "c-copy", "c-club"]);
    expect(next.savedConfigs[1]).toEqual({ ...configOf(state.savedConfigs[0]), id: "c-copy", name: "既定のコピー", savedAt: T2.toISOString() });
    expect(next.activeConfigId).toBe("c-club");
    expect(next.current).toBe(state.current);
    expect(duplicate(state, "none", "x", "c-x", T2)).toBeNull();
    expect(duplicate(state, "c-default", " ", "c-x", T2)).toBeNull();
  });

  it("削除：使用中の構成は消せない。それ以外は一覧から消すだけで、今の構成は変えない（imple 5.4）", () => {
    const state = saveAs(base(), "クラブ用", "c-club", T1)!;
    expect(canRemove(state, "c-club")).toBe(false);
    expect(remove(state, "c-club")).toBeNull();
    expect(canRemove(state, "none")).toBe(false);
    expect(remove(state, "none")).toBeNull();

    expect(canRemove(state, "c-default")).toBe(true);
    const next = remove(state, "c-default")!;
    expect(next.savedConfigs.map((c) => c.id)).toEqual(["c-club"]);
    expect(next.current).toBe(state.current);
    expect(next.activeConfigId).toBe("c-club");
  });
});

describe("読み込み（imple 5.2 の13・5.4）", () => {
  it("新しい ID で末尾に足す。名前と保存日はファイルのまま。使用中と今の構成は変えない", () => {
    const state = base();
    const file = { ...saveAs(base(), "クラブ用", "c-other-pc", T1)!.savedConfigs[1], theme: "light" as const };
    const next = importConfig(state, file, "c-imported")!;
    expect(next.savedConfigs.map((c) => [c.id, c.name])).toEqual([
      ["c-default", "既定"],
      ["c-imported", "クラブ用"],
    ]);
    expect(next.savedConfigs[1]).toEqual({ ...configOf(file), id: "c-imported", name: "クラブ用", savedAt: T1.toISOString() });
    expect(next.activeConfigId).toBe("c-default");
    expect(next.current).toBe(state.current);
    expect(next.dirty).toBe(state.dirty);
  });

  it("同じファイルを2回読み込むと2件になる。名前が空なら足さない", () => {
    const file = base().savedConfigs[0];
    const twice = importConfig(importConfig(base(), file, "c-a")!, file, "c-b")!;
    expect(twice.savedConfigs.map((c) => c.id)).toEqual(["c-default", "c-a", "c-b"]);
    expect(importConfig(base(), { ...file, name: " " }, "c-x")).toBeNull();
  });
});
