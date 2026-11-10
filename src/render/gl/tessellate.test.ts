import { describe, expect, it } from "vitest";
import type { Rgba } from "./color";
import {
  AA_MARGIN,
  FILL_EXTENT,
  MITER_LIMIT,
  coverage,
  fadeColor,
  fillBand,
  fillPoints,
  fillPolygon,
  fillRects,
  imageQuad,
  lineCoverage,
  strokePolyline,
  type MeshWriter,
} from "./tessellate";

interface Vertex {
  x: number;
  y: number;
  a: number;
  u: number;
  v: number;
  w: number;
}

function mesh(): MeshWriter & { vertices: Vertex[]; colors: Rgba[]; triangles: [number, number, number][] } {
  const vertices: Vertex[] = [];
  const colors: Rgba[] = [];
  const triangles: [number, number, number][] = [];
  return {
    vertices,
    colors,
    triangles,
    vertex(x, y, color, alpha, u, v, w) {
      vertices.push({ x, y, a: color[3] * alpha, u, v, w });
      colors.push(color);
      return vertices.length - 1;
    },
    triangle(a, b, c) {
      triangles.push([a, b, c]);
    },
  };
}

const WHITE: Rgba = [1, 1, 1, 1];

/** 三角形の面積の合計（重なりは2回数える） */
function area(m: ReturnType<typeof mesh>): number {
  let sum = 0;
  for (const [a, b, c] of m.triangles) {
    const p = m.vertices[a];
    const q = m.vertices[b];
    const r = m.vertices[c];
    sum += Math.abs((q.x - p.x) * (r.y - p.y) - (r.x - p.x) * (q.y - p.y)) / 2;
  }
  return sum;
}

describe("lineCoverage", () => {
  it("1デバイスピクセル以上はそのままの太さ、細い線は1ピクセルの太さで細さの分だけ薄くする", () => {
    expect(lineCoverage(2, 1.5)).toEqual({ halfWidth: 1.5, alpha: 1 });
    expect(lineCoverage(1, 1)).toEqual({ halfWidth: 0.5, alpha: 1 });
    expect(lineCoverage(0.4, 1.5)).toEqual({ halfWidth: 0.5, alpha: 0.4 * 1.5 });
  });
});

describe("strokePolyline", () => {
  it("まっすぐな線は4つの頂点と2つの三角形。ふちのぼかしの分だけ外まで作り、ふちで覆う割合が 0.5 になる", () => {
    const m = mesh();
    strokePolyline(m, [0, 0, 10, 0], 2, 1, WHITE, 1);
    expect(m.vertices).toHaveLength(4);
    expect(m.triangles).toHaveLength(2);
    const extent = 1 + AA_MARGIN;
    for (const v of m.vertices) {
      expect(Math.abs(v.y)).toBeCloseTo(extent, 9);
      expect(Math.abs(v.u)).toBeCloseTo(extent, 9);
      expect(v.v).toBe(1);
      expect(v.w).toBe(0);
    }
    expect(area(m)).toBeCloseTo(10 * 2 * extent, 6);
    // 中心は覆い、太さのふち（距離 1）で半分、外端で 0
    expect(coverage(0, 1, 0)).toBe(1);
    expect(coverage(1, 1, 0)).toBe(0.5);
    expect(coverage(extent, 1, 0)).toBe(0);
  });

  it("ふちのぼかしの幅はデバイスピクセルで決まり、CSS ピクセルでは DPR で割った幅になる", () => {
    const m = mesh();
    strokePolyline(m, [0, 0, 10, 0], 2, 2, WHITE, 1);
    // 太さ 2 CSS px = 4 デバイスピクセル。半分 2 ＋ ぼかし 1 = 3 デバイスピクセル = 1.5 CSS px
    for (const v of m.vertices) {
      expect(Math.abs(v.y)).toBeCloseTo(1.5, 9);
      expect(Math.abs(v.u)).toBeCloseTo(3, 9);
      expect(v.v).toBe(2);
    }
  });

  it("細い線は薄くする（不透明度に掛ける）", () => {
    const m = mesh();
    strokePolyline(m, [0, 0, 10, 0], 0.5, 1, [1, 0, 0, 0.8], 0.5);
    for (const v of m.vertices) expect(v.a).toBeCloseTo(0.8 * 0.5 * 0.5, 9);
  });

  it("直角の継ぎ目は角（1点に2つの頂点）で、二等分の向きに √2 倍の長さ", () => {
    const m = mesh();
    strokePolyline(m, [0, 0, 10, 0, 10, 10], 2, 1, WHITE, 1);
    expect(m.vertices).toHaveLength(6);
    expect(m.triangles).toHaveLength(4);
    const extent = 1 + AA_MARGIN;
    const corner = m.vertices.slice(2, 4);
    for (const v of corner) {
      expect(Math.hypot(v.x - 10, v.y)).toBeCloseTo(extent * Math.SQRT2, 9);
      expect(Math.abs(v.u)).toBeCloseTo(extent, 9);
    }
    // 外側の角は (12, -2)、内側は (8, 2)
    const xs = corner.map((v) => v.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(8, 9);
    expect(xs[1]).toBeCloseTo(12, 9);
  });

  it("角の長さが上限を超える鋭い折れは面取り：区間ごとに切りっぱなしにし、外側を三角形1つで埋める", () => {
    const m = mesh();
    // ほぼ折り返す（角の倍率は上限 MITER_LIMIT を超える）
    strokePolyline(m, [0, 0, 10, 0, 0, 1], 2, 1, WHITE, 1);
    // 端の2点 × 2 ＋ 折れ目の 4 ＋ 中心 1
    expect(m.vertices).toHaveLength(9);
    expect(m.triangles).toHaveLength(5);
    const extent = 1 + AA_MARGIN;
    for (const v of m.vertices.slice(2, 6)) expect(Math.hypot(v.x - 10, v.y)).toBeCloseTo(extent, 9);
    // 角を伸ばした場合の倍率 1/sin(折れ目の角/2)（上限を超えるので使わない）
    const angle = Math.PI - Math.abs(Math.atan2(1, -10));
    expect(1 / Math.sin(angle / 2)).toBeGreaterThan(MITER_LIMIT);
  });

  it("閉じた線は終点と始点もつなぐ（四角は4つの角、8つの三角形）", () => {
    const m = mesh();
    strokePolyline(m, [0, 0, 10, 0, 10, 10, 0, 10], 2, 1, WHITE, 1, true);
    expect(m.vertices).toHaveLength(8);
    expect(m.triangles).toHaveLength(8);
    // 終点が始点と重なっていても同じ
    const same = mesh();
    strokePolyline(same, [0, 0, 10, 0, 10, 10, 0, 10, 0, 0], 2, 1, WHITE, 1, true);
    expect(same.vertices).toHaveLength(8);
  });

  it("有限でない点と重なる点は飛ばし、2点に満たない・太さ 0 は描かない", () => {
    const m = mesh();
    strokePolyline(m, [0, 0, 0, 0, Number.NaN, 5, 10, 0], 2, 1, WHITE, 1);
    expect(m.vertices).toHaveLength(4);
    for (const points of [[], [1, 1], [1, 1, 1, 1]]) {
      const none = mesh();
      strokePolyline(none, points, 2, 1, WHITE, 1);
      expect(none.vertices).toHaveLength(0);
    }
    const zero = mesh();
    strokePolyline(zero, [0, 0, 10, 0], 0, 1, WHITE, 1);
    expect(zero.vertices).toHaveLength(0);
  });

  it("点ごとの濃さ（fades）：その点の頂点の色を、色ごと透明へ近づける（飛ばした点の分はずらさない）", () => {
    const red: Rgba = [1, 0, 0, 0.8];
    const m = mesh();
    // 2点目は重なるので飛ばす。残る点は元の 0・2・3 番目
    strokePolyline(m, [0, 0, 0, 0, 10, 0, 20, 0], 2, 1, red, 1, false, [0, 0.9, 0.5, 1]);
    expect(m.vertices).toHaveLength(6);
    expect(m.colors[0]).toEqual([0, 0, 0, 0]);
    expect(m.colors[1]).toEqual([0, 0, 0, 0]);
    expect(m.colors[2]).toEqual([0.5, 0, 0, 0.4]);
    expect(m.colors[4]).toBe(red);
    expect(m.vertices[4].a).toBeCloseTo(0.8, 6);
  });

  it("fadeColor：1 でそのまま、範囲の外は端に寄せ、有限でない値は透明", () => {
    const c: Rgba = [0.2, 0.4, 0.6, 1];
    expect(fadeColor(c, 1)).toBe(c);
    expect(fadeColor(c, 2)).toBe(c);
    expect(fadeColor(c, 0.5)).toEqual([0.1, 0.2, 0.3, 0.5]);
    expect(fadeColor(c, -1)).toEqual([0, 0, 0, 0]);
    expect(fadeColor(c, Number.NaN)).toEqual([0, 0, 0, 0]);
  });
});

describe("fillBand", () => {
  it("隣り合う位置の上下をつなぐ（3つの位置で4つの三角形）。面積は台形の合計", () => {
    const m = mesh();
    fillBand(m, [0, 10, 20], [0, 0, 0], [10, 20, 10], WHITE, 1);
    expect(m.vertices).toHaveLength(6);
    expect(m.triangles).toHaveLength(4);
    expect(area(m)).toBeCloseTo(((10 + 20) / 2) * 10 * 2, 6);
    for (const v of m.vertices) expect([v.u, v.v, v.w]).toEqual([0, FILL_EXTENT, 0]);
    expect(coverage(0, FILL_EXTENT, 0)).toBe(1);
  });

  it("有限でない位置で帯を切る", () => {
    const m = mesh();
    fillBand(m, [0, 10, 20], [0, Number.NaN, 0], [10, 10, 10], WHITE, 1);
    expect(m.triangles).toHaveLength(0);
  });

  it("上下が入れ替わる区間は、交わる点で左右の三角形に分ける（重ねて塗らず、面積は2つの三角形の合計）", () => {
    const m = mesh();
    // x 0→10 で、上の線は 0→10、下の線は 10→0。真ん中 (5, 5) で交わる
    fillBand(m, [0, 10], [0, 10], [10, 0], WHITE, 1);
    expect(m.triangles).toHaveLength(2);
    expect(m.vertices[4]).toMatchObject({ x: 5, y: 5 });
    // 左の三角形 (0,0)-(5,5)-(0,10) と右の三角形 (5,5)-(10,10)-(10,0)。どちらも面積 25
    expect(area(m)).toBeCloseTo(50, 6);
    // 端で触れるだけ（片側が 0）は分けない
    const touch = mesh();
    fillBand(touch, [0, 10], [0, 5], [10, 5], WHITE, 1);
    expect(touch.triangles).toHaveLength(2);
    expect(area(touch)).toBeCloseTo(50, 6);
  });
});

describe("fillPolygon", () => {
  it("点の平均を中心に扇形に分ける（四角は4つの三角形で、面積が一致）", () => {
    const m = mesh();
    fillPolygon(m, [0, 0, 10, 0, 10, 20, 0, 20], WHITE, 1);
    expect(m.triangles).toHaveLength(4);
    expect(m.vertices[0]).toMatchObject({ x: 5, y: 10 });
    expect(area(m)).toBeCloseTo(200, 6);
  });

  it("中心を渡すと、そこから扇形に分ける（点の平均から見て星形でない形も、中心から見て星形なら重ならない）", () => {
    // 中心 (0, 0) から見た星形：右へ長く伸びた形。点の平均は (10, 0) 付近にずれる
    const points = [40, 0, 2, 2, 0, 4, -2, 2, -4, 0, -2, -2, 0, -4, 2, -2];
    const m = mesh();
    fillPolygon(m, points, WHITE, 1, [0, 0]);
    expect(m.vertices[0]).toMatchObject({ x: 0, y: 0 });
    expect(m.triangles).toHaveLength(8);
    // 靴ひもの公式で求めた面積と一致する（重なりがない）
    let shoelace = 0;
    for (let i = 0; i < points.length; i += 2) {
      const j = (i + 2) % points.length;
      shoelace += points[i] * points[j + 1] - points[j] * points[i + 1];
    }
    expect(area(m)).toBeCloseTo(Math.abs(shoelace) / 2, 6);
  });

  it("3点に満たなければ描かない", () => {
    const m = mesh();
    fillPolygon(m, [0, 0, 1, 1], WHITE, 1);
    expect(m.vertices).toHaveLength(0);
  });
});

describe("fillRects", () => {
  it("四角ごとに4つの頂点と2つの三角形。幅か高さが 0 のものは描かない", () => {
    const m = mesh();
    fillRects(m, [0, 0, 10, 1, 5, 5, 0, 3, 2, 2, 3, 4], WHITE, 0.5);
    expect(m.vertices).toHaveLength(8);
    expect(m.triangles).toHaveLength(4);
    expect(area(m)).toBeCloseTo(10 + 12, 6);
    for (const v of m.vertices) expect(v.a).toBe(0.5);
  });

  it("四角ごとの不透明度（alphas）を掛ける。透明なものは描かない", () => {
    const m = mesh();
    fillRects(m, [0, 0, 1, 1, 2, 0, 1, 1, 4, 0, 1, 1], WHITE, 0.5, [1, 0, 0.4]);
    expect(m.vertices).toHaveLength(8);
    expect(m.vertices[0].a).toBe(0.5);
    expect(m.vertices[4]).toMatchObject({ x: 4, a: 0.2 });
  });
});

describe("fillPoints", () => {
  it("点ごとの半径と不透明度。円の外までぼかしの分だけ広げ、w に半径（デバイスピクセル）を持つ", () => {
    const m = mesh();
    fillPoints(m, [10, 10, 20, 20, 30, 30], [2, 0, 1], 2, WHITE, 0.5, [1, 1, 0.5]);
    // 半径 0 の点は描かない
    expect(m.vertices).toHaveLength(8);
    expect(m.triangles).toHaveLength(4);
    const first = m.vertices.slice(0, 4);
    for (const v of first) {
      expect(v.w).toBe(4);
      expect(Math.abs(v.u)).toBe(5);
      expect(Math.abs(v.x - 10)).toBeCloseTo(2.5, 9);
      expect(v.a).toBe(0.5);
    }
    for (const v of m.vertices.slice(4)) {
      expect(v.w).toBe(2);
      expect(v.a).toBe(0.25);
    }
    // 中心は覆い、半径のところで半分、外端で 0
    expect(coverage(0, 0, 4)).toBe(1);
    expect(coverage(4, 0, 4)).toBe(0.5);
    expect(coverage(5, 0, 4)).toBe(0);
  });

  it("半径が1つの値なら全部に使う", () => {
    const m = mesh();
    fillPoints(m, [0, 0, 1, 1], 1.5, 1, WHITE, 1);
    expect(m.vertices.every((v) => v.w === 1.5)).toBe(true);
  });
});

describe("imageQuad", () => {
  it("dest の四隅に、読み始めの位置から1周ぶんの横の座標を割り当てる（上が t = 0）", () => {
    const q = Array.from(imageQuad({ x: 1, y: 2, width: 10, height: 20 }, 3, 10));
    expect(q).toEqual([1, 2, 0.3, 0, 11, 2, 1.3, 0, 11, 22, 1.3, 1, 1, 22, 0.3, 1].map((v) => expect.closeTo(v, 6)));
  });
});
