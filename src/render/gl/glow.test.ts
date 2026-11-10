import { describe, expect, it } from "vitest";
import { GlowTargets, MAX_GLOW_RADIUS, gaussianWeights, glowDeviation, glowPlan, glowSampling, glowScale } from "./glow";

describe("glowScale・glowDeviation", () => {
  it("発光 12 までは 1/2、それより大きいと 1/4 に縮小し、縮小した画像の上で標準偏差 b/2 × 縮小率のぼかしにする", () => {
    expect([glowScale(4), glowScale(10), glowScale(12), glowScale(20), glowScale(24)]).toEqual([0.5, 0.5, 0.5, 0.25, 0.25]);
    expect(glowDeviation(10)).toBe(2.5);
    expect(glowDeviation(24)).toBe(3);
  });
});

describe("gaussianWeights", () => {
  const total = (w: Float32Array) => w.reduce((sum, v, i) => sum + (i === 0 ? v : 2 * v), 0);

  it("半径は 3σ の切り上げで、両側を足すと 1 になり、中心から離れるほど小さい", () => {
    for (const sigma of [0.25, 1, 1.625, 2.5, 3]) {
      const w = gaussianWeights(sigma);
      expect(w.length).toBe(Math.ceil(sigma * 3) + 1);
      expect(total(w)).toBeCloseTo(1, 6);
      for (let i = 1; i < w.length; i++) expect(w[i]).toBeLessThan(w[i - 1]);
    }
  });

  it("隣どうしの比はガウスの形（exp(−(2i+1) / 2σ²)）", () => {
    const sigma = 2.5;
    const w = gaussianWeights(sigma);
    for (let i = 0; i + 1 < w.length; i++) {
      expect(w[i + 1] / w[i]).toBeCloseTo(Math.exp(-(2 * i + 1) / (2 * sigma * sigma)), 5);
    }
  });

  it("半径は MAX_GLOW_RADIUS まで。σ が 0 以下や数でなければ、ぼかさない（中心だけ）", () => {
    const wide = gaussianWeights(20);
    expect(wide.length).toBe(MAX_GLOW_RADIUS + 1);
    expect(total(wide)).toBeCloseTo(1, 6);
    expect(Array.from(gaussianWeights(0))).toEqual([1]);
    expect(Array.from(gaussianWeights(-1))).toEqual([1]);
    expect(Array.from(gaussianWeights(Number.NaN))).toEqual([1]);
  });
});

describe("glowPlan", () => {
  it("縮小率と標準偏差と重みを決め、縮小した画像で枠を覆う大きさを切り上げで求める", () => {
    // 枠 200×80（CSS）× DPR 1.5 = 300×120 デバイスピクセル
    const plan = glowPlan(10, 300, 120)!;
    expect(plan.factor).toBe(2);
    expect(plan.deviation).toBe(2.5);
    expect(Array.from(plan.weights)).toEqual(Array.from(gaussianWeights(2.5)));
    expect([plan.smallWidth, plan.smallHeight]).toEqual([150, 60]);

    const wide = glowPlan(24, 300, 120)!;
    expect(wide.factor).toBe(4);
    expect(wide.deviation).toBe(3);
    expect([wide.smallWidth, wide.smallHeight]).toEqual([75, 30]);
  });

  it("割り切れない大きさでは、端数の分も縮小した画像に含める", () => {
    const plan = glowPlan(10, 101, 50)!;
    expect([plan.smallWidth, plan.smallHeight]).toEqual([51, 25]);
    expect([glowPlan(20, 101, 50)!.smallWidth, glowPlan(20, 101, 50)!.smallHeight]).toEqual([26, 13]);
  });

  it("発光が 0 以下・数でないとき、枠の大きさがないときは、ぼかしを飛ばす（null）", () => {
    expect(glowPlan(0, 300, 120)).toBeNull();
    expect(glowPlan(-4, 300, 120)).toBeNull();
    expect(glowPlan(Number.NaN, 300, 120)).toBeNull();
    expect(glowPlan(10, 0, 120)).toBeNull();
    expect(glowPlan(10, 300, 0)).toBeNull();
  });
});

describe("glowSampling", () => {
  it("枠のデバイスピクセル x を、縮小した画像の x / factor に当てる（割り切れない大きさでも同じ倍率で拡大する）", () => {
    // 101 × 1/2 → 51 ピクセルの画像。枠の幅 101 は、縮小した画像の 50.5 に当たる（51 ピクセルを 102 の幅で敷くのと同じ倍率）
    const plan = glowPlan(10, 101, 50)!;
    const s = glowSampling(plan, 51, 25);
    expect(s.uvScale[0] * 51).toBeCloseTo(50.5, 9);
    expect(s.uvScale[1] * 25).toBeCloseTo(25, 9);
    // 読む位置は、縮小した画像の範囲の端のピクセルの中心まで
    expect(s.clamp.map((v, i) => v * (i % 2 === 0 ? 51 : 25))).toEqual([0.5, 0.5, 50.5, 24.5]);
  });

  it("キャンバスの大きさで作った画像の左下を使うときは、その大きさで割る", () => {
    const plan = glowPlan(24, 300, 120)!;
    const s = glowSampling(plan, 720, 450);
    expect(s.uvScale[0] * 720).toBeCloseTo(75, 9);
    expect(s.uvScale[1] * 450).toBeCloseTo(30, 9);
    expect(s.clamp[2] * 720).toBeCloseTo(74.5, 9);
    expect(s.clamp[3] * 450).toBeCloseTo(29.5, 9);
  });
});

describe("GlowTargets", () => {
  function recording(failAt: number[] = []) {
    const created: { width: number; height: number; destroyed: boolean }[] = [];
    let calls = 0;
    const targets = new GlowTargets({
      create: (width, height) => {
        if (failAt.includes(calls++)) return null;
        const t = { width, height, destroyed: false };
        created.push(t);
        return t;
      },
      destroy: (t) => {
        t.destroyed = true;
      },
    });
    return { targets, created };
  }

  it("使うときに作る：等倍は1枚、縮小は縮小率ごとに2枚（キャンバスの大きさを切り上げで割った大きさ）", () => {
    const { targets, created } = recording();
    targets.resize(2880, 1801);
    expect(created).toHaveLength(0);
    targets.full();
    targets.scaled(2);
    targets.scaled(4);
    expect(created.map((t) => [t.width, t.height])).toEqual([
      [2880, 1801],
      [1440, 901],
      [1440, 901],
      [720, 451],
      [720, 451],
    ]);
  });

  it("2回目からは使い回す。大きさが変わったら捨てて作り直し、同じ大きさなら作り直さない", () => {
    const { targets, created } = recording();
    targets.resize(300, 120);
    const full = targets.full();
    const pair = targets.scaled(2);
    expect(targets.full()).toBe(full);
    expect(targets.scaled(2)).toBe(pair);
    targets.resize(300, 120);
    expect(targets.full()).toBe(full);
    expect(created).toHaveLength(3);

    targets.resize(200, 120);
    expect(created.every((t) => t.destroyed)).toBe(true);
    targets.full();
    targets.scaled(2);
    expect(created.slice(3).map((t) => [t.width, t.height, t.destroyed])).toEqual([
      [200, 120, false],
      [100, 60, false],
      [100, 60, false],
    ]);
  });

  it("大きさがまだないとき・作れないときは null。2枚目を作れなければ1枚目も捨てる", () => {
    const empty = recording();
    expect(empty.targets.full()).toBeNull();
    expect(empty.targets.scaled(2)).toBeNull();
    expect(empty.created).toHaveLength(0);

    const failing = recording([1]);
    failing.targets.resize(300, 120);
    expect(failing.targets.scaled(2)).toBeNull();
    expect(failing.created).toHaveLength(1);
    expect(failing.created[0].destroyed).toBe(true);
    // 次は作れる
    expect(failing.targets.scaled(2)).not.toBeNull();
  });

  it("release で全部を捨てる", () => {
    const { targets, created } = recording();
    targets.resize(300, 120);
    targets.full();
    targets.scaled(4);
    targets.release();
    expect(created.map((t) => t.destroyed)).toEqual([true, true, true]);
    targets.full();
    expect(created).toHaveLength(4);
  });
});
