import { describe, expect, it } from "vitest";
import { readCanvasColors } from "./canvas_colors";

describe("readCanvasColors", () => {
  it("カスタムプロパティを読み、前後の空白を除く", () => {
    const values: Record<string, string> = {
      "--color-bg": " bg-value",
      "--color-neon-a": "neon-a-value ",
      "--font-numeric": ' "Azeret Mono", monospace',
      "color-scheme": "dark",
    };
    const colors = readCanvasColors((p) => values[p] ?? "");
    expect(colors.bg).toBe("bg-value");
    expect(colors.neonA).toBe("neon-a-value");
    expect(colors.fontNumeric).toBe('"Azeret Mono", monospace');
    expect(colors.theme).toBe("dark");
  });

  it("読むのはトークンだけ", () => {
    const asked: string[] = [];
    readCanvasColors((p) => {
      asked.push(p);
      return "";
    });
    expect(asked.filter((p) => p !== "color-scheme").every((p) => p.startsWith("--color-") || p.startsWith("--font-"))).toBe(true);
  });

  it("color-scheme からテーマを判定する", () => {
    expect(readCanvasColors((p) => (p === "color-scheme" ? "light" : "")).theme).toBe("light");
    expect(readCanvasColors(() => "").theme).toBe("dark");
  });
});
