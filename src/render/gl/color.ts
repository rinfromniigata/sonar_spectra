// 色の変換（imple 4.6）：テーマ・配色の色（CSS の色の文字列）を、WebGL に渡す RGBA（0〜1、不透明度で掛けていない値）に直す。
// トークンと配色の色は16進（#rrggbb）か rgb 関数（空白区切りと / の不透明度）の形なので、それらは文字列から直接読む（純粋関数）。
// それ以外の形（色の名前など）は、ブラウザに解釈させる手段（fallback）に任せる。同じ文字列は使い回す。

export type Rgba = readonly [number, number, number, number];

export const TRANSPARENT: Rgba = [0, 0, 0, 0];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function parseHex(hex: string): Rgba | null {
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  const digit = (i: number) => Number.parseInt(hex[i], 16);
  const pair = (i: number) => Number.parseInt(hex.slice(i, i + 2), 16);
  switch (hex.length) {
    case 3:
    case 4:
      return [
        (digit(0) * 17) / 255,
        (digit(1) * 17) / 255,
        (digit(2) * 17) / 255,
        hex.length === 4 ? (digit(3) * 17) / 255 : 1,
      ];
    case 6:
    case 8:
      return [pair(0) / 255, pair(2) / 255, pair(4) / 255, hex.length === 8 ? pair(6) / 255 : 1];
    default:
      return null;
  }
}

/** rgb 関数の1つの値（0〜255 か %）。読めなければ NaN */
function channel(text: string): number {
  if (text.endsWith("%")) return clamp01(Number.parseFloat(text) / 100);
  return clamp01(Number(text) / 255);
}

/** 不透明度（0〜1 か %）。読めなければ NaN */
function alphaValue(text: string): number {
  if (text.endsWith("%")) return clamp01(Number.parseFloat(text) / 100);
  return clamp01(Number(text));
}

function parseRgbFunction(body: string): Rgba | null {
  // カンマ区切り（r, g, b と r, g, b, a）と、空白区切り（r g b / a）
  let parts: string[];
  let alpha = "1";
  if (body.includes(",")) {
    parts = body.split(",").map((s) => s.trim());
    if (parts.length === 4) alpha = parts.pop()!;
  } else {
    const [color, slashAlpha, ...rest] = body.split("/").map((s) => s.trim());
    if (rest.length > 0) return null;
    parts = color.split(/\s+/).filter((s) => s !== "");
    if (slashAlpha !== undefined) alpha = slashAlpha;
  }
  if (parts.length !== 3) return null;
  const values = [...parts.map(channel), alphaValue(alpha)];
  if (values.some((v) => Number.isNaN(v))) return null;
  return values as unknown as Rgba;
}

/**
 * CSS の色の文字列を RGBA（0〜1）にする。16進（3・4・6・8桁）と、rgb・rgba の関数（カンマ区切り・空白区切り・
 * / の不透明度・%）と transparent を読む。読めない形なら null
 */
export function parseCssColor(text: string): Rgba | null {
  const value = text.trim().toLowerCase();
  if (value === "transparent") return TRANSPARENT;
  if (value.startsWith("#")) return parseHex(value.slice(1));
  const match = /^rgba?[(](.*)[)]$/.exec(value);
  return match ? parseRgbFunction(match[1]) : null;
}

/** 文字列を読めないときに、ブラウザに解釈させる手段 */
export type ColorFallback = (text: string) => Rgba | null;

/** 使い回す色の数の上限（自分で作った配色を編集し続けても増え続けないように） */
const CACHE_LIMIT = 256;

/**
 * 色の文字列を RGBA に直す関数を作る。同じ文字列は使い回す。直接読めない形は fallback に任せ、それでも読めなければ透明
 */
export function createColorResolver(fallback?: ColorFallback): (text: string) => Rgba {
  const cache = new Map<string, Rgba>();
  return (text) => {
    const hit = cache.get(text);
    if (hit) return hit;
    const rgba = parseCssColor(text) ?? fallback?.(text) ?? TRANSPARENT;
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(text, rgba);
    return rgba;
  };
}

/** ブラウザの Canvas 2D に色を塗らせて、1ピクセルを読む（色の名前・ほかの色空間の関数などに使う） */
export function canvasColorFallback(): ColorFallback {
  let ctx: CanvasRenderingContext2D | null | undefined;
  return (text) => {
    if (ctx === undefined) {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      ctx = canvas.getContext("2d", { willReadFrequently: true });
    }
    if (!ctx) return null;
    if (!CSS.supports("color", text)) return null;
    ctx.fillStyle = text;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
  };
}
