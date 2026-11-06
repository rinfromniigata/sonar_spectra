// 格子（12列×8行）と、格子の上の長方形の操作。位置は1始まり（モックと同じ）。

import type { GridRect } from "../config/types";

export const GRID_COLUMNS = 12;
export const GRID_ROWS = 8;

/** 格子全体 */
export const FULL_GRID: GridRect = { c: 1, r: 1, cs: GRID_COLUMNS, rs: GRID_ROWS };

export function cellCount(rect: GridRect): number {
  return rect.cs * rect.rs;
}

/** 2つの長方形が重なるか */
export function overlaps(a: GridRect, b: GridRect): boolean {
  return a.c < b.c + b.cs && b.c < a.c + a.cs && a.r < b.r + b.rs && b.r < a.r + a.rs;
}

/** 2つの長方形が辺を接しているか（角だけの接触は数えない） */
export function adjacent(a: GridRect, b: GridRect): boolean {
  const rowsOverlap = a.r < b.r + b.rs && b.r < a.r + a.rs;
  const colsOverlap = a.c < b.c + b.cs && b.c < a.c + a.cs;
  const touchX = a.c + a.cs === b.c || b.c + b.cs === a.c;
  const touchY = a.r + a.rs === b.r || b.r + b.rs === a.r;
  return (touchX && rowsOverlap) || (touchY && colsOverlap);
}

/** 2つを合わせると長方形になるなら、その長方形 */
export function unionIfRect(a: GridRect, b: GridRect): GridRect | null {
  if (a.r === b.r && a.rs === b.rs && (a.c + a.cs === b.c || b.c + b.cs === a.c)) {
    return { c: Math.min(a.c, b.c), r: a.r, cs: a.cs + b.cs, rs: a.rs };
  }
  if (a.c === b.c && a.cs === b.cs && (a.r + a.rs === b.r || b.r + b.rs === a.r)) {
    return { c: a.c, r: Math.min(a.r, b.r), cs: a.cs, rs: a.rs + b.rs };
  }
  return null;
}

/** 格子の中に収まっているか */
export function insideGrid(rect: GridRect): boolean {
  return (
    rect.cs >= 1 &&
    rect.rs >= 1 &&
    rect.c >= 1 &&
    rect.r >= 1 &&
    rect.c + rect.cs - 1 <= GRID_COLUMNS &&
    rect.r + rect.rs - 1 <= GRID_ROWS
  );
}

/** 長さ `total` を `parts` 個に、できるだけ均等な整数に分ける（前の方が大きい） */
function evenSizes(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const rest = total % parts;
  return Array.from({ length: parts }, (_, i) => base + (i < rest ? 1 : 0));
}

function stripes(rect: GridRect, parts: number, horizontal: boolean): GridRect[] {
  let offset = 0;
  return evenSizes(horizontal ? rect.cs : rect.rs, parts).map((size) => {
    const part = horizontal
      ? { c: rect.c + offset, r: rect.r, cs: size, rs: rect.rs }
      : { c: rect.c, r: rect.r + offset, cs: rect.cs, rs: size };
    offset += size;
    return part;
  });
}

/**
 * 長方形を `parts` 個に分ける。見た目の長辺（`cellAspect` は1マスの幅÷高さ）に沿って並べて切り、
 * 足りなければ短辺に沿って、それでも足りなければ縦横に分ける。
 * マスが足りていれば（`parts` ≦ マス数）必ず `parts` 個を、重ならず全体を覆う形で返す。足りなければ null
 */
export function splitRect(rect: GridRect, parts: number, cellAspect: number): GridRect[] | null {
  if (parts <= 1) return [rect];
  if (cellCount(rect) < parts) return null;
  const wide = rect.cs * cellAspect >= rect.rs;
  const [first, second] = wide ? [true, false] : [false, true];
  for (const horizontal of [first, second]) {
    if ((horizontal ? rect.cs : rect.rs) >= parts) return stripes(rect, parts, horizontal);
  }
  // どちらの辺もマスが足りない：長辺に沿って bands 本の帯に分け、それぞれの帯を短辺に沿ってさらに分ける。
  // 帯1本に置けるのは短辺のマス数までなので、bands = ⌈parts ÷ 短辺のマス数⌉ 本あれば足りる。
  // マスが足りていれば bands は長辺のマス数以下で、帯ごとの数も短辺のマス数以下になる
  // 並びは蛇行の順（帯ごとに向きを折り返す）にして、続く2つが必ず辺を接するようにする
  // （同じ種類をまとめて渡せば、同じ種類どうしが隣り合う）
  const shortLength = wide ? rect.rs : rect.cs;
  const bands = Math.ceil(parts / shortLength);
  const counts = evenSizes(parts, bands);
  return stripes(rect, bands, wide).flatMap((band, i) => {
    const pieces = stripes(band, counts[i], !wide);
    return i % 2 === 0 ? pieces : pieces.reverse();
  });
}

/** 長方形を2つに分ける切り方（2マス以上ある向きごと）。`horizontal` は横に並べて切るか */
export function halvings(rect: GridRect): { horizontal: boolean; parts: [GridRect, GridRect] }[] {
  const result: { horizontal: boolean; parts: [GridRect, GridRect] }[] = [];
  for (const horizontal of [true, false]) {
    if ((horizontal ? rect.cs : rect.rs) >= 2) {
      const [a, b] = stripes(rect, 2, horizontal);
      result.push({ horizontal, parts: [a, b] });
    }
  }
  return result;
}
