import { describe, expect, it } from "vitest";
import { moduleRegistry } from "../modules";
import { createDefaultInstances } from "./default_instances";
import { SPEED_MAX, SPEED_MIN, normalizeSpeed, setInstanceOption, setPaletteId, setSpeed } from "./instance_settings";
import type { Instance } from "./types";

/** 既定のインスタンス（ID は種類と通し番号）に、2つ目の波形を足したもの */
function instances(): Instance[] {
  let n = 0;
  const list = createDefaultInstances(moduleRegistry, () => `i${++n}`);
  const wave = list.find((i) => i.kind === "wave")!;
  return [...list, { ...structuredClone(wave), id: "wave-2" }];
}

function byId(list: readonly Instance[], id: string): Instance {
  return list.find((i) => i.id === id)!;
}

describe("normalizeSpeed", () => {
  it("×0.25〜×3.00 に収め、0.05 刻みに丸める（小数2桁）", () => {
    expect(normalizeSpeed(1)).toBe(1);
    expect(normalizeSpeed(0.1)).toBe(SPEED_MIN);
    expect(normalizeSpeed(10)).toBe(SPEED_MAX);
    expect(normalizeSpeed(1.23)).toBe(1.25);
    expect(normalizeSpeed(0.3 + 0.000000001)).toBe(0.3);
    // 刻みの値はすべて小数2桁で表せる（浮動小数の誤差を残さない）
    for (let v = SPEED_MIN; v <= SPEED_MAX; v += 0.05) {
      const s = normalizeSpeed(v)!;
      expect(s).toBe(Number(s.toFixed(2)));
    }
  });

  it("数でなければ null", () => {
    expect(normalizeSpeed(Number.NaN)).toBeNull();
    expect(normalizeSpeed(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("setPaletteId", () => {
  it("そのインスタンスの配色だけを変え、同じ種類のほかのインスタンスと元の並びは変えない", () => {
    const list = instances();
    const wave = list.find((i) => i.kind === "wave")!;
    const next = setPaletteId(list, wave.id, "preset.b")!;
    expect(byId(next, wave.id).paletteId).toBe("preset.b");
    expect(byId(next, "wave-2").paletteId).toBe("preset.a");
    expect(next.filter((i) => i.id !== wave.id)).toEqual(list.filter((i) => i.id !== wave.id));
    expect(byId(list, wave.id).paletteId).toBe("preset.a");
    // 配置・方向・入力源・設定は変えない
    expect({ ...byId(next, wave.id), paletteId: "preset.a" }).toEqual(byId(list, wave.id));
  });

  it("同じ配色・知らないIDなら null（書かない）", () => {
    const list = instances();
    expect(setPaletteId(list, list[0].id, list[0].paletteId)).toBeNull();
    expect(setPaletteId(list, "missing", "preset.b")).toBeNull();
  });
});

describe("setInstanceOption", () => {
  it("その種類が持つ項目だけを変える。持たない項目・同じ値・知らないIDなら null", () => {
    const list = instances();
    const next = setInstanceOption(list, "wave-2", "split", 50)!;
    expect(byId(next, "wave-2").options).toMatchObject({ split: 50, speed: 1, channel: "stereo" });
    const wave = list.find((i) => i.kind === "wave")!;
    expect(byId(next, wave.id).options).toMatchObject({ split: 72 });

    expect(setInstanceOption(list, "wave-2", "split", 72)).toBeNull();
    expect(setInstanceOption(list, "wave-2", "mode", "bars")).toBeNull();
    expect(setInstanceOption(list, "missing", "split", 50)).toBeNull();
  });
});

describe("setSpeed", () => {
  it("流れるモジュール（波形・スペクトログラム）の速さを、範囲に収めて丸めて書く", () => {
    const list = instances();
    expect(byId(setSpeed(list, "wave-2", 2.52)!, "wave-2").options).toMatchObject({ speed: 2.5 });
    const gram = list.find((i) => i.kind === "gram")!;
    expect(byId(setSpeed(list, gram.id, 99)!, gram.id).options).toEqual({ speed: SPEED_MAX });
  });

  it("流れる速さを持たない種類・丸めると同じ値・数でないときは null", () => {
    const list = instances();
    const spec = list.find((i) => i.kind === "spec")!;
    expect(setSpeed(list, spec.id, 2)).toBeNull();
    expect(setSpeed(list, "wave-2", 1.01)).toBeNull();
    expect(setSpeed(list, "wave-2", Number.NaN)).toBeNull();
  });
});
