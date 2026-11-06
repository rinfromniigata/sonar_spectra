// レベルメーターの計算（描画から切り離した純粋関数）。
// 解析（Rust）は線形の振幅を送る。dB への換算、ピークの保持と減衰、枠の中の配置はここで行う。

/** 表示する下限（dB）。これより小さい音は下限として描く */
export const DB_FLOOR = -60;
/** 目盛り（dB）。モックと同じ */
export const TICK_DB = [0, -6, -12, -18, -24, -36, -48] as const;
/** ピークの保持の減衰（dB/秒）。モックの 1フレームあたり 0.35 dB（約60回/秒）に当たる */
export const PEAK_FALL_DB_PER_SECOND = 21;

/** 線形の振幅を dB にする。0 dB（フルスケール）を上限、`DB_FLOOR` を下限にそろえる */
export function toDb(amplitude: number): number {
  if (!(amplitude > 0)) return DB_FLOOR;
  return Math.min(0, Math.max(DB_FLOOR, 20 * Math.log10(amplitude)));
}

/** ピークの保持：上がるときは即座に、下がるときは一定の速さで下がる */
export function updatePeakHold(held: number, level: number, dt: number): number {
  return Math.max(level, DB_FLOOR, held - PEAK_FALL_DB_PER_SECOND * Math.max(0, dt));
}

/** 枠の中の配置（描画の座標系＝既定の向きでの大きさから決める） */
export interface LevelLayout {
  top: number;
  bottom: number;
  span: number;
  /** 目盛りの数字の大きさ */
  tickFontSize: number;
  /** 目盛りの数字を置く左端 */
  labelX: number;
  /** 目盛りの線の左端と幅 */
  gridX: number;
  gridWidth: number;
  /** 2本のバーの幅・間隔・左端 */
  barWidth: number;
  gap: number;
  barX: number;
  /** 見出しと下端の文字（L・R）のために空ける量 */
  labelBaseline: number;
}

// モックの数値（上 22、下 18 を空け、バーは幅の 50% から）
const TOP_INSET = 22;
const BOTTOM_INSET = 18;

export function levelLayout(width: number, height: number): LevelLayout {
  const top = TOP_INSET;
  const bottom = height - BOTTOM_INSET;
  return {
    top,
    bottom,
    span: bottom - top,
    tickFontSize: Math.max(8, Math.min(10, width / 10)),
    labelX: 4,
    gridX: width * 0.44,
    gridWidth: width * 0.5,
    barWidth: Math.max(2, width * 0.08),
    gap: Math.max(2, width * 0.05),
    barX: width * 0.5,
    labelBaseline: height - 5,
  };
}

/** `db`（0 〜 DB_FLOOR）に当たる縦の位置 */
export function yOfDb(layout: LevelLayout, db: number): number {
  return layout.top + (-db / -DB_FLOOR) * layout.span;
}

/** i 番目（0＝L、1＝R）のバーの左端 */
export function barLeft(layout: LevelLayout, channel: 0 | 1): number {
  return layout.barX + channel * (layout.barWidth + layout.gap);
}
