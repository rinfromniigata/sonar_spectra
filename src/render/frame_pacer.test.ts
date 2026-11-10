import { describe, expect, it } from "vitest";
import { FRAME_LIMITS } from "../config/types";
import { INITIAL_PACER_STATE, framePeriod, stepPacer, type PacerState } from "./frame_pacer";

/** 画面の周期（ミリ秒）ごとに時刻を進めて、描いた回の時刻を返す。jitter は揺れの幅（交互に足す・引く） */
function simulate(limit: number, intervals: Iterable<number>, jitter = 0): number[] {
  let state: PacerState = INITIAL_PACER_STATE;
  let time = 1000;
  const drawn: number[] = [];
  let index = 0;
  for (const interval of intervals) {
    const step = stepPacer(state, time, limit);
    state = step.state;
    if (step.draw) drawn.push(time);
    time += interval + (index++ % 2 === 0 ? jitter : -jitter);
  }
  return drawn;
}

/** 一定の周期で、約1秒（duration ミリ秒）分 */
function constant(interval: number, duration = 1000): number[] {
  return Array.from({ length: Math.round(duration / interval) }, () => interval);
}

/** 描いた回どうしの間隔 */
function gaps(drawn: number[]): number[] {
  return drawn.slice(1).map((t, i) => t - drawn[i]);
}

describe("framePeriod", () => {
  it("上限（fps）から周期（ミリ秒）を求める", () => {
    expect(framePeriod(60)).toBeCloseTo(16.667, 3);
    expect(framePeriod(45)).toBeCloseTo(22.222, 3);
    expect(framePeriod(30)).toBeCloseTo(33.333, 3);
  });
});

describe("stepPacer", () => {
  it("最初の回と、止めて再開したあとの最初の回は、必ず描く", () => {
    expect(stepPacer(INITIAL_PACER_STATE, 5000, 30).draw).toBe(true);
    // 状態を初期に戻せば、どれだけ時間が空いても描く
    const first = stepPacer(INITIAL_PACER_STATE, 0, 30);
    expect(stepPacer(first.state, 10, 30).draw).toBe(false);
    expect(stepPacer(INITIAL_PACER_STATE, 10, 30).draw).toBe(true);
  });

  it("上限が選べる3つのとき、画面ごとの1秒あたりの描く回数が上限に合う（平均で合わせる）", () => {
    // 画面のリフレッシュ（Hz）× 上限（fps）の組み合わせ。割り切れないもの（60 Hz の 45fps など）も平均で合う
    for (const hz of [144, 120, 90, 60]) {
      for (const limit of FRAME_LIMITS) {
        const count = simulate(limit, constant(1000 / hz, 10_000)).length;
        const expected = Math.min(limit, hz) * 10;
        expect(Math.abs(count - expected), `${hz} Hz・上限${limit}fps：${count}回（期待${expected}）`).toBeLessThanOrEqual(2);
      }
    }
  });

  it("60 Hz の画面で上限60fps のときは、揺れても1回おきにならず、来た回ごとに描く", () => {
    const drawn = simulate(60, constant(1000 / 60, 3000), 2);
    expect(drawn).toHaveLength(constant(1000 / 60, 3000).length);
  });

  it("120 Hz の画面で上限60fps のときは、1回おきに描く（等間隔）", () => {
    const g = gaps(simulate(60, constant(1000 / 120, 2000)));
    for (const gap of g) expect(gap).toBeCloseTo(1000 / 60, 3);
  });

  it("120 Hz の画面で上限30fps のときは、4回に1回描く（等間隔）", () => {
    const g = gaps(simulate(30, constant(1000 / 120, 2000)));
    for (const gap of g) expect(gap).toBeCloseTo(1000 / 30, 3);
  });

  it("割り切れない上限（120 Hz の画面で45fps）は、等間隔にならないが、間隔は画面の1周期ぶんのずれに収まる", () => {
    const display = 1000 / 120;
    const g = gaps(simulate(45, constant(display, 2000)));
    const period = framePeriod(45);
    for (const gap of g) {
      expect(gap).toBeGreaterThanOrEqual(period - display);
      expect(gap).toBeLessThanOrEqual(period + display);
    }
  });

  it("画面の周期が上限より長いとき（画面のリフレッシュが上限より低い）は、来た回ごとに描く", () => {
    for (const hz of [40, 30, 24]) {
      const intervals = constant(1000 / hz, 2000);
      expect(simulate(60, intervals)).toHaveLength(intervals.length);
      expect(simulate(45, intervals)).toHaveLength(intervals.length);
    }
  });

  it("可変リフレッシュレートで画面の周期が下がっても、上限を超えず、下がったあとは来た回ごとに描く", () => {
    // 120 Hz で1秒 → 68 Hz に落ちて1秒 → 30 Hz に落ちて1秒（上限60fps）
    const intervals = [...constant(1000 / 120), ...constant(1000 / 68), ...constant(1000 / 30)];
    const drawn = simulate(60, intervals);
    const inRange = (from: number, to: number) => drawn.filter((t) => t >= 1000 + from && t < 1000 + to).length;
    expect(Math.abs(inRange(0, 1000) - 60)).toBeLessThanOrEqual(2);
    // 68 Hz は上限より高いが、まとめて飛ばしても平均で60fps に合う
    expect(Math.abs(inRange(1000, 2000) - 60)).toBeLessThanOrEqual(3);
    // 30 Hz は上限より低いので、来た回ごと（30回）
    expect(Math.abs(inRange(2000, 3000) - 30)).toBeLessThanOrEqual(2);
  });

  it("遅れが周期を超えたら、今の時刻から数え直し、取り戻すためにまとめて描かない", () => {
    let state = stepPacer(INITIAL_PACER_STATE, 0, 60).state;
    // 500ms 止まったあとの回：描く
    const late = stepPacer(state, 500, 60);
    expect(late.draw).toBe(true);
    state = late.state;
    // すぐ次の回（画面の周期は500ms と見積もられる）が来ても、取り戻して連続では描かない：
    // 数え直したので、次に描いてよい時刻は 500 + 周期
    expect(state.due).toBeCloseTo(500 + framePeriod(60), 6);
    const next = stepPacer(state, 501, 60);
    // 画面の周期（1ms）が小さいので、許容の幅は0.5ms。まだ描かない
    expect(next.draw).toBe(false);
  });

  it("描かずに飛ばした回も、画面の周期の見積もりのために時刻を覚える", () => {
    const first = stepPacer(INITIAL_PACER_STATE, 0, 30);
    const skipped = stepPacer(first.state, 8, 30);
    expect(skipped.draw).toBe(false);
    expect(skipped.state.lastTick).toBe(8);
    expect(skipped.state.due).toBe(first.state.due);
  });
});
