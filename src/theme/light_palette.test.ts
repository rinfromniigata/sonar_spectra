import { describe, expect, it } from "vitest";
import tokensCss from "./tokens.css?raw";
import {
  CHROMA_SCALE,
  LIGHTNESS_SCALE,
  MIN_CONTRAST,
  contrastRatio,
  deriveLightColor,
  deriveLightPalette,
  fitToSrgb,
  formatHexColor,
  oklchToRgb,
  parseHexColor,
  rgbToOklch,
} from "./light_palette";

/** tokens.css の明示的なライト（`:root[data-theme="light"]`）から、色のトークンを読む */
function lightToken(name: string): string {
  const start = tokensCss.indexOf(':root[data-theme="light"]');
  const block = tokensCss.slice(start, tokensCss.indexOf("}", start));
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
  if (!match) throw new Error(`${name} がライトのブロックにない`);
  return match[1].trim();
}

const LIGHT_BG = lightToken("--color-bg");

function rgb(hex: string) {
  const value = parseHexColor(hex);
  if (!value) throw new Error(`読めない色: ${hex}`);
  return value;
}

function oklch(hex: string) {
  return rgbToOklch(rgb(hex));
}

/** 色相の差（度。0〜180） */
function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

describe("parseHexColor・formatHexColor", () => {
  it("#rrggbb と #rgb を読み、大文字と前後の空白を許す", () => {
    expect(parseHexColor("#ff0080")).toEqual([1, 0, 128 / 255]);
    expect(parseHexColor(" #F08 ")).toEqual([1, 0, 136 / 255]);
  });

  it("形式に合わないものは null", () => {
    for (const text of ["", "ff0080", "#ff008", "#ff00800", "#gg0000", "rgb(0 0 0)", "red"]) {
      expect(parseHexColor(text)).toBeNull();
    }
  });

  it("小文字の #rrggbb にし、範囲外は切り詰める", () => {
    expect(formatHexColor([1, 0, 128 / 255])).toBe("#ff0080");
    expect(formatHexColor([1.2, -0.1, 0.5])).toBe("#ff0080");
  });
});

describe("OKLCH の変換", () => {
  it("既知の値と合う（白・黒・sRGB の赤）", () => {
    const white = oklch("#ffffff");
    expect(white.l).toBeCloseTo(1, 3);
    expect(white.c).toBeLessThan(1e-3);
    expect(oklch("#000000")).toEqual({ l: 0, c: 0, h: 0 });
    // CSS Color 4 の例：sRGB の赤は oklch(62.8% 0.2577 29.23)
    const red = oklch("#ff0000");
    expect(red.l).toBeCloseTo(0.628, 3);
    expect(red.c).toBeCloseTo(0.2577, 3);
    expect(red.h).toBeCloseTo(29.23, 1);
  });

  it("sRGB → OKLCH → sRGB で元の色に戻る", () => {
    for (const hex of ["#ff2bd6", "#18e4ff", "#ffb547", "#b7ff3c", "#2a0a4a", "#808080", "#f3f1fb"]) {
      expect(formatHexColor(oklchToRgb(oklch(hex)))).toBe(hex);
    }
  });

  it("sRGB に収まらない色は、明度と色相を保って彩度だけを下げる", () => {
    const outside = { l: 0.6, c: 0.4, h: 140 };
    const fitted = fitToSrgb(outside);
    expect(fitted.l).toBe(outside.l);
    expect(fitted.h).toBe(outside.h);
    expect(fitted.c).toBeLessThan(outside.c);
    expect(fitted.c).toBeGreaterThan(0.1);
    for (const v of oklchToRgb(fitted)) {
      expect(v).toBeGreaterThanOrEqual(-1e-6);
      expect(v).toBeLessThanOrEqual(1 + 1e-6);
    }
    // 収まっている色はそのまま
    const inside = oklch("#8b5cff");
    expect(fitToSrgb(inside)).toEqual(inside);
  });
});

describe("contrastRatio", () => {
  it("黒と白は 21:1、同じ色は 1:1、順序によらない", () => {
    expect(contrastRatio(rgb("#000000"), rgb("#ffffff"))).toBeCloseTo(21, 5);
    expect(contrastRatio(rgb("#ff2bd6"), rgb("#ff2bd6"))).toBe(1);
    expect(contrastRatio(rgb("#007f9c"), rgb(LIGHT_BG))).toBeCloseTo(contrastRatio(rgb(LIGHT_BG), rgb("#007f9c")), 10);
  });

  it("W3-3・W5-4で測った値と合う（ライトの neon-b は地の色に対して約 4.16:1）", () => {
    expect(contrastRatio(rgb(lightToken("--color-neon-b")), rgb(LIGHT_BG))).toBeCloseTo(4.16, 2);
  });
});

describe("deriveLightColor", () => {
  // 彩度の高い黄緑・明るいシアン・暗い紫を含む、ダーク用として選ばれそうな色
  const samples = {
    彩度の高い黄緑: "#b7ff3c",
    明るいシアン: "#3df0ff",
    標準のシアン: "#18e4ff",
    暗い紫: "#2a0a4a",
    明るい紫: "#8b5cff",
    マゼンタ: "#ff2bd6",
    ピンク: "#ff3d9a",
    アンバー: "#ffb547",
    黄: "#ffd23d",
    純色の黄: "#ffff00",
    純色の緑: "#00ff00",
    純色の青: "#0000ff",
    白: "#ffffff",
    灰: "#888888",
    黒: "#000000",
  };

  for (const [name, dark] of Object.entries(samples)) {
    it(`${name}（${dark}）：ライトの地の色に対して ${MIN_CONTRAST}:1 以上で、暗く・彩度が落ちる`, () => {
      const light = deriveLightColor(dark, LIGHT_BG);
      expect(light).toMatch(/^#[0-9a-f]{6}$/);
      expect(contrastRatio(rgb(light!), rgb(LIGHT_BG))).toBeGreaterThanOrEqual(MIN_CONTRAST);

      const before = oklch(dark);
      const after = oklch(light!);
      // 丸め（#rrggbb）の誤差を見込む
      expect(after.l).toBeLessThanOrEqual(before.l * LIGHTNESS_SCALE + 0.005);
      expect(after.c).toBeLessThanOrEqual(before.c * CHROMA_SCALE + 0.005);
      if (before.c > 0.05) expect(hueDistance(after.h, before.h)).toBeLessThan(3);
    });
  }

  it("無彩色は無彩色のまま（3成分がそろう）", () => {
    for (const dark of ["#ffffff", "#888888"]) {
      const [r, g, b] = rgb(deriveLightColor(dark, LIGHT_BG)!);
      expect(r).toBe(g);
      expect(g).toBe(b);
    }
  });

  it("倍率を当てただけで届く色は、それ以上暗くしない", () => {
    // 暗い紫は倍率を当てた時点で十分なコントラストがある
    const dark = "#8b5cff";
    const after = oklch(deriveLightColor(dark, LIGHT_BG)!);
    expect(after.l).toBeCloseTo(oklch(dark).l * LIGHTNESS_SCALE, 2);
  });

  it("届かない色は、届く範囲でなるべく明るくする（ぎりぎり上まで）", () => {
    // 明るいシアンは明度を下げてやっと届くため、結果は 4.5:1 の少し上にとどまる
    const light = deriveLightColor("#3df0ff", LIGHT_BG)!;
    const ratio = contrastRatio(rgb(light), rgb(LIGHT_BG));
    expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(ratio).toBeLessThan(MIN_CONTRAST + 0.2);
  });

  it("ライトの面の色（白い面・一段上の面）にも同じ規則で作れる", () => {
    for (const token of ["--color-surface", "--color-surface-raised"]) {
      const bg = lightToken(token);
      for (const dark of Object.values(samples)) {
        expect(contrastRatio(rgb(deriveLightColor(dark, bg)!), rgb(bg))).toBeGreaterThanOrEqual(MIN_CONTRAST);
      }
    }
  });

  it("求めるコントラスト比を変えられる", () => {
    const light = deriveLightColor("#3df0ff", LIGHT_BG, 7)!;
    expect(contrastRatio(rgb(light), rgb(LIGHT_BG))).toBeGreaterThanOrEqual(7);
  });

  it("黒でも届かない地の色（中間の灰色）では、黒を返す", () => {
    expect(contrastRatio(rgb("#000000"), rgb("#6a6a6a"))).toBeLessThan(MIN_CONTRAST);
    expect(deriveLightColor("#3df0ff", "#6a6a6a")).toBe("#000000");
  });

  it("色か地の色が読めなければ null", () => {
    expect(deriveLightColor("not-a-color", LIGHT_BG)).toBeNull();
    expect(deriveLightColor("#3df0ff", "var(--color-bg)")).toBeNull();
  });
});

describe("deriveLightPalette", () => {
  it("3色をまとめてライト用にする（モックの「マイ配色 1」）", () => {
    const palette = { main: "#b7ff3c", sub: "#8b5cff", accent: "#ffb547" };
    const light = deriveLightPalette(palette, LIGHT_BG)!;
    expect(light).toEqual({
      main: deriveLightColor(palette.main, LIGHT_BG),
      sub: deriveLightColor(palette.sub, LIGHT_BG),
      accent: deriveLightColor(palette.accent, LIGHT_BG),
    });
    for (const color of Object.values(light)) {
      expect(contrastRatio(rgb(color), rgb(LIGHT_BG))).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("1色でも読めなければ null", () => {
    expect(deriveLightPalette({ main: "#b7ff3c", sub: "", accent: "#ffb547" }, LIGHT_BG)).toBeNull();
  });
});
