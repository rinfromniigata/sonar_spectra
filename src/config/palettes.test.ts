import { describe, expect, it } from "vitest";
import type { CanvasColors } from "../theme/canvas_colors";
import { DEFAULT_PALETTE_ID, PRESET_PALETTES, presetSwatchColors, resolvePaletteColors } from "./palettes";

// 試験用の色の名前（実際の値はトークンから読む）
const COLORS: CanvasColors = {
  bg: "BG",
  grid: "GRID",
  line: "LINE",
  text: "TEXT",
  textMuted: "MUTED",
  neonA: "A",
  neonB: "B",
  neonC: "C",
  danger: "DANGER",
  fontNumeric: "NUMERIC",
  theme: "dark",
};

describe("標準の配色", () => {
  it("マゼンタ主・シアン主・アンバー主を、発光色の組み合わせで表す（モックの見本と同じ）", () => {
    const pick = (id: string) => {
      const c = resolvePaletteColors(id, COLORS);
      return [c.main, c.sub, c.accent];
    };
    expect(pick("preset.a")).toEqual(["A", "B", "C"]);
    expect(pick("preset.b")).toEqual(["B", "A", "C"]);
    expect(pick("preset.c")).toEqual(["C", "A", "C"]);
  });

  it("知らない配色IDは既定の配色にする", () => {
    expect(DEFAULT_PALETTE_ID).toBe("preset.a");
    const c = resolvePaletteColors("custom.removed", COLORS);
    expect([c.main, c.sub, c.accent]).toEqual(["A", "B", "C"]);
  });

  it("地の色・文字色・書体・テーマはそのまま渡す", () => {
    const c = resolvePaletteColors("preset.b", { ...COLORS, theme: "light" });
    expect(c).toMatchObject({ bg: "BG", grid: "GRID", text: "TEXT", textMuted: "MUTED", fontNumeric: "NUMERIC", theme: "light" });
  });

  it("見本の色はトークンの式で返す", () => {
    expect(presetSwatchColors(PRESET_PALETTES[1])).toEqual(["var(--color-neon-b)", "var(--color-neon-a)"]);
  });
});
