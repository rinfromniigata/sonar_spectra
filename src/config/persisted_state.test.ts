import { describe, expect, it } from "vitest";
import { ModuleRegistry } from "../modules/registry";
import { testDefinition } from "../modules/test_definitions";
import { createDefaultConfig, createDefaultState, normalizeState } from "./persisted_state";
import { STATE_SCHEMA } from "./types";

function registry(): ModuleRegistry {
  const r = new ModuleRegistry();
  r.register(testDefinition("level", {}, [{ enabled: true }], "up"));
  r.register(testDefinition("spec", { mode: "fill", ghost: true }, [{ enabled: true }]));
  r.register(testDefinition("vu", {}, [{ enabled: false }]));
  return r;
}

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

describe("createDefaultConfig", () => {
  it("自動配置・ダーク・走査線はオン・常に最前面と起動時の全画面はオフ・自分で作った配色なし", () => {
    const config = createDefaultConfig(registry(), counter("i"));
    expect(config.layout.mode).toBe("auto");
    expect(config.layout.instances.map((i) => [i.kind, i.enabled, i.rect])).toEqual([
      ["level", true, null],
      ["spec", true, null],
      ["vu", false, null],
    ]);
    expect(config.customPalettes).toEqual([]);
    expect(config.theme).toBe("dark");
    expect(config.display).toEqual({ scanline: true, alwaysOnTop: false, startFullscreen: false });
  });
});

describe("createDefaultState", () => {
  it("保存済みの構成「既定」を1件作って使用中にし、今の構成はその写し。変更なし、入力源は既定のデバイス", () => {
    const state = createDefaultState({
      registry: registry(),
      defaultName: "既定",
      now: () => new Date("2026-11-08T07:00:00.000Z"),
      newConfigId: counter("c"),
      newInstanceId: counter("i"),
    });
    expect(state.schema).toBe(STATE_SCHEMA);
    expect(state.savedConfigs).toHaveLength(1);
    const [saved] = state.savedConfigs;
    expect(saved).toMatchObject({ id: "c-1", name: "既定", savedAt: "2026-11-08T07:00:00.000Z" });
    expect(state.activeConfigId).toBe("c-1");
    expect({ ...saved, id: undefined, name: undefined, savedAt: undefined }).toEqual(state.current);
    // 写しなので、今の構成を変えても保存済みの構成は変わらない
    expect(saved.layout).not.toBe(state.current.layout);
    expect(state.dirty).toBe(false);
    expect(state.source).toEqual({ deviceId: null });
  });
});

describe("normalizeState", () => {
  it("今の構成と保存済みの構成のインスタンスに、設定の既定値を補う。保存された値はそのまま。知らない種類は残す", () => {
    const state = createDefaultState({ registry: registry(), defaultName: "既定", newInstanceId: counter("i") });
    for (const config of [state.current, ...state.savedConfigs]) {
      const spec = config.layout.instances.find((i) => i.kind === "spec")!;
      spec.options = { mode: "radial" } as typeof spec.options;
    }
    const withoutVu = new ModuleRegistry();
    withoutVu.register(testDefinition("spec", { mode: "fill", ghost: true }, [{ enabled: true }]));

    const normalized = normalizeState(state, withoutVu);
    for (const config of [normalized.current, ...normalized.savedConfigs]) {
      expect(config.layout.instances.find((i) => i.kind === "spec")!.options).toEqual({ mode: "radial", ghost: true });
      expect(config.layout.instances.map((i) => i.kind)).toEqual(["level", "spec", "vu"]);
    }
    // 元の状態は書き換えない
    expect(state.current.layout.instances.find((i) => i.kind === "spec")!.options).toEqual({ mode: "radial" });
  });
});
