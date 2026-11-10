import { describe, expect, it } from "vitest";
import { equalTracks, frameCssRect, frameDeviceRect, type GridMetrics } from "./frame_rects";

/** 12×8、すき間 1px、余白なし、格子の左上は (0, 37.5) */
function metrics(overrides: Partial<GridMetrics> = {}): GridMetrics {
  return {
    left: 0,
    top: 37.5,
    paddingLeft: 0,
    paddingTop: 0,
    columns: equalTracks(1920, 12, 1),
    rows: equalTracks(1162.5, 8, 1),
    columnGap: 1,
    rowGap: 1,
    ...overrides,
  };
}

describe("equalTracks", () => {
  it("等しい大きさの列は、すき間を除いた幅を等分する", () => {
    const tracks = equalTracks(1920, 12, 1);
    expect(tracks).toHaveLength(12);
    expect(tracks[0]).toBeCloseTo((1920 - 11) / 12, 9);
    expect(equalTracks(5, 12, 1).every((t) => t === 0)).toBe(true);
  });
});

describe("frameCssRect", () => {
  it("n マスにまたがる枠は、n 本の大きさ ＋ (n−1) 本のすき間。位置は余白と前の列・すき間の合計", () => {
    const m = metrics({ paddingLeft: 12, paddingTop: 12, columns: [10, 20, 30, 40], rows: [5, 6, 7], columnGap: 2, rowGap: 3 });
    expect(frameCssRect(m, { c: 1, r: 1, cs: 1, rs: 1 })).toEqual({ x: 12, y: 12, width: 10, height: 5 });
    expect(frameCssRect(m, { c: 2, r: 2, cs: 3, rs: 2 })).toEqual({ x: 12 + 10 + 2, y: 12 + 5 + 3, width: 20 + 30 + 40 + 4, height: 6 + 7 + 3 });
  });

  it("格子の外にはみ出す位置は、端の列までに収める", () => {
    const m = metrics({ columns: [10, 20], rows: [5], columnGap: 0, rowGap: 0 });
    expect(frameCssRect(m, { c: 2, r: 1, cs: 5, rs: 3 })).toEqual({ x: 10, y: 0, width: 20, height: 5 });
  });
});

describe("frameDeviceRect", () => {
  it("隣り合う枠のあいだに、すき間（線）のデバイスピクセルが残り、全体を隙間なく分ける", () => {
    const m = metrics();
    const dpr = 1.5;
    let prevRight = -1;
    for (let c = 1; c <= 12; c++) {
      const rect = frameDeviceRect(m, { c, r: 1, cs: 1, rs: 1 }, dpr);
      if (prevRight >= 0) expect(rect.x - prevRight).toBeGreaterThanOrEqual(1);
      prevRight = rect.x + rect.width;
    }
    // 最後の列の右端はキャンバスの右端（1920 × 1.5）
    expect(prevRight).toBe(2880);
  });

  it("端がちょうど半ピクセルのときは大きいほうへ丸める（ブラウザが枠を描く位置と同じ。1920 幅・DPR 1.5 の5列目は 961 から）", () => {
    const m = metrics({ top: 0 });
    // 4列目の右端 639.33 × 1.5 = 959、5列目の左端 640.33 × 1.5 = 960.5 → 961。すき間は 959・960 の2ピクセル
    expect(frameDeviceRect(m, { c: 1, r: 1, cs: 4, rs: 1 }, 1.5)).toMatchObject({ x: 0, width: 959 });
    expect(frameDeviceRect(m, { c: 5, r: 1, cs: 4, rs: 1 }, 1.5).x).toBe(961);
  });

  it("端は画面上のデバイスピクセルに丸めてから、キャンバスの左上（丸めた位置）を引く", () => {
    // 格子の上端 37.5px × 1.5 = 56.25 → 56。枠の上端 37.5 + 0 → 56、下端 37.5 + 144.3125 = 181.8125 × 1.5 = 272.72 → 273
    const m = metrics({ rows: [144.3125, ...Array(7).fill(144)] });
    const rect = frameDeviceRect(m, { c: 1, r: 1, cs: 1, rs: 1 }, 1.5);
    expect(rect.y).toBe(0);
    expect(rect.height).toBe(273 - 56);
    // 2行目の上端：37.5 + 145.3125 = 182.8125 × 1.5 = 274.22 → 274
    expect(frameDeviceRect(m, { c: 1, r: 2, cs: 1, rs: 1 }, 1.5).y).toBe(274 - 56);
  });

  it("大きさは 0 未満にならない", () => {
    const m = metrics({ columns: [0, 0], rows: [0], columnGap: 0, rowGap: 0 });
    const rect = frameDeviceRect(m, { c: 1, r: 1, cs: 1, rs: 1 }, 2);
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
  });
});
