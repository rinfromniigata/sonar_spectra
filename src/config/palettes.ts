// 標準の配色（マゼンタ主・シアン主・アンバー主）。値は持たず、トークンの neon-a/b/c の組み合わせで表す。
// 組み合わせはモックの配色の見本（.sw-a1 など）とインスタンスの配色の差し替えに合わせる。
// 自分で作った配色（ライト用の色を自動で作る）は Phase 7 で足す。

import type { MessageKey } from "../i18n/use_t";
import type { PaletteColors } from "../modules/types";
import type { CanvasColors } from "../theme/canvas_colors";

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

/** 配色の見本（UiPaletteSwatch）に渡す CSS の色の式（主色・副色） */
export function presetSwatchColors(palette: PresetPalette): [string, string] {
  return [`var(--color-${palette.main})`, `var(--color-${palette.sub})`];
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

/** インスタンスの配色を当てた、描画に使う色。知らない配色IDは既定の配色にする */
export function resolvePaletteColors(paletteId: string, colors: CanvasColors): PaletteColors {
  const palette = findPresetPalette(paletteId) ?? findPresetPalette(DEFAULT_PALETTE_ID)!;
  return {
    main: neon(colors, palette.main),
    sub: neon(colors, palette.sub),
    accent: neon(colors, palette.accent),
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
