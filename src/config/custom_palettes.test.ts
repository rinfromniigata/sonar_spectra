import { describe, expect, it } from "vitest";
import { moduleRegistry } from "../modules";
import {
  CUSTOM_PALETTE_ID_PREFIX,
  PALETTE_NAME_MAX_LENGTH,
  addPalette,
  createPaletteId,
  nextPaletteName,
  normalizeColor,
  normalizePaletteName,
  removePalette,
  updatePalette,
} from "./custom_palettes";
import { DEFAULT_PALETTE_ID } from "./palettes";
import { createDefaultState } from "./persisted_state";
import type { Config, Instance, Palette } from "./types";

const MINE: Palette = { id: "custom.mine", name: "マイ配色 1", main: "#b7ff3c", sub: "#8b5cff", accent: "#ffb547" };

function baseConfig(): Config {
  return createDefaultState({ registry: moduleRegistry, defaultName: "既定" }).current;
}

function withMine(): Config {
  return addPalette(baseConfig(), MINE)!;
}

describe("名前と色の整え方", () => {
  it("IDは custom. で始まり、毎回違う", () => {
    const a = createPaletteId();
    expect(a.startsWith(CUSTOM_PALETTE_ID_PREFIX)).toBe(true);
    expect(createPaletteId()).not.toBe(a);
  });

  it("色は #rrggbb の小文字にそろえ、読めなければ null", () => {
    expect(normalizeColor("#B7FF3C")).toBe("#b7ff3c");
    expect(normalizeColor("#abc")).toBe("#aabbcc");
    expect(normalizeColor("blue")).toBeNull();
  });

  it("名前は前後の空白を除き、上限の文字数までにする。空なら null", () => {
    expect(normalizePaletteName("  夜明け  ")).toBe("夜明け");
    expect(normalizePaletteName("   ")).toBeNull();
    expect([...normalizePaletteName("あ".repeat(PALETTE_NAME_MAX_LENGTH + 5))!]).toHaveLength(PALETTE_NAME_MAX_LENGTH);
  });

  it("新しい名前は、まだない「マイ配色 n」のうち n が最も小さいもの", () => {
    const format = (n: number) => `マイ配色 ${n}`;
    expect(nextPaletteName([], format)).toBe("マイ配色 1");
    expect(nextPaletteName([MINE], format)).toBe("マイ配色 2");
    // 1 を消したあとは 1 から埋める
    expect(nextPaletteName([{ ...MINE, name: "マイ配色 2" }], format)).toBe("マイ配色 1");
  });
});

describe("addPalette", () => {
  it("末尾に足し、色をそろえる。インスタンスは変えない（imple 5.2 の10）", () => {
    const base = baseConfig();
    const next = addPalette(base, { ...MINE, main: "#B7FF3C" })!;
    expect(next.customPalettes).toEqual([MINE]);
    expect(next.layout).toBe(base.layout);
    expect(base.customPalettes).toEqual([]);
  });

  it("読めない色・空の名前・同じIDは足さない", () => {
    expect(addPalette(baseConfig(), { ...MINE, sub: "x" })).toBeNull();
    expect(addPalette(baseConfig(), { ...MINE, name: " " })).toBeNull();
    expect(addPalette(withMine(), MINE)).toBeNull();
  });
});

describe("updatePalette", () => {
  it("名前と色を変える。ほかの配色とインスタンスは変えない", () => {
    const base = addPalette(withMine(), { ...MINE, id: "custom.other", name: "別" })!;
    const next = updatePalette(base, MINE.id, { name: "夜明け", main: "#FF3D9A" })!;
    expect(next.customPalettes[0]).toEqual({ ...MINE, name: "夜明け", main: "#ff3d9a" });
    expect(next.customPalettes[1]).toBe(base.customPalettes[1]);
    expect(next.layout).toBe(base.layout);
  });

  it("空の名前・読めない色は無視する。何も変わらなければ null（「保存後に変更あり」にしない）", () => {
    const base = withMine();
    expect(updatePalette(base, MINE.id, { name: "  " })).toBeNull();
    expect(updatePalette(base, MINE.id, { accent: "nope" })).toBeNull();
    expect(updatePalette(base, MINE.id, { main: MINE.main.toUpperCase() })).toBeNull();
    expect(updatePalette(base, "custom.none", { name: "x" })).toBeNull();
    // 標準の配色は編集できない
    expect(updatePalette(base, "preset.a", { name: "x" })).toBeNull();
  });
});

describe("removePalette", () => {
  it("消すと、それを使っていたインスタンスだけ既定の配色に戻る（imple 5.4）", () => {
    const base = withMine();
    const [first, second, third] = base.layout.instances;
    first.paletteId = MINE.id;
    second.paletteId = "preset.c";
    third.paletteId = MINE.id;
    const next = removePalette(base, MINE.id)!;
    expect(next.customPalettes).toEqual([]);
    expect(next.layout.instances.map((i) => i.paletteId).slice(0, 3)).toEqual([DEFAULT_PALETTE_ID, "preset.c", DEFAULT_PALETTE_ID]);
    // 配色のほかは変えない
    const withoutPalette = (list: readonly Instance[]) => list.map((i) => ({ ...i, paletteId: "" }));
    expect(withoutPalette(next.layout.instances)).toEqual(withoutPalette(base.layout.instances));
    expect(next.layout.mode).toBe(base.layout.mode);
  });

  it("ない配色・標準の配色は消せない", () => {
    expect(removePalette(withMine(), "custom.none")).toBeNull();
    expect(removePalette(withMine(), "preset.a")).toBeNull();
  });
});
