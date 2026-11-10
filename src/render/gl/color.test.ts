import { describe, expect, it, vi } from "vitest";
import { TRANSPARENT, createColorResolver, parseCssColor } from "./color";

const close = (actual: readonly number[] | null, expected: number[]) => {
  expect(actual).not.toBeNull();
  actual!.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 6));
};

describe("parseCssColor", () => {
  it("#rrggbb・#rgb・#rrggbbaa・#rgba を読む（大文字も）", () => {
    close(parseCssColor("#ff2bd6"), [1, 0x2b / 255, 0xd6 / 255, 1]);
    close(parseCssColor("#F3F1FB"), [0xf3 / 255, 0xf1 / 255, 0xfb / 255, 1]);
    close(parseCssColor("#0f8"), [0, 1, 0x88 / 255, 1]);
    close(parseCssColor("#ff000080"), [1, 0, 0, 0x80 / 255]);
    close(parseCssColor("#f008"), [1, 0, 0, 0x88 / 255]);
  });

  it("トークンの rgb(r g b / a) と、カンマ区切りの rgb()・rgba()、% を読む", () => {
    close(parseCssColor("rgb(255 43 214 / 0.55)"), [1, 43 / 255, 214 / 255, 0.55]);
    close(parseCssColor("  rgb(0 0 0 / 0.28) "), [0, 0, 0, 0.28]);
    close(parseCssColor("rgb(24, 228, 255)"), [24 / 255, 228 / 255, 1, 1]);
    close(parseCssColor("rgba(24, 228, 255, 0.5)"), [24 / 255, 228 / 255, 1, 0.5]);
    close(parseCssColor("rgb(100% 50% 0% / 25%)"), [1, 0.5, 0, 0.25]);
  });

  it("範囲の外の値は 0〜1 に収める。transparent は透明", () => {
    close(parseCssColor("rgb(300 -5 0 / 2)"), [1, 0, 0, 1]);
    expect(parseCssColor("transparent")).toEqual(TRANSPARENT);
  });

  it("読めない形は null", () => {
    for (const text of ["", "red", "#12", "#12345", "#gg0000", "oklch(0.7 0.2 330)", "rgb(1 2)", "rgb(1, 2, x)", "rgb(1 2 3 / 0.5 / 1)"]) {
      expect(parseCssColor(text)).toBeNull();
    }
  });
});

describe("createColorResolver", () => {
  it("同じ文字列は使い回し、読めない形は fallback に任せ、それでも読めなければ透明", () => {
    const fallback = vi.fn((text: string) => (text === "red" ? ([1, 0, 0, 1] as const) : null));
    const resolve = createColorResolver(fallback);
    const a = resolve("#07060f");
    expect(resolve("#07060f")).toBe(a);
    expect(resolve("red")).toEqual([1, 0, 0, 1]);
    resolve("red");
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(resolve("nonsense")).toEqual(TRANSPARENT);
    expect(createColorResolver()("nonsense")).toEqual(TRANSPARENT);
  });
});
