import { describe, expect, it } from "vitest";
import { PSEUDO_LOCALE, languageTagOf, matchLocale, resolveLocale } from "./locale";

describe("resolveLocale", () => {
  it("保存値が対応している言語なら、それを使う", () => {
    expect(resolveLocale("ja", ["en-US"])).toBe("ja");
  });
  it("保存値がなければ、OSの言語から対応しているものを探す", () => {
    expect(resolveLocale(null, ["ja-JP"])).toBe("ja");
  });
  it("対応していない保存値やOSの言語は、原文の言語にフォールバックする", () => {
    expect(resolveLocale("fr", ["en-US", "zh-CN"])).toBe("ja");
    expect(resolveLocale(null, [])).toBe("ja");
  });
});

describe("matchLocale", () => {
  it("部分タグを落としながら照合する", () => {
    expect(matchLocale("ja-Jpan-JP")).toBe("ja");
    expect(matchLocale("JA")).toBe("ja");
    expect(matchLocale("en-US")).toBeNull();
  });
});

describe("languageTagOf", () => {
  it("疑似ロケールでは原文の言語タグを返す", () => {
    expect(languageTagOf(PSEUDO_LOCALE)).toBe("ja");
    expect(languageTagOf("ja")).toBe("ja");
  });
});
