import { describe, expect, it } from "vitest";
import type { GridRect, Instance } from "../config/types";
import {
  cellAt,
  cellDelta,
  cellPitch,
  finishGesture,
  instanceAt,
  lineAt,
  startGesture,
  updateGesture,
  type GestureState,
  type GridBox,
} from "./edit_gesture";
import { findSplitters } from "./manual";

const R = (c: number, r: number, cs: number, rs: number): GridRect => ({ c, r, cs, rs });

function inst(id: string, rect: GridRect | null, enabled = true): Instance {
  return {
    id,
    kind: "spec",
    enabled,
    rect,
    direction: "up",
    paletteId: "preset.a",
    sourceId: "default",
    options: { mode: "fill", ghost: true },
  } as Instance;
}

const rectOf = (instances: readonly Instance[] | null, id: string) => instances?.find((i) => i.id === id)?.rect ?? null;

// 1マスが 100×50（すき間 4・外周の余白 4）になる格子：幅 = 4×2 + 12×100 + 11×4 − … を、間隔で考える
// 間隔 = (幅 − 2×余白 + すき間) ÷ 12 = 104 → 幅 = 104×12 − 4 + 8 = 1252
const box: GridBox = { left: 10, top: 20, width: 1252, height: 8 * 54 - 4 + 8, padding: 4, gap: 4 };

describe("格子の見た目の大きさとマス", () => {
  it("1マス分の間隔は、余白を除いた幅にすき間1つ分を足して列数で割ったもの", () => {
    expect(cellPitch(box)).toEqual({ x: 104, y: 54 });
  });

  it("画面上の位置のマス（格子の外は端のマス）", () => {
    expect(cellAt(box, 10 + 4 + 1, 20 + 4 + 1)).toEqual({ c: 1, r: 1 });
    expect(cellAt(box, 10 + 4 + 104 * 3 + 50, 20 + 4 + 54 * 2 + 10)).toEqual({ c: 4, r: 3 });
    expect(cellAt(box, -500, 9999)).toEqual({ c: 1, r: 8 });
  });

  it("動いた距離は、いちばん近いマス数に吸着する", () => {
    expect(cellDelta(box, 51, -26)).toEqual({ dc: 0, dr: 0 });
    expect(cellDelta(box, 53, -28)).toEqual({ dc: 1, dr: -1 });
    expect(cellDelta(box, -210, 110)).toEqual({ dc: -2, dr: 2 });
  });

  it("いちばん近い線（縦は2〜12、横は2〜8）", () => {
    expect(lineAt(box, "v", 10 + 4 + 104 * 6 - 2, 0)).toBe(7);
    expect(lineAt(box, "v", 10 + 4 + 104 * 6 + 40, 0)).toBe(7);
    expect(lineAt(box, "v", 0, 0)).toBe(2);
    expect(lineAt(box, "v", 99999, 0)).toBe(12);
    expect(lineAt(box, "h", 0, 20 + 4 + 54 * 3)).toBe(4);
    expect(lineAt(box, "h", 0, 99999)).toBe(8);
  });

  it("マスを占めているもの（無効なものは数えない）", () => {
    const instances = [inst("a", R(1, 1, 3, 2)), inst("off", R(5, 1, 2, 2), false)];
    expect(instanceAt(instances, { c: 3, r: 2 })).toBe("a");
    expect(instanceAt(instances, { c: 5, r: 1 })).toBeNull();
    expect(instanceAt(instances, { c: 4, r: 1 })).toBeNull();
  });
});

/** 状態を続けて動かし、最後に返した配置を表示の配置として持つ */
function run(state: GestureState, inputs: { dc?: number; dr?: number; line?: number }[]) {
  let shown: Instance[] | null = null;
  let current = state;
  for (const input of inputs) {
    const { state: next, next: instances } = updateGesture(current, { dc: input.dc ?? 0, dr: input.dr ?? 0, line: input.line ?? 0 });
    current = next;
    if (instances) shown = instances;
  }
  return { state: current, shown };
}

describe("ドラッグ：移動", () => {
  const start = [inst("a", R(1, 1, 3, 2)), inst("b", R(7, 1, 3, 2))];

  it("動いたマス数だけ動かし、つかんだときの配置を基準に計算し直す", () => {
    const state = startGesture(start, { kind: "move", id: "a" })!;
    const { shown } = run(state, [{ dc: 1 }, { dc: 2, dr: 3 }]);
    expect(rectOf(shown, "a")).toEqual(R(3, 4, 3, 2));
  });

  it("置けない位置では、その手前の位置にとどまる", () => {
    const state = startGesture(start, { kind: "move", id: "a" })!;
    const { state: after, shown } = run(state, [{ dc: 1 }, { dc: 2 }, { dc: 4 }]);
    expect(rectOf(shown, "a")).toEqual(R(3, 1, 3, 2));
    expect(after.blocked).toBe(true);
  });

  it("つかんだ位置に戻すと、つかんだときの配置に戻る。動かしていなければ何も返さない", () => {
    const state = startGesture(start, { kind: "move", id: "a" })!;
    expect(updateGesture(state, { dc: 0, dr: 0, line: 0 }).next).toBeNull();
    const { shown } = run(state, [{ dc: 2 }, { dc: 0 }]);
    expect(rectOf(shown, "a")).toEqual(R(1, 1, 3, 2));
  });

  it("置けない位置でほかのモジュールの上で離すと、位置を入れ替える", () => {
    const state = startGesture(start, { kind: "move", id: "a" })!;
    const { state: after } = run(state, [{ dc: 6 }]);
    const swapped = finishGesture(after, "b");
    expect(rectOf(swapped, "a")).toEqual(R(7, 1, 3, 2));
    expect(rectOf(swapped, "b")).toEqual(R(1, 1, 3, 2));
  });

  it("置ける位置で離したとき・空いたところで離したときは入れ替えない", () => {
    const state = startGesture(start, { kind: "move", id: "a" })!;
    expect(finishGesture(run(state, [{ dc: 1 }]).state, "b")).toBeNull();
    expect(finishGesture(run(state, [{ dc: 6 }]).state, null)).toBeNull();
    expect(finishGesture(run(state, [{ dc: 6 }]).state, "a")).toBeNull();
  });

  it("位置を持たないもの・無効なものはつかめない", () => {
    expect(startGesture([inst("a", null)], { kind: "move", id: "a" })).toBeNull();
    expect(startGesture([inst("a", R(1, 1, 1, 1), false)], { kind: "resize", id: "a" })).toBeNull();
  });
});

describe("ドラッグ：大きさ変更（右下の角）", () => {
  const start = [inst("a", R(1, 1, 3, 2)), inst("b", R(7, 1, 3, 2))];

  it("動いたマス数だけ大きさを変え、ほかのモジュールの手前で止まる。1マス未満にしない", () => {
    const state = startGesture(start, { kind: "resize", id: "a" })!;
    expect(rectOf(run(state, [{ dc: 1, dr: 2 }]).shown, "a")).toEqual(R(1, 1, 4, 4));
    expect(rectOf(run(state, [{ dc: 9 }]).shown, "a")).toEqual(R(1, 1, 6, 2));
    expect(rectOf(run(state, [{ dc: -9, dr: -9 }]).shown, "a")).toEqual(R(1, 1, 1, 1));
  });

  it("元の大きさに戻すと、つかんだときの配置に戻る", () => {
    const state = startGesture(start, { kind: "resize", id: "a" })!;
    expect(rectOf(run(state, [{ dc: 2 }, { dc: 0 }]).shown, "a")).toEqual(R(1, 1, 3, 2));
  });

  it("離しても入れ替えない", () => {
    const state = startGesture(start, { kind: "resize", id: "a" })!;
    expect(finishGesture(run(state, [{ dc: 9 }]).state, "b")).toBeNull();
  });
});

describe("ドラッグ：境界線", () => {
  const start = [inst("a", R(1, 1, 6, 8)), inst("b", R(7, 1, 6, 8))];
  const splitter = findSplitters(start)[0];

  it("いちばん近い線まで両側を同時に動かし、1マス未満の手前で止まる", () => {
    const state = startGesture(start, { kind: "splitter", splitter })!;
    const moved = run(state, [{ line: 9 }]).shown;
    expect(rectOf(moved, "a")).toEqual(R(1, 1, 8, 8));
    expect(rectOf(moved, "b")).toEqual(R(9, 1, 4, 8));
    expect(rectOf(run(state, [{ line: 9 }, { line: 12 }]).shown, "b")).toEqual(R(12, 1, 1, 8));
  });

  it("元の線に戻すと、つかんだときの配置に戻る", () => {
    const state = startGesture(start, { kind: "splitter", splitter })!;
    expect(rectOf(run(state, [{ line: 9 }, { line: 7 }]).shown, "a")).toEqual(R(1, 1, 6, 8));
  });
});
