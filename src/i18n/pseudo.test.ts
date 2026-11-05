import { describe, expect, it } from "vitest";
import ja from "./locales/ja";
import { createPseudoMessages, pseudoString } from "./pseudo";

describe("pseudoString", () => {
  it("⟦…⟧で囲み、3〜4割伸ばす", () => {
    const source = "音を待っています";
    const result = pseudoString(source);
    expect(result.startsWith(`⟦${source}`)).toBe(true);
    expect(result.endsWith("⟧")).toBe(true);
    const padding = result.length - source.length - 2;
    expect(padding).toBeGreaterThanOrEqual(Math.floor(source.length * 0.3));
    expect(padding).toBeLessThanOrEqual(Math.ceil(source.length * 0.4));
  });
  it("プレースホルダはそのまま残す", () => {
    expect(pseudoString("ピーク {value} dB")).toContain("{value}");
  });
});

describe("createPseudoMessages", () => {
  it("原文と同じ形の辞書を作る", () => {
    const pseudo = createPseudoMessages(ja);
    expect(Object.keys(pseudo)).toEqual(Object.keys(ja));
    expect(pseudo.title_bar.settings).toBe(pseudoString(ja.title_bar.settings));
    expect(pseudo.instance.direction.up).toBe(pseudoString(ja.instance.direction.up));
  });
});
