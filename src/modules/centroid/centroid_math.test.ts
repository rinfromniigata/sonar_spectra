import { describe, expect, it } from "vitest";
import { RowHistory } from "../../frame_client";
import {
  AXIS_MAX_HZ,
  AXIS_MIN_HZ,
  FLUX_FULL,
  READOUT_ROWS,
  ROW_SECONDS,
  SMOOTH_TAU,
  axisPosition,
  barStyle,
  centroidLayout,
  columnStep,
  fluxLevel,
  formatFlux,
  formatHz,
  lineY,
  readoutOf,
  smoothedPositions,
  visibleColumns,
} from "./centroid_math";

function history(rows: [number, number][]): RowHistory {
  const h = new RowHistory(2, 4096);
  for (const row of rows) h.push(row);
  return h;
}

describe("重心の軸（対数）", () => {
  it("50 Hz が下端、16 kHz が上端。間は対数で並ぶ", () => {
    expect(axisPosition(AXIS_MIN_HZ)).toBe(0);
    expect(axisPosition(AXIS_MAX_HZ)).toBeCloseTo(1, 10);
    // 幾何平均が真ん中
    expect(axisPosition(Math.sqrt(AXIS_MIN_HZ * AXIS_MAX_HZ))).toBeCloseTo(0.5, 10);
    expect(axisPosition(1000)).toBeGreaterThan(axisPosition(500));
  });

  it("範囲の外は端で止まる。無音（0）と計算できない値は下端", () => {
    expect(axisPosition(30)).toBe(0);
    expect(axisPosition(20_000)).toBe(1);
    for (const hz of [0, -5, Number.NaN, Number.NEGATIVE_INFINITY]) expect(axisPosition(hz)).toBe(0);
  });
});

describe("フラックスの見え方", () => {
  it("FLUX_FULL で棒の高さいっぱい。範囲外と計算できない値は端", () => {
    expect(fluxLevel(0)).toBe(0);
    expect(fluxLevel(FLUX_FULL / 2)).toBeCloseTo(0.5, 10);
    expect(fluxLevel(FLUX_FULL)).toBe(1);
    expect(fluxLevel(5)).toBe(1);
    expect(fluxLevel(-1)).toBe(0);
    expect(fluxLevel(Number.NaN)).toBe(0);
  });

  it("棒は高いほど濃く、0.55 を超えたら強調色", () => {
    expect(barStyle(0)).toEqual({ alpha: 0.3, hot: false });
    expect(barStyle(1).alpha).toBeCloseTo(1, 10);
    expect(barStyle(0.55).hot).toBe(false);
    expect(barStyle(0.56).hot).toBe(true);
  });
});

describe("流れる幅", () => {
  it("1行を 3 px × 速さで流す。最低 1 px、速さの範囲の外は端で止まる", () => {
    expect(columnStep(1)).toBe(3);
    expect(columnStep(2)).toBe(6);
    expect(columnStep(0.25)).toBe(1);
    expect(columnStep(0)).toBe(1);
    expect(columnStep(100)).toBe(9);
    expect(columnStep(Number.NaN)).toBe(3);
    expect(visibleColumns(100, 3)).toBe(34);
  });
});

describe("重心の線のならし", () => {
  it("一定の値はそのまま。階段状の変化には時定数 SMOOTH_TAU で追いつく", () => {
    const hz = 1000;
    const rows: [number, number][] = Array.from({ length: 200 }, () => [hz, 0]);
    const out = new Float32Array(200);
    smoothedPositions(history(rows), 200, out);
    expect(out[0]).toBeCloseTo(axisPosition(hz), 6);
    expect(out[199]).toBeCloseTo(axisPosition(hz), 6);

    // 無音から鳴り始める：手前は 0 のまま、鳴ってから約 SMOOTH_TAU で 63% に届く
    const step: [number, number][] = [
      ...Array.from({ length: 100 }, (): [number, number] => [0, 0]),
      ...Array.from({ length: 100 }, (): [number, number] => [hz, 0]),
    ];
    smoothedPositions(history(step), 200, out);
    expect(out[99]).toBe(0);
    const target = axisPosition(hz);
    const n = Math.round(SMOOTH_TAU / ROW_SECONDS);
    expect(out[100 + n - 1]).toBeCloseTo(target * (1 - Math.exp(-1)), 2);
    expect(out[199]).toBeCloseTo(target, 3);
  });

  it("見える範囲が動いても、同じ行の値は変わらない（手前の行から走らせる）", () => {
    const rows: [number, number][] = Array.from({ length: 300 }, (_, i) => [200 + 40 * i, 0]);
    const h = history(rows);
    const wide = new Float32Array(100);
    smoothedPositions(h, 100, wide);
    const narrow = new Float32Array(60);
    smoothedPositions(h, 60, narrow);
    // 同じ行（新しい側の 60 行）の値が一致する
    for (let i = 0; i < 60; i++) expect(narrow[i]).toBeCloseTo(wide[40 + i], 3);
  });

  it("履歴が足りなければ、ある分だけ書く。空なら何もしない", () => {
    const out = new Float32Array(10).fill(-1);
    smoothedPositions(history([]), 10, out);
    expect(Array.from(out)).toEqual(Array(10).fill(-1));
    smoothedPositions(history([[1000, 0]]), 10, out);
    expect(out[0]).toBeGreaterThanOrEqual(0);
    expect(out[1]).toBe(-1);
  });
});

describe("数値の読み取り", () => {
  it("直近の行の平均。無音の行は重心の平均に入れない", () => {
    const rows: [number, number][] = [
      [0, 0], // 古い行（READOUT_ROWS の外）
      ...Array.from({ length: READOUT_ROWS - 1 }, (): [number, number] => [1000, 0.25]),
      [3000, 0.5],
    ];
    const reading = readoutOf(history(rows));
    expect(reading.hz).toBeCloseTo((1000 * (READOUT_ROWS - 1) + 3000) / READOUT_ROWS, 6);
    expect(reading.flux).toBeCloseTo((0.5 * (READOUT_ROWS - 1) + 1) / READOUT_ROWS, 6);
  });

  it("最新の行が無音なら無音（hz は null）。空でも無音", () => {
    expect(readoutOf(history([[1000, 0.1], [0, 0]])).hz).toBeNull();
    expect(readoutOf(history([])).hz).toBeNull();
  });
});

describe("表記", () => {
  it("1 kHz 以上は kHz で小数1桁、それ未満は Hz の整数", () => {
    expect(formatHz(440.4)).toBe("440 Hz");
    expect(formatHz(999.4)).toBe("999 Hz");
    expect(formatHz(999.6)).toBe("1.0 kHz");
    expect(formatHz(1500)).toBe("1.5 kHz");
    expect(formatHz(12_340)).toBe("12.3 kHz");
  });

  it("変化量は「Δ」に小数2桁", () => {
    expect(formatFlux(0.274)).toBe("Δ 0.27");
    expect(formatFlux(0)).toBe("Δ 0.00");
  });
});

describe("配置（モックの fluxH・top・cenH）", () => {
  it("棒は高さの 28%、線の領域は残りから上の余白 14 と下の余白 6 を引いた分", () => {
    const layout = centroidLayout(100);
    expect(layout.fluxHeight).toBeCloseTo(28, 10);
    expect(layout.top).toBe(14);
    expect(layout.lineHeight).toBeCloseTo(100 - 28 - 14 - 6, 10);
    expect(layout.fontSize).toBe(10);
    expect(centroidLayout(10).lineHeight).toBe(0);
    expect(centroidLayout(40).fontSize).toBe(8);
    expect(centroidLayout(400).fontSize).toBe(11);
  });

  it("位置 0 が線の領域の下端、1 が上端", () => {
    const layout = centroidLayout(100);
    expect(lineY(layout, 1)).toBeCloseTo(layout.top, 10);
    expect(lineY(layout, 0)).toBeCloseTo(layout.top + layout.lineHeight, 10);
  });
});
