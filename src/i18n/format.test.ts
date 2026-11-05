import { describe, expect, it } from "vitest";
import { formatDate, formatDecibel, formatInteger, formatMultiplier, formatPercent } from "./format";

describe("format（ja）", () => {
  it("日付", () => {
    expect(formatDate(new Date(2026, 10, 4))).toBe("2026/11/04");
  });
  it("dB は小数1桁", () => {
    expect(formatDecibel(-12.345)).toBe("-12.3");
    expect(formatDecibel(0)).toBe("0.0");
  });
  it("倍率は小数2桁", () => {
    expect(formatMultiplier(1)).toBe("1.00");
    expect(formatMultiplier(0.25)).toBe("0.25");
  });
  it("割合は 0〜100 を受け取る", () => {
    expect(formatPercent(72)).toBe("72%");
  });
  it("整数", () => {
    expect(formatInteger(1234)).toBe("1,234");
  });
});
