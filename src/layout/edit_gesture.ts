// レイアウト編集のポインタ操作（S03）を、DOM から切り離した純粋関数で持つ。
// - 格子の見た目の大きさ（GridBox）から、ポインタの位置をマス・線・動いたマス数に直す
// - ドラッグ（移動・右下の角での大きさ変更・境界線）は、つかんだときの配置（start）を基準に毎回計算し直す。
//   途中の結果を積み重ねないので、行き過ぎて戻っても元の形に戻る
// - 移動は、置けない位置ではその手前の位置にとどまる。離したときに置けない位置で、ポインタがほかのモジュールの上なら、
//   その2つの位置を入れ替える（自動整列の結果は格子を埋めるので、入れ替えで並べ替えられるように）

import type { GridRect, Instance } from "../config/types";
import { GRID_COLUMNS, GRID_ROWS } from "./grid";
import { moveSplitter, moveTo, resizeTo, swapRects, type GridPosition, type Splitter, type SplitterAxis } from "./manual";

/** 格子の要素の見た目の大きさ（画面上の px）。外周の余白とすき間は、上下左右で同じとする */
export interface GridBox {
  left: number;
  top: number;
  width: number;
  height: number;
  padding: number;
  gap: number;
}

/** 1マス分の間隔（マスの大きさ＋すき間） */
export function cellPitch(box: GridBox): { x: number; y: number } {
  return {
    x: Math.max(1, (box.width - box.padding * 2 + box.gap) / GRID_COLUMNS),
    y: Math.max(1, (box.height - box.padding * 2 + box.gap) / GRID_ROWS),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** 画面上の位置にあるマス（格子の外なら、いちばん近い端のマス） */
export function cellAt(box: GridBox, x: number, y: number): GridPosition {
  const pitch = cellPitch(box);
  return {
    c: clamp(Math.floor((x - box.left - box.padding) / pitch.x) + 1, 1, GRID_COLUMNS),
    r: clamp(Math.floor((y - box.top - box.padding) / pitch.y) + 1, 1, GRID_ROWS),
  };
}

/** ポインタが動いた距離を、いちばん近いマス数に直す（格子に吸着させる） */
export function cellDelta(box: GridBox, dx: number, dy: number): { dc: number; dr: number } {
  const pitch = cellPitch(box);
  // -0 を 0 にそろえる
  return { dc: Math.round(dx / pitch.x) || 0, dr: Math.round(dy / pitch.y) || 0 };
}

/** 画面上の位置にいちばん近い格子の線（縦の線は2〜12、横の線は2〜8） */
export function lineAt(box: GridBox, axis: SplitterAxis, x: number, y: number): number {
  const pitch = cellPitch(box);
  return axis === "v"
    ? clamp(Math.round((x - box.left - box.padding) / pitch.x) + 1, 2, GRID_COLUMNS)
    : clamp(Math.round((y - box.top - box.padding) / pitch.y) + 1, 2, GRID_ROWS);
}

function contains(rect: GridRect, cell: GridPosition): boolean {
  return cell.c >= rect.c && cell.c < rect.c + rect.cs && cell.r >= rect.r && cell.r < rect.r + rect.rs;
}

/** マスを占めている（有効で位置を持つ）インスタンスのID。なければ null */
export function instanceAt(instances: readonly Instance[], cell: GridPosition): string | null {
  return instances.find((i) => i.enabled && i.rect && contains(i.rect, cell))?.id ?? null;
}

// ---------------------------------------------------------------------------
// ドラッグ

export type Gesture =
  | { kind: "move"; id: string; origin: GridRect }
  | { kind: "resize"; id: string; origin: GridRect }
  | { kind: "splitter"; splitter: Splitter };

export interface GestureState {
  /** つかんだときの配置（手動配置の形。自動配置なら固定した結果） */
  readonly start: readonly Instance[];
  readonly gesture: Gesture;
  /** つかんでから配置を変えたか */
  readonly changed: boolean;
  /** 移動で、最後に求めた位置が置けなかったか（離したときの入れ替えに使う） */
  readonly blocked: boolean;
}

/** ポインタの今の位置。dc・dr はつかんでから動いたマス数、line はいちばん近い格子の線（境界線で使う） */
export interface GestureInput {
  dc: number;
  dr: number;
  line: number;
}

/** つかんだときの状態。移動・大きさ変更は、つかんだインスタンスが位置を持つときだけ（なければ null） */
export function startGesture(start: readonly Instance[], target: { kind: "move" | "resize"; id: string } | { kind: "splitter"; splitter: Splitter }): GestureState | null {
  if (target.kind === "splitter") return { start, gesture: target, changed: false, blocked: false };
  const origin = start.find((i) => i.id === target.id && i.enabled)?.rect;
  if (!origin) return null;
  return { start, gesture: { kind: target.kind, id: target.id, origin }, changed: false, blocked: false };
}

/**
 * ポインタが動いたときの配置。`next` が null なら配置は変えない（今の表示のまま）。
 * つかんだ位置に戻したときは、つかんだときの配置を返す
 */
export function updateGesture(state: GestureState, input: GestureInput): { state: GestureState; next: Instance[] | null } {
  const { start, gesture } = state;
  let result: Instance[] | null;
  switch (gesture.kind) {
    case "move":
      if (input.dc === 0 && input.dr === 0) {
        result = null;
      } else {
        result = moveTo(start, gesture.id, { c: gesture.origin.c + input.dc, r: gesture.origin.r + input.dr });
        // 置けないときは、その手前（最後に置けた位置）にとどまる
        if (!result) return { state: { ...state, blocked: true }, next: null };
      }
      break;
    case "resize":
      result = resizeTo(start, gesture.id, { cs: gesture.origin.cs + input.dc, rs: gesture.origin.rs + input.dr });
      break;
    case "splitter":
      result = moveSplitter(start, gesture.splitter, input.line);
      break;
  }
  // 変わらない（つかんだときの形に戻った）とき、すでに変えていれば、つかんだときの配置に戻す
  const next = result ?? (state.changed ? [...start] : null);
  return { state: { ...state, blocked: false, changed: state.changed || next !== null }, next };
}

/**
 * 離したときの配置。移動で、最後に求めた位置が置けず、ポインタがほかのモジュールの上（`dropOn`）なら、
 * つかんだときの配置で2つの位置を入れ替えたものを返す。それ以外は null（今の表示のまま）
 */
export function finishGesture(state: GestureState, dropOn: string | null): Instance[] | null {
  if (state.gesture.kind !== "move" || !state.blocked || !dropOn) return null;
  return swapRects(state.start, state.gesture.id, dropOn);
}
