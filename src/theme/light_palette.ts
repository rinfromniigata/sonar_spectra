// 自分で作った配色（ダーク用の値）から、ライトテーマ用の色を作る（imple 4.4、SPEC の委任事項）。
// OKLCH で明度と彩度を下げ、ライトの地の色に対して 4.5:1 以上になるまで明度を下げる。
// 色の計算は Björn Ottosson の OKLab（https://bottosson.github.io/posts/oklab/）による。

/** sRGB の 0〜1 の3成分 */
export type Rgb = readonly [number, number, number];

/** OKLCH（L は 0〜1、C は 0 以上、h は度。無彩色では h は 0） */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

/** 小さな文字に要るコントラスト比（WCAG 2.x の AA） */
export const MIN_CONTRAST = 4.5;

/**
 * 最初に当てる明度と彩度の倍率。標準の配色のダーク→ライトの対（tokens.css の neon-a/b/c）の
 * 変化量の平均に合わせてある（OKLCH で明度は 0.66〜0.81 倍・平均約 0.71、彩度は 0.71〜0.87 倍・平均約 0.81）
 */
export const LIGHTNESS_SCALE = 0.7;
export const CHROMA_SCALE = 0.8;

/** `#rgb`・`#rrggbb` を 0〜1 の sRGB にする。読めなければ null */
export function parseHexColor(text: string): Rgb | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = [...hex].map((d) => d + d).join("");
  const n = Number.parseInt(hex, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/** 0〜1 の sRGB を `#rrggbb`（小文字）にする。範囲外は切り詰める */
export function formatHexColor(rgb: Rgb): string {
  return (
    "#" +
    rgb
      .map((v) =>
        Math.round(Math.min(1, Math.max(0, v)) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function fromLinear(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** sRGB → OKLCH */
export function rgbToOklch(rgb: Rgb): Oklch {
  const [r, g, b] = rgb.map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const c = Math.hypot(A, B);
  // 無彩色（C がほぼ 0）では色相に意味がないため 0 にする
  const h = c < 1e-7 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

/** OKLCH → sRGB（0〜1。範囲外の値もそのまま返す） */
export function oklchToRgb({ l: L, c, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

const GAMUT_EPSILON = 1e-6;

function inGamut(rgb: Rgb): boolean {
  return rgb.every((v) => v >= -GAMUT_EPSILON && v <= 1 + GAMUT_EPSILON);
}

/**
 * sRGB に収まらない色を、明度と色相を保ったまま彩度を下げて収める（二分探索）
 */
export function fitToSrgb(color: Oklch): Oklch {
  if (inGamut(oklchToRgb(color))) return color;
  let lo = 0;
  let hi = color.c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(oklchToRgb({ ...color, c: mid }))) lo = mid;
    else hi = mid;
  }
  return { ...color, c: lo };
}

/** WCAG 2.x の相対輝度 */
export function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x のコントラスト比（1〜21） */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** OKLCH の色を sRGB に収めて `#rrggbb` に丸めたもの（丸めた後の値でコントラストを測るため） */
function toHexRgb(color: Oklch): Rgb {
  let rgb: Rgb = oklchToRgb(fitToSrgb(color));
  // 無彩色は変換の誤差で成分がわずかにずれて色が付くため、3成分をそろえる
  if (color.c < 1e-7) {
    const gray = (rgb[0] + rgb[1] + rgb[2]) / 3;
    rgb = [gray, gray, gray];
  }
  return parseHexColor(formatHexColor(rgb))!;
}

/**
 * ダーク用の色から、ライトテーマ用の色を作る。
 *
 * 1. OKLCH で明度に `LIGHTNESS_SCALE`、彩度に `CHROMA_SCALE` を掛ける（暗く・彩度を落とす）
 * 2. sRGB に収まらなければ、明度と色相を保って彩度を下げる
 * 3. `lightBg` に対するコントラストが `minContrast` に届かなければ、届くまで明度を下げる
 *    （`#rrggbb` に丸めた後の値で測る）
 *
 * `lightBg` は明るい地の色（ライトの `--color-bg` など）を前提にする。
 * 地の色が暗すぎて黒でも届かない場合は、明度 0（黒）を返す。
 * `dark` か `lightBg` が `#rgb`・`#rrggbb` として読めなければ null を返す
 */
export function deriveLightColor(dark: string, lightBg: string, minContrast = MIN_CONTRAST): string | null {
  const source = parseHexColor(dark);
  const bg = parseHexColor(lightBg);
  if (!source || !bg) return null;

  const base = rgbToOklch(source);
  const start: Oklch = { l: base.l * LIGHTNESS_SCALE, c: base.c * CHROMA_SCALE, h: base.h };
  const passes = (l: number) => contrastRatio(toHexRgb({ ...start, l }), bg) >= minContrast;

  if (passes(start.l)) return formatHexColor(toHexRgb(start));

  // 明度を下げるほど地（明るい色）とのコントラストは上がる。届く明度のうち最も明るいものを探す
  let lo = 0;
  let hi = start.l;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (passes(mid)) lo = mid;
    else hi = mid;
  }
  // 丸めや彩度の切り詰めで単調でない所に当たったときのため、届くまで少しずつ下げる
  let l = lo;
  while (l > 0 && !passes(l)) l = Math.max(0, l - 0.002);
  return formatHexColor(toHexRgb({ ...start, l }));
}

/** 自分で作った配色の3色（ダーク用の値） */
export interface PaletteTriple {
  main: string;
  sub: string;
  accent: string;
}

/**
 * 配色の3色をまとめてライト用にする。どれか1色でも読めなければ null
 */
export function deriveLightPalette(
  palette: PaletteTriple,
  lightBg: string,
  minContrast = MIN_CONTRAST,
): PaletteTriple | null {
  const main = deriveLightColor(palette.main, lightBg, minContrast);
  const sub = deriveLightColor(palette.sub, lightBg, minContrast);
  const accent = deriveLightColor(palette.accent, lightBg, minContrast);
  if (main === null || sub === null || accent === null) return null;
  return { main, sub, accent };
}
