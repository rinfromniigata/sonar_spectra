import { describe, expect, it } from "vitest";
import { MAX_GLOW_RADIUS, gaussianWeights, glowDeviation, glowPlan, glowRegion, glowSampling, glowScale, packShelves } from "./glow";

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

describe("glowSampling（置き場所）", () => {
  it("縮小した画像を (originX, originY) に置いたときは、倍率は同じで、その分を足し、読む範囲もずらす", () => {
    const plan = glowPlan(10, 101, 50)!;
    const at0 = glowSampling(plan, 400, 200);
    const s = glowSampling(plan, 400, 200, 120, 30);
    expect(s.uvScale).toEqual(at0.uvScale);
    expect(at0.uvOffset).toEqual([0, 0]);
    expect(s.uvOffset[0] * 400).toBeCloseTo(120, 9);
    expect(s.uvOffset[1] * 200).toBeCloseTo(30, 9);
    const clamp = s.clamp.map((v, i) => v * (i % 2 === 0 ? 400 : 200));
    [120.5, 30.5, 170.5, 54.5].forEach((v, i) => expect(clamp[i]).toBeCloseTo(v, 9));
  });
});

describe("glowSampling（枠の一部）", () => {
  it("枠の一部（縮小した画像で offset から）を置いたときは、読む位置をその分だけ戻し、読む範囲は置いたものに留める", () => {
    const plan = { ...glowPlan(10, 200, 100)!, smallWidth: 20, smallHeight: 10 };
    const s = glowSampling(plan, 400, 200, 120, 30, 16, 4);
    // 枠の左下（uv 0）は、置いたものの左端から offset だけ外（120 − 16 = 104）
    expect(s.uvOffset[0] * 400).toBeCloseTo(104, 9);
    expect(s.uvOffset[1] * 200).toBeCloseTo(26, 9);
    const clamp = s.clamp.map((v, i) => v * (i % 2 === 0 ? 400 : 200));
    [120.5, 30.5, 139.5, 39.5].forEach((v, i) => expect(clamp[i]).toBeCloseTo(v, 9));
  });
});

describe("glowRegion", () => {
  // 発光 10 → 1/2 に縮小、標準偏差 2.5、半径 8（縮小した画像）→ 届く幅 (8 + 1) × 2 + 2 = 20 デバイスピクセル
  const plan = glowPlan(10, 400, 200)!;

  it("図形のある範囲に、ぼかしの届く幅を足し、左下を縮小の割り算の値の倍数にそろえる", () => {
    expect(plan.weights.length - 1).toBe(8);
    // クリップ座標 x: -0.5〜0 → 100〜200 px、y: 0〜0.5 → 100〜150 px
    const region = glowRegion({ minX: -0.5, maxX: 0, minY: 0, maxY: 0.5 }, plan)!;
    expect(region).toEqual({ x: 80, y: 80, width: 140, height: 90 });
    // 奇数になる端は、外側の倍数に広げる
    const odd = glowRegion({ minX: (101 / 400) * 2 - 1, maxX: (151 / 400) * 2 - 1, minY: -1, maxY: -1 }, plan)!;
    expect(odd.x % 2).toBe(0);
    expect(odd.x).toBe(80);
    expect(odd.x + odd.width).toBe(172);
  });

  it("枠の外は切る。図形が枠の外にしかなければ null", () => {
    expect(glowRegion({ minX: -2, maxX: 2, minY: -2, maxY: 2 }, plan)).toEqual({ x: 0, y: 0, width: 400, height: 200 });
    expect(glowRegion({ minX: 1.2, maxX: 1.5, minY: 0, maxY: 0.5 }, plan)).toBeNull();
  });

  it("1/4 に縮小するときは、4 の倍数にそろえる", () => {
    const big = glowPlan(24, 400, 200)!;
    const region = glowRegion({ minX: 0, maxX: 0.1, minY: 0, maxY: 0.1 }, big)!;
    expect(region.x % 4).toBe(0);
    expect(region.y % 4).toBe(0);
  });
});

describe("packShelves", () => {
  it("左下から右へ詰め、入らなければ上の段へ移る。段の高さは、その段でいちばん高いもの", () => {
    const packed = packShelves(
      [
        { width: 60, height: 20 },
        { width: 30, height: 25 },
        { width: 20, height: 10 },
        { width: 50, height: 5 },
      ],
      100,
    );
    expect(packed.origins).toEqual([
      { x: 0, y: 0, page: 0 },
      { x: 60, y: 0, page: 0 },
      { x: 0, y: 25, page: 0 },
      { x: 20, y: 25, page: 0 },
    ]);
    expect(packed).toMatchObject({ width: 90, height: 35, pages: 1 });
  });

  it("幅より広いものは、それだけの段にし、使った幅として返す", () => {
    const packed = packShelves(
      [
        { width: 10, height: 10 },
        { width: 120, height: 5 },
      ],
      100,
    );
    expect(packed.origins).toEqual([
      { x: 0, y: 0, page: 0 },
      { x: 0, y: 10, page: 0 },
    ]);
    expect(packed).toMatchObject({ width: 120, height: 15 });
  });

  it("高さの上限を超える段は、次のページの左下から詰める。高さは、いちばん高いページの高さ", () => {
    const packed = packShelves(
      [
        { width: 80, height: 40 },
        { width: 80, height: 50 },
        { width: 30, height: 20 },
        { width: 80, height: 30 },
      ],
      100,
      60,
    );
    expect(packed.origins).toEqual([
      { x: 0, y: 0, page: 0 },
      { x: 0, y: 0, page: 1 },
      { x: 0, y: 0, page: 2 },
      { x: 0, y: 20, page: 2 },
    ]);
    expect(packed).toMatchObject({ height: 50, pages: 3 });
  });

  it("何もなければ大きさは 0、ページも 0", () => {
    expect(packShelves([], 100)).toEqual({ origins: [], width: 0, height: 0, pages: 0 });
  });
});
