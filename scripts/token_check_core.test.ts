import { describe, expect, it } from "vitest";
import { findHardcodedValues } from "./token_check_core";

const texts = (source: string) => findHardcodedValues(source).map((f) => `${f.kind}:${f.text}`);

describe("findHardcodedValues", () => {
  it("色の直書きを見つける", () => {
    expect(texts("color: #fff; background: #07060f80;")).toEqual(["color:#fff", "color:#07060f80"]);
    expect(texts("fill: rgb(0 0 0 / 0.5); stroke: oklch(70% 0.2 300);")).toEqual(["color:rgb(", "color:oklch("]);
  });
  it("px値の直書きを見つける（0px は対象外）", () => {
    expect(texts("margin: 12px 0px 0.5px;")).toEqual(["px:12px", "px:0.5px"]);
  });
  it("トークンの参照や、色に見えない文字列は対象外", () => {
    expect(texts("color: var(--color-text); gap: var(--space-2);")).toEqual([]);
    expect(texts('mount("#app"); const id = "#section";')).toEqual([]);
    expect(texts("const width = calc(100% - var(--space-4));")).toEqual([]);
  });
  it("理由つきの印がある行は検査しない", () => {
    expect(texts("width: 1px; /* token-check-ignore: ヘアラインのため */")).toEqual([]);
    expect(texts("width: 1px; /* token-check-ignore: */")).toEqual(["px:1px"]);
  });
  it("行と列を返す", () => {
    expect(findHardcodedValues("a\n  b: #abc")[0]).toMatchObject({ line: 2, column: 6 });
  });
});
