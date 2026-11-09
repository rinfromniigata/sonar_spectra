// 配色：標準の配色（マゼンタ主・シアン主・アンバー主）と、自分で作った配色（構成の customPalettes）。
// - 標準の配色は値を持たず、トークンの neon-a/b/c の組み合わせで表す。組み合わせはモックの配色の見本（.sw-a1 など）と
//   インスタンスの配色の差し替えに合わせる
// - 自分で作った配色は、主色・副色・強調色をダーク用の値（#rrggbb）で持つ。ライトテーマでは、その値から
//   ライト用の色を自動で作る（theme/light_palette。地の色に対して 4.5:1 以上）
// - 知らない配色ID（消した配色など）と、色が読めない自分で作った配色（壊れた構成ファイルなど）は、既定の配色にする

import type { MessageKey } from "../i18n/use_t";
import type { PaletteColors } from "../modules/types";
import type { CanvasColors } from "../theme/canvas_colors";
import { deriveLightPalette, parseHexColor, type PaletteTriple } from "../theme/light_palette";
import { darkToken, lightToken } from "../theme/token_values";
import type { Palette } from "./types";

/** トークンの発光色 */
export type NeonToken = "neon-a" | "neon-b" | "neon-c";

export interface PresetPalette {
  id: string;
  labelKey: MessageKey;
  main: NeonToken;
  sub: NeonToken;
  accent: NeonToken;
}

export const PRESET_PALETTES = [
  { id: "preset.a", labelKey: "palette.preset_magenta", main: "neon-a", sub: "neon-b", accent: "neon-c" },
  { id: "preset.b", labelKey: "palette.preset_cyan", main: "neon-b", sub: "neon-a", accent: "neon-c" },
  // モックのとおり、強調色はアンバーのまま（主色と同じ）
  { id: "preset.c", labelKey: "palette.preset_amber", main: "neon-c", sub: "neon-a", accent: "neon-c" },
] as const satisfies readonly PresetPalette[];

/** 既定の配色（マゼンタ主）。使っていた配色が消えたときもこれに戻す */
export const DEFAULT_PALETTE_ID = "preset.a";

export function findPresetPalette(id: string): PresetPalette | undefined {
  return PRESET_PALETTES.find((p) => p.id === id);
}

export function findCustomPalette(id: string, customPalettes: readonly Palette[]): Palette | undefined {
  return customPalettes.find((p) => p.id === id);
}

/** 自分で作った配色の3色が、どれも `#rgb`・`#rrggbb` として読めるか */
export function hasValidColors(palette: PaletteTriple): boolean {
  return [palette.main, palette.sub, palette.accent].every((color) => parseHexColor(color) !== null);
}

/** 配色の見本（UiPaletteSwatch）に渡す CSS の色の式（主色・副色） */
export function presetSwatchColors(palette: PresetPalette): [string, string] {
  return [`var(--color-${palette.main})`, `var(--color-${palette.sub})`];
}

/** 標準の配色のダーク用の値（tokens.css のダークの発光色）。複製・新規作成の初期値に使う */
export function presetDarkColors(palette: PresetPalette): PaletteTriple {
  const value = (token: NeonToken) => darkToken(`--color-${token}`).toLowerCase();
  return { main: value(palette.main), sub: value(palette.sub), accent: value(palette.accent) };
}

/**
 * 配色IDのダーク用の値。自分で作った配色はその値、標準の配色はトークンのダークの値。
 * 知らないIDは既定の配色の値（インスタンスの今の配色から新しい配色を作るときに使う）
 */
export function paletteDarkColors(paletteId: string, customPalettes: readonly Palette[]): PaletteTriple {
  const custom = findCustomPalette(paletteId, customPalettes);
  if (custom) return { main: custom.main, sub: custom.sub, accent: custom.accent };
  return presetDarkColors(findPresetPalette(paletteId) ?? findPresetPalette(DEFAULT_PALETTE_ID)!);
}

/**
 * 自分で作った配色の見本の色（主色・副色）。テーマに合わせて色が変わるよう、CSS の `light-dark()` で
 * ライト用（自動で作った色）とダーク用（保存した値）を並べる（tokens.css がテーマごとに color-scheme を決める）。
 * 色が読めなければ既定の配色の見本にする
 */
export function customSwatchColors(palette: Palette): [string, string] {
  const light = deriveLightPalette(palette, lightToken("--color-bg"));
  if (!light) return presetSwatchColors(findPresetPalette(DEFAULT_PALETTE_ID)!);
  return [`light-dark(${light.main}, ${palette.main})`, `light-dark(${light.sub}, ${palette.sub})`];
}

function neon(colors: CanvasColors, token: NeonToken): string {
  switch (token) {
    case "neon-a":
      return colors.neonA;
    case "neon-b":
      return colors.neonB;
    case "neon-c":
      return colors.neonC;
  }
}

/** 発光色の3つ（主色・副色・強調色）を、今のテーマで決める */
function glowColors(paletteId: string, colors: CanvasColors, customPalettes: readonly Palette[]): PaletteTriple {
  const custom = findCustomPalette(paletteId, customPalettes);
  if (custom && hasValidColors(custom)) {
    // ダークは保存した値をそのまま、ライトは今の地の色に対して作る
    if (colors.theme === "dark") return { main: custom.main, sub: custom.sub, accent: custom.accent };
    const light = deriveLightPalette(custom, colors.bg);
    if (light) return light;
  }
  const preset = findPresetPalette(paletteId) ?? findPresetPalette(DEFAULT_PALETTE_ID)!;
  return { main: neon(colors, preset.main), sub: neon(colors, preset.sub), accent: neon(colors, preset.accent) };
}

/** インスタンスの配色を当てた、描画に使う色。知らない配色IDは既定の配色にする */
export function resolvePaletteColors(
  paletteId: string,
  colors: CanvasColors,
  customPalettes: readonly Palette[] = [],
): PaletteColors {
  return {
    ...glowColors(paletteId, colors, customPalettes),
    bg: colors.bg,
    grid: colors.grid,
    line: colors.line,
    text: colors.text,
    textMuted: colors.textMuted,
    danger: colors.danger,
    fontNumeric: colors.fontNumeric,
    theme: colors.theme,
  };
}
