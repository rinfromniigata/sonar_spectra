import { describe, expect, it } from "vitest";
import { placePopover } from "./popover_position";

const base = { containerWidth: 1000, containerHeight: 600, popoverHeight: 200, maxWidth: 280, gap: 8 };

describe("placePopover", () => {
  it("元の右に置く", () => {
    const p = placePopover({ ...base, anchor: { left: 100, top: 100, right: 300, bottom: 300 } });
    expect(p).toEqual({ left: 308, top: 100, width: 280 });
  });
  it("右に入らなければ左に置く", () => {
    const p = placePopover({ ...base, anchor: { left: 600, top: 100, right: 900, bottom: 300 } });
    expect(p.left).toBe(600 - 280 - 8);
  });
  it("左右どちらにも入らなければ、元の内側に寄せる", () => {
    const p = placePopover({ ...base, anchor: { left: 50, top: 100, right: 950, bottom: 300 } });
    expect(p.left).toBe(58);
  });
  it("limitRight より右には出さない", () => {
    const p = placePopover({ ...base, limitRight: 700, anchor: { left: 100, top: 100, right: 500, bottom: 300 } });
    expect(p.left + p.width).toBeLessThanOrEqual(700 - 8);
  });
  it("幅は使える幅の45%まで", () => {
    const p = placePopover({ ...base, containerWidth: 400, anchor: { left: 0, top: 0, right: 10, bottom: 10 } });
    expect(p.width).toBeCloseTo((400 - 8) * 0.45);
  });
  it("上下は領域の中に収める", () => {
    expect(placePopover({ ...base, anchor: { left: 0, top: 0, right: 10, bottom: 10 } }).top).toBe(600 * 0.08);
    expect(placePopover({ ...base, anchor: { left: 0, top: 550, right: 10, bottom: 590 } }).top).toBe(600 - 40 - 200);
  });
});
