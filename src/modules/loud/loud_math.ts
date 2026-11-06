// LOUD（ラウドネス）のモジュールの計算（描画から切り離した純粋関数）。数値はモックの drawLoud と .loud-* に合わせる。
//
// 解析（Rust）は、モーメンタリ（0.4秒）・ショートターム（3秒）・ピークを dB で送る。値は規格に沿った測定ではなく近似
// （SPEC 3節「既知の制限」）。数値の表示にはショートターム、下端のバーにはモーメンタリを使う。
// 無音などで計算できないときは LOUDNESS_FLOOR_DB が来て、数値は「−∞」と表示する。

import { LOUDNESS_FLOOR_DB } from "../../frame_client";

/** 下端のバーの本数 */
export const BAR_COUNT = 24;
/** バーがちょうど空になる dB と、いっぱいになる dB（モックの (val + 30) / 30） */
export const BAR_FLOOR_DB = -30;
export const BAR_CEIL_DB = 0;
/** バーの上端の何割から強調色にするか（モックの 0.8） */
export const BAR_HOT_FROM = 0.8;
/** ショートタームがこれを超えたら、数値を強調色にする（モックの -8.6） */
export const HOT_LOUDNESS_DB = -8.6;
/** 数値とピークの表示を更新する間隔（秒）。細かい揺れで読めなくならないように（モックの 0.25） */
export const REFRESH_SECONDS = 0.25;

/** 表示で使うマイナス記号（ハイフンではなく数学用のマイナス。モックと同じ） */
const MINUS = "−";
/** 計算できない値の表示 */
export const NEGATIVE_INFINITY_TEXT = `${MINUS}∞`;

/** dB を小数1桁の文字列にする。計算できない値（床・NaN）は「−∞」 */
export function formatDb(db: number): string {
  if (!Number.isFinite(db) || db <= LOUDNESS_FLOOR_DB) return NEGATIVE_INFINITY_TEXT;
  const rounded = Math.round(db * 10) / 10;
  const text = Math.abs(rounded).toFixed(1);
  return rounded < 0 ? `${MINUS}${text}` : text;
}

/** モーメンタリ（dB）から、バーの点灯の割合（0〜1） */
export function barLevel(momentaryDb: number): number {
  if (!Number.isFinite(momentaryDb) || momentaryDb <= LOUDNESS_FLOOR_DB) return 0;
  return Math.min(1, Math.max(0, (momentaryDb - BAR_FLOOR_DB) / (BAR_CEIL_DB - BAR_FLOOR_DB)));
}

/** i 番目（0 が左）のバーが点灯するか */
export function barLit(index: number, level: number): boolean {
  return index / BAR_COUNT < level;
}

/** i 番目のバーが強調色の範囲か */
export function barHot(index: number): boolean {
  return index / BAR_COUNT > BAR_HOT_FROM;
}

/** 数値を強調色にするか */
export function isHot(shortTermDb: number): boolean {
  return Number.isFinite(shortTermDb) && shortTermDb > HOT_LOUDNESS_DB;
}

/** 表示する値（更新の間隔でそろえる） */
export interface LoudReading {
  /** ショートターム（数値） */
  shortTerm: number;
  /** モーメンタリ（バー） */
  momentary: number;
  /** ピーク */
  peak: number;
}

/** 数値の更新を間引く：最初の1回と、前の更新から REFRESH_SECONDS 経ったときだけ、新しい値に替える */
export class ReadingThrottle {
  private shown: LoudReading | null = null;
  private elapsed = 0;

  /** 最新の値 `latest` と経過 `dt`（秒）から、今表示する値を返す */
  update(latest: LoudReading, dt: number): LoudReading {
    this.elapsed += Math.max(0, dt);
    if (!this.shown || this.elapsed >= REFRESH_SECONDS) {
      this.shown = latest;
      this.elapsed = 0;
    }
    return this.shown;
  }

  reset(): void {
    this.shown = null;
    this.elapsed = 0;
  }
}

/** 文字の大きさ・位置（モックの .loud-* の clamp と、中央揃えの縦積みに合わせる） */
export interface LoudLayout {
  centerX: number;
  /** 単位・数値・ピークの、文字の大きさと縦の中心 */
  unit: { size: number; y: number };
  value: { size: number; y: number };
  sub: { size: number; y: number };
  /** 文字を縮めてでも収める幅 */
  maxWidth: number;
  /** 下端のバー */
  bars: { top: number; height: number; barWidth: number };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** 文字の下の余白（モックの padding-bottom） */
const READ_PADDING_BOTTOM = 10;
/** バーの下端からの位置と高さ */
const BAR_BOTTOM_OFFSET = 8;
const BAR_HEIGHT = 4;
/** 文字の大きさの、枠の幅に対する割合と範囲（モックの cqi と clamp の上限） */
const UNIT_SIZE = { ratio: 0.09, min: 7, max: 13 };
const VALUE_SIZE = { ratio: 0.26, min: 12, max: 72 };
const SUB_SIZE = { ratio: 0.08, min: 7, max: 11 };
/** 行の高さ（文字の大きさに対する倍率） */
const UNIT_LINE = 1.3;
const VALUE_LINE = 1.05;
const SUB_LINE = 1.3;

export function loudLayout(width: number, height: number): LoudLayout {
  const size = (spec: { ratio: number; min: number; max: number }) => clamp(width * spec.ratio, spec.min, spec.max);
  const unitSize = size(UNIT_SIZE);
  const valueSize = size(VALUE_SIZE);
  const subSize = size(SUB_SIZE);
  const unitHeight = unitSize * UNIT_LINE;
  const valueHeight = valueSize * VALUE_LINE;
  const subHeight = subSize * SUB_LINE;
  const top = (height - READ_PADDING_BOTTOM - (unitHeight + valueHeight + subHeight)) / 2;
  return {
    centerX: width / 2,
    unit: { size: unitSize, y: top + unitHeight / 2 },
    value: { size: valueSize, y: top + unitHeight + valueHeight / 2 },
    sub: { size: subSize, y: top + unitHeight + valueHeight + subHeight / 2 },
    maxWidth: Math.max(1, width - 4),
    bars: { top: height - BAR_BOTTOM_OFFSET, height: BAR_HEIGHT, barWidth: width / BAR_COUNT },
  };
}
