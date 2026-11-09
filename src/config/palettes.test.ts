import { describe, expect, it } from "vitest";
import type { CanvasColors } from "../theme/canvas_colors";
import { MIN_CONTRAST, contrastRatio, deriveLightPalette, parseHexColor } from "../theme/light_palette";
import { darkToken, lightToken } from "../theme/token_values";
import {
  DEFAULT_PALETTE_ID,
  PRESET_PALETTES,
  customSwatchColors,
  hasValidColors,
  paletteDarkColors,
  presetDarkColors,
  presetSwatchColors,
  resolvePaletteColors,
} from "./palettes";
import type { Palette } from "./types";

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

/** モックの「マイ配色 1」（ダーク用の値） */
const MINE: Palette = { id: "custom.mine", name: "マイ配色 1", main: "#b7ff3c", sub: "#8b5cff", accent: "#ffb547" };

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
    const c = resolvePaletteColors("custom.removed", COLORS, [MINE]);
    expect([c.main, c.sub, c.accent]).toEqual(["A", "B", "C"]);
  });

  it("地の色・文字色・書体・テーマはそのまま渡す", () => {
    const c = resolvePaletteColors("preset.b", { ...COLORS, theme: "light" });
    expect(c).toMatchObject({ bg: "BG", grid: "GRID", text: "TEXT", textMuted: "MUTED", fontNumeric: "NUMERIC", theme: "light" });
  });

  it("見本の色はトークンの式で返す", () => {
    expect(presetSwatchColors(PRESET_PALETTES[1])).toEqual(["var(--color-neon-b)", "var(--color-neon-a)"]);
  });

  it("ダーク用の値は、tokens.css のダークの発光色を組み合わせる（複製・新規作成の初期値）", () => {
    const [a, b, c] = ["--color-neon-a", "--color-neon-b", "--color-neon-c"].map((name) => darkToken(name).toLowerCase());
    expect(presetDarkColors(PRESET_PALETTES[0])).toEqual({ main: a, sub: b, accent: c });
    expect(presetDarkColors(PRESET_PALETTES[1])).toEqual({ main: b, sub: a, accent: c });
    expect(presetDarkColors(PRESET_PALETTES[2])).toEqual({ main: c, sub: a, accent: c });
  });
});

describe("自分で作った配色", () => {
  it("ダークでは保存した値をそのまま使う", () => {
    const c = resolvePaletteColors(MINE.id, COLORS, [MINE]);
    expect([c.main, c.sub, c.accent]).toEqual([MINE.main, MINE.sub, MINE.accent]);
    expect(c.bg).toBe("BG");
  });

  it("ライトでは、今の地の色に対して作ったライト用の色を使う（4.5:1 以上）", () => {
    const bg = lightToken("--color-bg");
    const c = resolvePaletteColors(MINE.id, { ...COLORS, bg, theme: "light" }, [MINE]);
    expect({ main: c.main, sub: c.sub, accent: c.accent }).toEqual(deriveLightPalette(MINE, bg));
    for (const color of [c.main, c.sub, c.accent]) {
      expect(contrastRatio(parseHexColor(color)!, parseHexColor(bg)!)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("色が読めない配色（壊れた構成ファイルなど）は、既定の配色にする", () => {
    const broken: Palette = { ...MINE, sub: "purple" };
    expect(hasValidColors(broken)).toBe(false);
    expect(hasValidColors(MINE)).toBe(true);
    for (const theme of ["dark", "light"] as const) {
      const c = resolvePaletteColors(broken.id, { ...COLORS, bg: lightToken("--color-bg"), theme }, [broken]);
      expect([c.main, c.sub, c.accent]).toEqual(["A", "B", "C"]);
    }
  });

  it("見本の色は、light-dark() でライト用（自動で作った色）とダーク用（保存した値）を並べる", () => {
    const light = deriveLightPalette(MINE, lightToken("--color-bg"))!;
    expect(customSwatchColors(MINE)).toEqual([`light-dark(${light.main}, ${MINE.main})`, `light-dark(${light.sub}, ${MINE.sub})`]);
    // 読めなければ既定の配色の見本
    expect(customSwatchColors({ ...MINE, main: "" })).toEqual(presetSwatchColors(PRESET_PALETTES[0]));
  });

  it("配色IDのダーク用の値：自分で作った配色はその値、標準はトークン、知らないIDは既定の配色", () => {
    expect(paletteDarkColors(MINE.id, [MINE])).toEqual({ main: MINE.main, sub: MINE.sub, accent: MINE.accent });
    expect(paletteDarkColors("preset.b", [MINE])).toEqual(presetDarkColors(PRESET_PALETTES[1]));
    expect(paletteDarkColors("custom.removed", [MINE])).toEqual(presetDarkColors(PRESET_PALETTES[0]));
  });
});
