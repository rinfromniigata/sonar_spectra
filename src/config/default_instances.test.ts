import { describe, expect, it } from "vitest";
import type { StereoOptions, WaveOptions } from "../modules/options";
import { ModuleRegistry } from "../modules/registry";
import { testDefinition } from "../modules/test_definitions";
import { createDefaultInstances, createInstance } from "./default_instances";
import { DEFAULT_PALETTE_ID } from "./palettes";

const WAVE: WaveOptions = { channel: "stereo", showNow: true, split: 72, histColor: "solid", speed: 1 };
const STEREO: StereoOptions = { mode: "lissajous", dots: "both", blur: true };

function counter(): () => string {
  let n = 0;
  return () => `id-${++n}`;
}

describe("createDefaultInstances", () => {
  it("各種類の1つ目を並び順に置き、2つ目以降をその後ろに置く", () => {
    const registry = new ModuleRegistry();
    registry.register(testDefinition("vu", {}, [{ enabled: false }]));
    registry.register(
      testDefinition("stereo", STEREO, [{ enabled: true }, { enabled: true, slot: "pan", options: { mode: "pan" } }]),
    );
    registry.register(testDefinition("wave", WAVE, [{ enabled: true }], "left"));

    const instances = createDefaultInstances(registry, counter());
    expect(instances.map((i) => [i.id, i.kind, i.enabled, i.slot ?? null])).toEqual([
      ["id-1", "wave", true, null],
      ["id-2", "stereo", true, null],
      ["id-3", "vu", false, null],
      ["id-4", "stereo", true, "pan"],
    ]);
  });

  it("既定値は定義から取り、配置は自動（rect なし）、配色は既定、方向は既定の向き", () => {
    const registry = new ModuleRegistry();
    registry.register(testDefinition("wave", WAVE, [{ enabled: true }], "left"));
    const [wave] = createDefaultInstances(registry, counter());
    expect(wave).toEqual({
      id: "id-1",
      kind: "wave",
      enabled: true,
      rect: null,
      direction: "left",
      paletteId: DEFAULT_PALETTE_ID,
      sourceId: "default",
      options: WAVE,
    });
    expect("slot" in wave).toBe(false);
  });

  it("登録がなければ空", () => {
    expect(createDefaultInstances(new ModuleRegistry(), counter())).toEqual([]);
  });
});

describe("createInstance", () => {
  it("指定した設定だけを既定値から変え、定義の既定値は書き換えない", () => {
    const definition = testDefinition("stereo", STEREO);
    const pan = createInstance(definition, { enabled: true, slot: "pan", options: { mode: "pan" } }, "x");
    expect(pan.options).toEqual({ mode: "pan", dots: "both", blur: true });
    expect(pan.slot).toBe("pan");
    expect(definition.defaultOptions.mode).toBe("lissajous");
    pan.options.blur = false;
    expect(definition.defaultOptions.blur).toBe(true);
  });
});
