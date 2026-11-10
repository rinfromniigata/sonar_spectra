import { describe, expect, it } from "vitest";
import { MAX_GRADIENT_STOPS, type Gradient } from "../../modules/types";
import { createColorResolver } from "./color";
import { gradientColorAt, gradientParameter, resolveGradient } from "./gradient";

const resolve = createColorResolver();

const linear = (stops: Gradient["stops"], y0 = 0, y1 = 100): Gradient => ({ kind: "linear", x0: 0, y0, x1: 0, y1, stops });

describe("resolveGradient", () => {
  it("直線：2点と、点の位置・色（RGBA、不透明度で掛けない値）を数値にする", () => {
    const g = resolveGradient(
      linear([
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "rgb(0 0 255 / 0.5)" },
      ]),
      resolve,
    )!;
    expect(g.kind).toBe(1);
    expect(Array.from(g.geometry)).toEqual([0, 0, 0, 100]);
    expect(g.count).toBe(2);
    expect(Array.from(g.offsets.subarray(0, 2))).toEqual([0, 1]);
    expect(Array.from(g.colors.subarray(0, 8))).toEqual([1, 0, 0, 1, 0, 0, 1, 0.5]);
  });

  it("円：中心と2つの半径", () => {
    const g = resolveGradient({ kind: "radial", x: 10, y: 20, r0: 3, r1: 30, stops: [{ offset: 0, color: "transparent" }] }, resolve)!;
    expect(g.kind).toBe(2);
    expect(Array.from(g.geometry)).toEqual([10, 20, 3, 30]);
    expect(Array.from(g.colors.subarray(0, 4))).toEqual([0, 0, 0, 0]);
  });

  it("点は offset の順に並べ（同じ offset は渡した順）、0〜1 に収め、先頭から上限の数まで使う", () => {
    const g = resolveGradient(
      linear([
        { offset: 0.8, color: "#000001" },
        { offset: 0.5, color: "#000002" },
        { offset: 0.5, color: "#000003" },
        { offset: -1, color: "#000004" },
        { offset: 2, color: "#000005" },
      ]),
      resolve,
    )!;
    expect(g.count).toBe(MAX_GRADIENT_STOPS);
    expect(Array.from(g.offsets)).toEqual([0, 0.5, 0.5, Math.fround(0.8)]);
    const blue = Array.from({ length: g.count }, (_, i) => Math.round(g.colors[i * 4 + 2] * 255));
    expect(blue).toEqual([4, 2, 3, 1]);
  });

  it("何も塗らないもの（点がない、直線の2点が同じ、2つの円の半径が同じ・負、有限でない値）は null", () => {
    const stop = [{ offset: 0, color: "#fff" }];
    expect(resolveGradient(linear([]), resolve)).toBeNull();
    expect(resolveGradient(linear(stop, 5, 5), resolve)).toBeNull();
    expect(resolveGradient(linear(stop, 0, Number.NaN), resolve)).toBeNull();
    expect(resolveGradient({ kind: "radial", x: 0, y: 0, r0: 5, r1: 5, stops: stop }, resolve)).toBeNull();
    expect(resolveGradient({ kind: "radial", x: 0, y: 0, r0: -1, r1: 5, stops: stop }, resolve)).toBeNull();
  });
});

describe("gradientParameter・gradientColorAt（シェーダーと同じ式）", () => {
  it("直線：2点を結ぶ向きへの射影の位置。横にずれても同じ値", () => {
    const g = resolveGradient(linear([{ offset: 0, color: "#fff" }], 10, 110), resolve)!;
    expect(gradientParameter(g, 0, 10)).toBe(0);
    expect(gradientParameter(g, 50, 60)).toBeCloseTo(0.5, 6);
    expect(gradientParameter(g, -7, 210)).toBeCloseTo(2, 6);
  });

  it("円：中心からの距離が r0 で 0、r1 で 1", () => {
    const g = resolveGradient({ kind: "radial", x: 0, y: 0, r0: 10, r1: 30, stops: [{ offset: 0, color: "#fff" }] }, resolve)!;
    expect(gradientParameter(g, 10, 0)).toBeCloseTo(0, 6);
    expect(gradientParameter(g, 0, -20)).toBeCloseTo(0.5, 6);
    expect(gradientParameter(g, 3, 4)).toBeCloseTo(-0.25, 6);
  });

  it("点の間は、不透明度で掛けない値のまま直線で移る（transparent へは黒くなりながら消える）。端より外は端の色", () => {
    const g = resolveGradient(
      linear([
        { offset: 0.2, color: "#ff8000" },
        { offset: 0.6, color: "transparent" },
      ]),
      resolve,
    )!;
    expect(gradientColorAt(g, -1)).toEqual([1, 128 / 255, 0, 1].map(Math.fround));
    const half = gradientColorAt(g, 0.4);
    expect(half[0]).toBeCloseTo(0.5, 6);
    expect(half[1]).toBeCloseTo(64 / 255, 6);
    expect(half[3]).toBeCloseTo(0.5, 6);
    expect(gradientColorAt(g, 0.9)).toEqual([0, 0, 0, 0]);
  });

  it("同じ offset の2点は、そこで色が切り替わる（間を補わない）", () => {
    const g = resolveGradient(
      linear([
        { offset: 0, color: "#000000" },
        { offset: 0.5, color: "#000000" },
        { offset: 0.5, color: "#ffffff" },
        { offset: 1, color: "#ffffff" },
      ]),
      resolve,
    )!;
    expect(gradientColorAt(g, 0.49)[0]).toBe(0);
    expect(gradientColorAt(g, 0.51)[0]).toBe(1);
  });

  it("スペクトラムの塗り：高さの 10% から 55% までは主色のまま、そこから下端で透明", () => {
    const h = 200;
    const g = resolveGradient(
      linear(
        [
          { offset: 0, color: "#00ff00" },
          { offset: 0.55, color: "#00ff00" },
          { offset: 1, color: "transparent" },
        ],
        h * 0.1,
        h,
      ),
      resolve,
    )!;
    const at = (y: number) => gradientColorAt(g, gradientParameter(g, 0, y));
    expect(at(0)[3]).toBe(1);
    expect(at(h * 0.1 + 0.55 * h * 0.9)[3]).toBeCloseTo(1, 5);
    expect(at(h)[3]).toBeCloseTo(0, 5);
  });
});
