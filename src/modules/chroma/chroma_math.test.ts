import { describe, expect, it } from "vitest";
import { ChordQuality, KeyMode } from "../../frame_client";
import {
  ALPHA_BASE,
  FALL_TAU,
  NOTE_NAMES,
  chromaLayout,
  clampStrength,
  fallToZero,
  formatChord,
  keyParts,
  labelAngle,
  noteName,
  segmentAngles,
  strengthAlpha,
  strengthRadius,
} from "./chroma_math";

const UP = -Math.PI / 2;

describe("音名とコード・キーの表記", () => {
  it("音名は C から半音ずつ12個。範囲外は空", () => {
    expect(NOTE_NAMES).toEqual(["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]);
    expect(noteName(9)).toBe("A");
    expect(noteName(12)).toBe("");
    expect(noteName(-1)).toBe("");
  });

  it("コードは根音に、短調なら「m」を付ける", () => {
    expect(formatChord(0, ChordQuality.Major)).toBe("C");
    expect(formatChord(9, ChordQuality.Minor)).toBe("Am");
    expect(formatChord(6, ChordQuality.Minor)).toBe("F♯m");
  });

  it("キーは主音の音名と、長・短", () => {
    expect(keyParts(9, KeyMode.Minor)).toEqual({ mode: "minor", tonic: "A" });
    expect(keyParts(3, KeyMode.Major)).toEqual({ mode: "major", tonic: "D♯" });
  });
});

describe("円環の配置（モックの cx・cy・R・r0）", () => {
  it("中心は枠の中央、外半径は短い辺の 42%、内半径はその 45%", () => {
    const layout = chromaLayout(200, 300);
    expect(layout).toMatchObject({ centerX: 100, centerY: 150, outer: 84 });
    expect(layout.inner).toBeCloseTo(84 * 0.45, 10);
    expect(layout.chordY).toBeCloseTo(150 - 84 * 0.06, 10);
    expect(layout.keyY).toBeCloseTo(150 + 84 * 0.2, 10);
  });

  it("文字の大きさは外半径から決め、それぞれの範囲に収める", () => {
    const small = chromaLayout(40, 40);
    expect([small.noteFont, small.chordFont, small.keyFont]).toEqual([8, 11, 8]);
    const large = chromaLayout(4000, 4000);
    expect([large.noteFont, large.chordFont, large.keyFont]).toEqual([12, 26, 11]);
  });

  it("扇は音名の間隔の ±0.42。C が真上、時計回り", () => {
    const c = segmentAngles(0);
    expect(c.start).toBeCloseTo(UP - (0.42 / 12) * 2 * Math.PI, 10);
    expect(c.end).toBeCloseTo(UP + (0.42 / 12) * 2 * Math.PI, 10);
    expect(labelAngle(0)).toBeCloseTo(UP, 10);
    expect(labelAngle(3)).toBeCloseTo(0, 10); // 3 時の方向（D♯）
    expect(labelAngle(6)).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe("強さの見え方", () => {
  it("0〜1 に切り詰める。計算できない値は 0", () => {
    expect(clampStrength(0.4)).toBe(0.4);
    expect(clampStrength(2)).toBe(1);
    expect(clampStrength(-1)).toBe(0);
    expect(clampStrength(Number.NaN)).toBe(0);
  });

  it("強さに比例して、内半径から外半径まで伸びる。不透明度は 0.25〜1", () => {
    const layout = chromaLayout(200, 200);
    expect(strengthRadius(layout, 0)).toBe(layout.inner);
    expect(strengthRadius(layout, 1)).toBeCloseTo(layout.outer, 10);
    expect(strengthRadius(layout, 0.5)).toBeCloseTo((layout.inner + layout.outer) / 2, 10);
    expect(strengthRadius(layout, 5)).toBeCloseTo(layout.outer, 10);
    expect(strengthAlpha(0)).toBe(ALPHA_BASE);
    expect(strengthAlpha(1)).toBeCloseTo(1, 10);
  });
});

describe("受信が途切れたときの戻り", () => {
  it("0 へ時定数 FALL_TAU で近づく。dt が 0 なら動かない", () => {
    expect(fallToZero(0.8, 0)).toBe(0.8);
    expect(fallToZero(1, FALL_TAU)).toBeCloseTo(Math.exp(-1), 10);
    expect(fallToZero(0, 1)).toBe(0);
  });

  it("分けて進めても、まとめて進めても同じ", () => {
    let split = 1;
    for (let i = 0; i < 10; i++) split = fallToZero(split, 0.01);
    expect(split).toBeCloseTo(fallToZero(1, 0.1), 10);
  });
});
