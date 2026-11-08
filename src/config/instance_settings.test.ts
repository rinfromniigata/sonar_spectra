import { describe, expect, it } from "vitest";
import { moduleRegistry } from "../modules";
import type { AnyModuleDefinition } from "../modules/types";
import { createDefaultInstances } from "./default_instances";
import {
  SPEED_MAX,
  SPEED_MIN,
  defaultsOf,
  isDefaultInstance,
  normalizeSpeed,
  resetInstance,
  setInstanceOption,
  setPaletteId,
  setSpeed,
} from "./instance_settings";
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

describe("既定に戻す", () => {
  const rect = { c: 2, r: 3, cs: 5, rs: 2 };

  /** 波形を、方向・配色・設定をすべて既定から変え、配置・無効・入力源が既定でない状態にする */
  function changedWave(): { list: Instance[]; id: string } {
    const list = instances();
    const id = list.find((i) => i.kind === "wave")!.id;
    const changed = list.map((i) =>
      i.id === id
        ? ({
            ...i,
            enabled: false,
            rect,
            direction: "up",
            paletteId: "preset.c",
            options: { channel: "mono", showNow: false, split: 40, histColor: "bands", speed: 2.5 },
          } as Instance)
        : i,
    );
    return { list: changed, id };
  }

  it("方向・配色・種類ごとの設定（流れる速さを含む）が既定に戻り、配置・有効／無効・入力源は残る", () => {
    const { list, id } = changedWave();
    const next = resetInstance(list, id, moduleRegistry)!;
    const wave = next.find((i) => i.id === id)!;
    expect(wave.direction).toBe("left");
    expect(wave.paletteId).toBe("preset.a");
    expect(wave.options).toEqual({ channel: "stereo", showNow: true, split: 72, histColor: "solid", speed: 1 });
    expect(wave.rect).toEqual(rect);
    expect(wave.enabled).toBe(false);
    expect(wave.sourceId).toBe("default");
    expect(wave.kind).toBe("wave");
  });

  it("ほかのインスタンス（同じ種類を含む）と並び順は変えない", () => {
    const { list, id } = changedWave();
    const next = resetInstance(list, id, moduleRegistry)!;
    expect(next.map((i) => i.id)).toEqual(list.map((i) => i.id));
    expect(next.filter((i) => i.id !== id)).toEqual(list.filter((i) => i.id !== id));
    // 元の並びは書き換えない
    expect(list.find((i) => i.id === id)!.paletteId).toBe("preset.c");
  });

  it("方向を持たない種類（位相）は方向のままで、配色と設定だけが戻る", () => {
    const list = instances();
    const stereo = list.find((i) => i.kind === "stereo" && !i.slot)!;
    const changed = list.map((i) =>
      i.id === stereo.id ? ({ ...i, paletteId: "preset.b", options: { mode: "pan", dots: "none", blur: false } } as Instance) : i,
    );
    const next = resetInstance(changed, stereo.id, moduleRegistry)!;
    const after = next.find((i) => i.id === stereo.id)!;
    expect(after.direction).toBeNull();
    expect(after.paletteId).toBe("preset.a");
    expect(after.options).toEqual({ mode: "lissajous", dots: "both", blur: true });
  });

  it("専用の位置（周波数別の定位）のインスタンスは、表示方式が「周波数別の定位」のまま戻り、専用の位置も残る", () => {
    const list = instances();
    const pan = list.find((i) => i.slot === "pan")!;
    expect(pan.options).toMatchObject({ mode: "pan" });
    const changed = list.map((i) =>
      i.id === pan.id ? ({ ...i, paletteId: "preset.b", options: { mode: "pan", dots: "size", blur: false } } as Instance) : i,
    );
    const after = resetInstance(changed, pan.id, moduleRegistry)!.find((i) => i.id === pan.id)!;
    expect(after.options).toEqual({ mode: "pan", dots: "both", blur: true });
    expect(after.slot).toBe("pan");
    expect(after.paletteId).toBe("preset.a");
  });

  it("作ったときの値に戻るので、既定の構成のインスタンスは何も変えていなければ「既定」", () => {
    for (const instance of instances()) {
      const definition = moduleRegistry.get(instance.kind) as AnyModuleDefinition;
      expect(isDefaultInstance(instance, definition), instance.id).toBe(true);
      expect(resetInstance([instance], instance.id, moduleRegistry)).toBeNull();
    }
  });

  it("方向・配色・設定のどれか1つが違えば既定ではない。配置・有効／無効・入力源の違いは既定かどうかに影響しない", () => {
    const wave = instances().find((i) => i.kind === "wave")!;
    const definition = moduleRegistry.get("wave") as AnyModuleDefinition;
    expect(isDefaultInstance({ ...wave, direction: "down" } as Instance, definition)).toBe(false);
    expect(isDefaultInstance({ ...wave, paletteId: "preset.b" }, definition)).toBe(false);
    expect(isDefaultInstance({ ...wave, options: { ...wave.options, split: 73 } } as Instance, definition)).toBe(false);
    expect(isDefaultInstance({ ...wave, enabled: false, rect } as Instance, definition)).toBe(true);
  });

  it("すでに既定のとき・知らないIDは null（書かない）", () => {
    const list = instances();
    expect(resetInstance(list, "missing", moduleRegistry)).toBeNull();
    expect(resetInstance(list, "wave-2", moduleRegistry)).toBeNull();
  });

  it("既定は種類の定義から決まる（方向は種類の既定の向き）", () => {
    const wave = instances().find((i) => i.kind === "wave")!;
    expect(defaultsOf(wave, moduleRegistry.get("wave") as AnyModuleDefinition)).toEqual({
      direction: "left",
      paletteId: "preset.a",
      options: { channel: "stereo", showNow: true, split: 72, histColor: "solid", speed: 1 },
    });
  });
});
