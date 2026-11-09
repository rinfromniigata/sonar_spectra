// VU メーターのモジュールの計算（描画から切り離した純粋関数）。数値はモックの drawVU に合わせる。
//
// 解析（Rust）は、L・R の針の位置を VU（dB。0 が基準）で送る。針の立ち上がりと戻り（0.3 秒で 99%、ゆっくり戻る）は
// 解析側でまねてあるので、ここでは追加でならさない。ここで決めるのは、dB から針の角度への写し方、目盛り、配置、
// 受信が途切れたときの針の戻り方。

import { VU_FLOOR_DB } from "../../frame_client";

/** 目盛りの下端と上端（dB。モックの -20〜+3） */
export const SCALE_MIN_DB = -20;
export const SCALE_MAX_DB = 3;
/** 針が真上を指す dB と、その位置から端までの dB の幅（モックの (db + 8.5) / 11.5） */
export const SCALE_CENTER_DB = -8.5;
export const SCALE_HALF_DB = 11.5;
/** 片側の振れ幅（ラジアン。モックの span） */
export const SWING_RADIANS = 0.9;
/** 0〜+3 の強調帯を引く下端と上端（dB） */
export const HOT_FROM_DB = 0;
export const HOT_TO_DB = 3;

/** 目盛りの点を打つ間隔（dB）と、大きな点にする値 */
export const TICK_STEP_DB = 0.5;
export const MAJOR_TICKS_DB: readonly number[] = [-20, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3];
/** 数字を添える値 */
export const LABEL_DB: readonly number[] = [-20, -10, -5, 0, 3];

/** 残像：毎フレーム地の色を重ねる不透明度（モックの 0.24） */
export const TRAIL_ALPHA = 0.24;
/** 受信が途切れたとき、針が目盛りの下端へ戻る時定数（秒。モックの 1 フレームあたり 0.12 に当たる） */
export const FALL_TAU = 0.14;

/** 表示で使うマイナス記号（ハイフンではなく数学用のマイナス。LOUD と同じ） */
const MINUS = "−";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** dB を目盛りの範囲に切り詰める。計算できない値（床・NaN）は下端 */
export function clampDb(db: number): number {
  if (!Number.isFinite(db) || db <= VU_FLOOR_DB) return SCALE_MIN_DB;
  return clamp(db, SCALE_MIN_DB, SCALE_MAX_DB);
}

/** dB から針の角度（ラジアン。画面の座標系で、-π/2 が真上）。目盛りの範囲に切り詰める */
export function needleAngle(db: number): number {
  return -Math.PI / 2 + ((clampDb(db) - SCALE_CENTER_DB) / SCALE_HALF_DB) * SWING_RADIANS;
}

/** 目盛りの数字（正の値には「+」を付ける） */
export function formatScale(db: number): string {
  if (db > 0) return `+${db}`;
  return db < 0 ? `${MINUS}${Math.abs(db)}` : "0";
}

/** 針の戻り：受信が途切れている間、目盛りの下端へ時定数 FALL_TAU で近づける */
export function fallToFloor(previous: number, dt: number): number {
  const k = 1 - Math.exp(-Math.max(0, dt) / FALL_TAU);
  return previous + (SCALE_MIN_DB - previous) * k;
}

/** 目盛りの点（dB と、大きな点か） */
export function scaleTicks(): { db: number; major: boolean }[] {
  const ticks: { db: number; major: boolean }[] = [];
  const count = Math.round((SCALE_MAX_DB - SCALE_MIN_DB) / TICK_STEP_DB);
  for (let i = 0; i <= count; i++) {
    const db = SCALE_MIN_DB + i * TICK_STEP_DB;
    ticks.push({ db, major: MAJOR_TICKS_DB.includes(db) });
  }
  return ticks;
}

/** 配置：針の根元と、目盛りの弧の半径（モックの px・py・R） */
export interface VuLayout {
  pivotX: number;
  pivotY: number;
  radius: number;
  /** 数字と「VU」の文字の大きさ */
  fontSize: number;
}

export function vuLayout(width: number, height: number): VuLayout {
  const radius = Math.min(width * 0.46, height * 0.78);
  return { pivotX: width / 2, pivotY: height * 0.9, radius, fontSize: clamp(radius / 9, 8, 11) };
}

/** 弧の上の点（angle：針の角度、distance：根元からの距離） */
export function pointOnArc(layout: VuLayout, angle: number, distance: number): [number, number] {
  return [layout.pivotX + Math.cos(angle) * distance, layout.pivotY + Math.sin(angle) * distance];
}
