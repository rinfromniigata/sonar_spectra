// フレームレートの上限による間引き（imple 4.6）。判定だけの純粋関数で、時刻は requestAnimationFrame の
// タイムスタンプ（ミリ秒）をそのまま受け取る。
// - 周期は平均で合わせる：描くたびに「次に描いてよい時刻」を周期ぶん進める（遅れが周期を超えたら今の時刻に
//   合わせ直し、まとめて描かない）
// - 画面の1周期の半分を許容の幅にする：60 Hz の画面で上限60fps のとき、わずかな揺れで1回おきにならない
// - 画面の周期が上限の周期より長い（画面のリフレッシュが上限より低い）ときは、来た回ごとに描く（上限は引き上げない）

/** 間引きの状態。最初（と、止めて再開したあと）は null の組 */
export interface PacerState {
  /** 次に描いてよい時刻。null は、次の回を必ず描く */
  readonly due: number | null;
  /** 前に受けた回の時刻（描かずに飛ばした回も含む）。画面の周期の見積もりに使う */
  readonly lastTick: number | null;
}

export const INITIAL_PACER_STATE: PacerState = { due: null, lastTick: null };

export interface PacerStep {
  /** この回を描くか */
  readonly draw: boolean;
  readonly state: PacerState;
}

/** 上限（fps）から、描く周期（ミリ秒）を求める */
export function framePeriod(limit: number): number {
  return 1000 / limit;
}

/**
 * 1回の受け取り（requestAnimationFrame）で、描くかどうかを決める
 * @param state 前の状態
 * @param time この回の時刻（ミリ秒）
 * @param limit フレームレートの上限（fps）
 */
export function stepPacer(state: PacerState, time: number, limit: number): PacerStep {
  const period = framePeriod(limit);
  // 画面の周期：前の回との間隔。見積もれない最初の回は0（許容の幅なし）
  const display = state.lastTick === null ? 0 : Math.max(0, time - state.lastTick);
  const { due } = state;

  if (due === null || time >= due - display / 2) {
    // 遅れが周期を超えたら、今の時刻から数え直す
    const late = due === null ? 0 : time - due;
    const next = due === null || late > period ? time + period : due + period;
    return { draw: true, state: { due: next, lastTick: time } };
  }
  return { draw: false, state: { due, lastTick: time } };
}
