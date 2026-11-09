import { describe, expect, it } from "vitest";
import tokensCss from "./tokens.css?raw";
import { darkToken, lightToken, parseTokenBlock } from "./token_values";

describe("parseTokenBlock", () => {
  it("セレクタのブロックの宣言を読み、コメントを除く", () => {
    const css = ":root {\n  --a: #fff; /* 白 */\n  --b: rgb(0 0 0 / 0.5);\n}\n.x { --a: red; }";
    const table = parseTokenBlock(css, ":root {");
    expect(table.get("--a")).toBe("#fff");
    expect(table.get("--b")).toBe("rgb(0 0 0 / 0.5)");
    expect(table.size).toBe(2);
  });

  it("セレクタがなければ空", () => {
    expect(parseTokenBlock(":root { --a: 1; }", ".nope").size).toBe(0);
  });
});

describe("darkToken・lightToken", () => {
  it("tokens.css のダーク（:root）と明示指定のライトの値を読む", () => {
    expect(darkToken("--color-neon-a")).toBe(parseTokenBlock(tokensCss, ":root {").get("--color-neon-a"));
    expect(lightToken("--color-bg")).toBe(parseTokenBlock(tokensCss, ':root[data-theme="light"]').get("--color-bg"));
    // ダークとライトで違う値になる
    expect(darkToken("--color-bg")).not.toBe(lightToken("--color-bg"));
    for (const value of [darkToken("--color-neon-a"), darkToken("--color-neon-b"), darkToken("--color-neon-c"), lightToken("--color-bg")]) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("ない宣言は例外にする（トークンの名前の打ち間違いに気づけるように）", () => {
    expect(() => darkToken("--color-nope")).toThrow();
    expect(() => lightToken("--color-nope")).toThrow();
  });
});
