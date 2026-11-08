// 手動配置の操作：純粋関数（imple 4.3・5.2 の5と6）。
//
// - どの操作も、元の配置を書き換えず、新しい配置を返す。変えられない（変わらない）ときは null を返す
// - 有効で位置（rect）を持つインスタンスだけが格子を占める。無効なインスタンスの rect は、
//   有効に戻したときの置き場所の候補として残す（自動配置から固定したときは null）
// - どの操作も、格子の外に出さず、ほかのモジュールと重ねず、1マス未満にしない
// - 手で動かす前に beginManual で自動配置の結果を固定し、「自動整列」は returnToAuto で戻す

import type { Config, GridRect, Instance } from "../config/types";
import type { Direction, ModuleKind, Shape } from "../modules/options";
import { autoArrange, type AutoLayout } from "./auto_arrange";
import { GRID_COLUMNS, GRID_ROWS, insideGrid, overlaps } from "./grid";

export type Layout = Config["layout"];

/** 格子の上の大きさ */
export interface GridSize {
  cs: number;
  rs: number;
}

/** 格子の上の位置（左上のマス） */
export interface GridPosition {
  c: number;
  r: number;
}

// ---------------------------------------------------------------------------
// 占有と空き

/** 格子を占めているもの（有効で位置を持つインスタンス） */
function occupants(instances: readonly Instance[]): { id: string; rect: GridRect }[] {
  return instances.flatMap((i) => (i.enabled && i.rect ? [{ id: i.id, rect: i.rect }] : []));
}

/** `rect` を置けるか：格子の中で1マス以上あり、`ignore` 以外の占有と重ならない */
export function canPlace(instances: readonly Instance[], rect: GridRect, ignore: readonly string[] = []): boolean {
  return insideGrid(rect) && occupants(instances).every((o) => ignore.includes(o.id) || !overlaps(o.rect, rect));
}

/**
 * 大きさ `size` が入る空きを、左上から（上の行から順に、行の中は左から）探す。なければ null。
 * `ignore` のインスタンスは占有に数えない
 */
export function findSpace(instances: readonly Instance[], size: GridSize, ignore: readonly string[] = []): GridRect | null {
  for (let r = 1; r + size.rs - 1 <= GRID_ROWS; r++) {
    for (let c = 1; c + size.cs - 1 <= GRID_COLUMNS; c++) {
      const rect = { c, r, cs: size.cs, rs: size.rs };
      if (canPlace(instances, rect, ignore)) return rect;
    }
  }
  return null;
}

/**
 * 新しく置くインスタンスの位置を決める規則（imple 5.2 の6）：同じ大きさが入る空きを左上から探し、
 * なければ1マスの空きに置く。1マスの空きもなければ null（呼び出し側で無効にして加える）
 */
export function placeNewRect(instances: readonly Instance[], size: GridSize, ignore: readonly string[] = []): GridRect | null {
  return findSpace(instances, size, ignore) ?? findSpace(instances, { cs: 1, rs: 1 }, ignore);
}

function sameRect(a: GridRect, b: GridRect): boolean {
  return a.c === b.c && a.r === b.r && a.cs === b.cs && a.rs === b.rs;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** `rects` にあるインスタンスの位置だけを替えた配置 */
function withRects(instances: readonly Instance[], rects: ReadonlyMap<string, GridRect>): Instance[] {
  return instances.map((i) => (rects.has(i.id) ? ({ ...i, rect: { ...rects.get(i.id)! } } as Instance) : i));
}

/** 動かせるインスタンス（有効で位置を持つ）の位置 */
function placedRect(instances: readonly Instance[], id: string): GridRect | null {
  const instance = instances.find((i) => i.id === id);
  return instance && instance.enabled && instance.rect ? instance.rect : null;
}

// ---------------------------------------------------------------------------
// 自動から手動への固定と、自動への戻し

/**
 * 自動整列の結果をインスタンスに固定する。有効なものは、その時点の位置と、自動整列が決めた方向
 * （縦長の帯のレベルの横向きなど）を受け継ぎ、見た目を変えない。無効なものは位置を持たない。
 * 置き場所がなかった有効なもの（96マスより多いときだけ）は、無効にする
 */
export function pinAutoLayout(instances: readonly Instance[], layout: AutoLayout): Instance[] {
  return instances.map((instance) => {
    if (!instance.enabled) return { ...instance, rect: null } as Instance;
    const rect = layout.rects.get(instance.id);
    if (!rect) return { ...instance, enabled: false, rect: null } as Instance;
    const direction = layout.directions.get(instance.id) ?? instance.direction;
    return { ...instance, rect: { ...rect }, direction } as Instance;
  });
}

/**
 * 手で動かす前に呼ぶ。自動配置なら、`aspect`（格子の幅÷高さ）での自動整列の結果を固定して手動配置にする。
 * すでに手動配置なら、そのまま返す
 */
export function beginManual(layout: Layout, aspect: number, shapeOf?: (kind: ModuleKind) => Shape): Layout {
  if (layout.mode === "manual") return layout;
  return { mode: "manual", instances: pinAutoLayout(layout.instances, autoArrange(layout.instances, aspect, shapeOf)) };
}

/** 「自動整列」：自動配置に戻す。位置はすべて捨てる（方向は残す） */
export function returnToAuto(layout: Layout): Layout {
  return { mode: "auto", instances: layout.instances.map((i) => ({ ...i, rect: null }) as Instance) };
}

// ---------------------------------------------------------------------------
// 移動・大きさの変更（手動配置のインスタンス）

/**
 * 大きさを保ったまま、左上を `to` へ動かす（ドラッグ）。格子からはみ出す分は端に寄せる。
 * ほかのモジュールと重なるときと、位置が変わらないときは null
 */
export function moveTo(instances: readonly Instance[], id: string, to: GridPosition): Instance[] | null {
  const rect = placedRect(instances, id);
  if (!rect) return null;
  const next = {
    c: clamp(to.c, 1, GRID_COLUMNS - rect.cs + 1),
    r: clamp(to.r, 1, GRID_ROWS - rect.rs + 1),
    cs: rect.cs,
    rs: rect.rs,
  };
  if (sameRect(next, rect) || !canPlace(instances, next, [id])) return null;
  return withRects(instances, new Map([[id, next]]));
}

/** 矢印キー：1マスずつ動かす。格子の端やほかのモジュールに当たるときは null */
export function moveBy(instances: readonly Instance[], id: string, dc: number, dr: number): Instance[] | null {
  const rect = placedRect(instances, id);
  if (!rect) return null;
  const next = { ...rect, c: rect.c + dc, r: rect.r + dr };
  if (!canPlace(instances, next, [id])) return null;
  return withRects(instances, new Map([[id, next]]));
}

/**
 * 右下の角で大きさを `to` にする（左上は動かさない）。1マス未満にせず、格子からはみ出す分は端までにする。
 * ほかのモジュールに当たるときは、今の大きさと `to` の間で、置ける大きさのうち `to` に最も近いもの
 * （同じなら広いもの）にする。大きさが変わらないときは null
 */
export function resizeTo(instances: readonly Instance[], id: string, to: GridSize): Instance[] | null {
  const rect = placedRect(instances, id);
  if (!rect) return null;
  const target = {
    cs: clamp(to.cs, 1, GRID_COLUMNS - rect.c + 1),
    rs: clamp(to.rs, 1, GRID_ROWS - rect.r + 1),
  };
  let best: { rect: GridRect; distance: number; area: number } | null = null;
  for (let cs = Math.min(rect.cs, target.cs); cs <= Math.max(rect.cs, target.cs); cs++) {
    for (let rs = Math.min(rect.rs, target.rs); rs <= Math.max(rect.rs, target.rs); rs++) {
      const candidate = { c: rect.c, r: rect.r, cs, rs };
      if (!canPlace(instances, candidate, [id])) continue;
      const distance = Math.abs(cs - target.cs) + Math.abs(rs - target.rs);
      const area = cs * rs;
      if (!best || distance < best.distance || (distance === best.distance && area > best.area)) {
        best = { rect: candidate, distance, area };
      }
    }
  }
  if (!best || sameRect(best.rect, rect)) return null;
  return withRects(instances, new Map([[id, best.rect]]));
}

/** 矢印キー：大きさを1マスずつ変える。1マス未満になるとき、格子の端やほかのモジュールに当たるときは null */
export function resizeBy(instances: readonly Instance[], id: string, dcs: number, drs: number): Instance[] | null {
  const rect = placedRect(instances, id);
  if (!rect) return null;
  const next = { ...rect, cs: rect.cs + dcs, rs: rect.rs + drs };
  if (!canPlace(instances, next, [id])) return null;
  return withRects(instances, new Map([[id, next]]));
}

/**
 * 2つのモジュールの位置を入れ替える（大きさごと）。どちらも手動配置で位置を持つときだけ。
 * 自動整列の結果は格子を埋めているため、空きのない格子で並べ替えるのに使う
 */
export function swapRects(instances: readonly Instance[], a: string, b: string): Instance[] | null {
  const rectA = placedRect(instances, a);
  const rectB = placedRect(instances, b);
  if (!rectA || !rectB || a === b) return null;
  return withRects(
    instances,
    new Map([
      [a, rectB],
      [b, rectA],
    ]),
  );
}

// ---------------------------------------------------------------------------
// 境界線

/** 境界線の向き。v は縦の線（左右の大きさを変える）、h は横の線（上下の大きさを変える） */
export type SplitterAxis = "v" | "h";

/**
 * 隣り合うモジュールの境界線。`line` は格子の線の番号（v は2〜12列目の左端、h は2〜8行目の上端）。
 * `before` は線で終わる側（左・上）、`after` は線から始まる側（右・下）。
 * `start`・`end` は線に沿った範囲（v は行、h は列。end は含まない）
 */
export interface Splitter {
  axis: SplitterAxis;
  line: number;
  before: string[];
  after: string[];
  start: number;
  end: number;
}

/** 線に沿った向きの範囲 */
function span(rect: GridRect, axis: SplitterAxis): [number, number] {
  return axis === "v" ? [rect.r, rect.r + rect.rs] : [rect.c, rect.c + rect.cs];
}

function spansOverlap(a: GridRect, b: GridRect, axis: SplitterAxis): boolean {
  const [a0, a1] = span(a, axis);
  const [b0, b1] = span(b, axis);
  return a0 < b1 && b0 < a1;
}

/** 線で終わる側か */
function endsAt(rect: GridRect, axis: SplitterAxis, line: number): boolean {
  return axis === "v" ? rect.c + rect.cs === line : rect.r + rect.rs === line;
}

/** 線から始まる側か */
function startsAt(rect: GridRect, axis: SplitterAxis, line: number): boolean {
  return axis === "v" ? rect.c === line : rect.r === line;
}

/**
 * 境界線を見つける。線の両側で辺を接しているモジュールの組を、線に沿ってつながる単位でまとめる
 * （同じ線でも、間に線をまたぐモジュールがあって途切れていれば、別の境界線になる）
 */
export function findSplitters(instances: readonly Instance[]): Splitter[] {
  const placed = occupants(instances);
  const result: Splitter[] = [];
  const lines: [SplitterAxis, number][] = [
    ...Array.from({ length: GRID_COLUMNS - 1 }, (_, i) => ["v", i + 2] as [SplitterAxis, number]),
    ...Array.from({ length: GRID_ROWS - 1 }, (_, i) => ["h", i + 2] as [SplitterAxis, number]),
  ];
  for (const [axis, line] of lines) {
    const before = placed.filter((o) => endsAt(o.rect, axis, line));
    const after = placed.filter((o) => startsAt(o.rect, axis, line));
    // 線をはさんで辺を接する組をたどり、つながる単位にまとめる
    const seen = new Set<string>();
    for (const seed of before) {
      if (seen.has(seed.id) || !after.some((q) => spansOverlap(seed.rect, q.rect, axis))) continue;
      const group = { before: [] as typeof placed, after: [] as typeof placed };
      const queue: { o: (typeof placed)[number]; side: "before" | "after" }[] = [{ o: seed, side: "before" }];
      seen.add(seed.id);
      while (queue.length > 0) {
        const { o, side } = queue.shift()!;
        group[side].push(o);
        const others = side === "before" ? after : before;
        for (const q of others) {
          if (seen.has(q.id) || !spansOverlap(o.rect, q.rect, axis)) continue;
          seen.add(q.id);
          queue.push({ o: q, side: side === "before" ? "after" : "before" });
        }
      }
      const members = [...group.before, ...group.after];
      result.push({
        axis,
        line,
        before: group.before.map((o) => o.id),
        after: group.after.map((o) => o.id),
        start: Math.min(...members.map((o) => span(o.rect, axis)[0])),
        end: Math.max(...members.map((o) => span(o.rect, axis)[1])),
      });
    }
  }
  return result;
}

/** 境界線を `line` に動かしたときの位置。1マス未満になるときは null */
function shiftedRects(
  instances: readonly Instance[],
  splitter: Pick<Splitter, "axis" | "before" | "after">,
  line: number,
): Map<string, GridRect> | null {
  const rects = new Map<string, GridRect>();
  for (const id of splitter.before) {
    const rect = placedRect(instances, id);
    if (!rect) return null;
    const next = splitter.axis === "v" ? { ...rect, cs: line - rect.c } : { ...rect, rs: line - rect.r };
    if (next.cs < 1 || next.rs < 1) return null;
    rects.set(id, next);
  }
  for (const id of splitter.after) {
    const rect = placedRect(instances, id);
    if (!rect) return null;
    const next =
      splitter.axis === "v"
        ? { ...rect, c: line, cs: rect.c + rect.cs - line }
        : { ...rect, r: line, rs: rect.r + rect.rs - line };
    if (next.cs < 1 || next.rs < 1) return null;
    rects.set(id, next);
  }
  return rects;
}

/** 今の線の位置（`before` の終わり）。両側がそろっていなければ null */
function currentLine(instances: readonly Instance[], splitter: Pick<Splitter, "axis" | "before" | "after">): number | null {
  const ends = splitter.before.map((id) => placedRect(instances, id)).map((r) => (r ? (splitter.axis === "v" ? r.c + r.cs : r.r + r.rs) : null));
  const starts = splitter.after.map((id) => placedRect(instances, id)).map((r) => (r ? (splitter.axis === "v" ? r.c : r.r) : null));
  const all = [...ends, ...starts];
  if (all.length === 0 || all.some((v) => v === null || v !== all[0])) return null;
  return all[0];
}

/**
 * 境界線を `to` へ動かし、両側の大きさを同時に変える。線の位置は `before` の今の位置から求めるので、
 * ドラッグ中は、つかんだときの境界線をそのまま渡し続けてよい。
 * `to` まで動かせないとき（1マス未満になる・ほかのモジュールに当たる）は、`to` の手前の動かせるところまで動かす。
 * 少しも動かせないときは null
 */
export function moveSplitter(
  instances: readonly Instance[],
  splitter: Pick<Splitter, "axis" | "before" | "after">,
  to: number,
): Instance[] | null {
  const from = currentLine(instances, splitter);
  if (from === null || to === from) return null;
  const ids = [...splitter.before, ...splitter.after];
  const step = to > from ? 1 : -1;
  let last: Map<string, GridRect> | null = null;
  for (let line = from + step; line !== to + step; line += step) {
    const rects = shiftedRects(instances, splitter, line);
    if (!rects || ![...rects.values()].every((rect) => canPlace(instances, rect, ids))) break;
    last = rects;
  }
  return last ? withRects(instances, last) : null;
}

// ---------------------------------------------------------------------------
// 流れる方向

/** 流れる方向を変える（配置は変えない）。変わらないとき・インスタンスがないとき・方向のないものは null */
export function setDirection(instances: readonly Instance[], id: string, direction: Direction): Instance[] | null {
  const target = instances.find((i) => i.id === id);
  if (!target || target.direction === null || target.direction === direction) return null;
  return instances.map((i) => (i.id === id ? ({ ...i, direction } as Instance) : i));
}

// ---------------------------------------------------------------------------
// 矢印キー

/** 矢印キー → 動かす向き。矢印キーでなければ null */
export function arrowDelta(key: string): { dc: number; dr: number } | null {
  switch (key) {
    case "ArrowLeft":
      return { dc: -1, dr: 0 };
    case "ArrowRight":
      return { dc: 1, dr: 0 };
    case "ArrowUp":
      return { dc: 0, dr: -1 };
    case "ArrowDown":
      return { dc: 0, dr: 1 };
    default:
      return null;
  }
}

/** 境界線での矢印キー → 線を動かす量（縦の線は左右、横の線は上下だけ）。対象外のキーは null */
export function splitterStep(axis: SplitterAxis, key: string): -1 | 1 | null {
  const delta = arrowDelta(key);
  if (!delta) return null;
  const step = axis === "v" ? delta.dc : delta.dr;
  return step === 0 ? null : (step as -1 | 1);
}

// ---------------------------------------------------------------------------
// 置き場所を探して加える（複製・追加・有効に戻す）

/**
 * 手動配置でインスタンスに置き場所を与える。`preferred` の位置が空いていればそこに、
 * なければ placeNewRect の規則で探す。置けなければ無効にして位置を持たない
 */
function placeIn(instances: readonly Instance[], instance: Instance, size: GridSize, preferred: GridRect | null): Instance {
  const ignore = [instance.id];
  const rect = preferred && canPlace(instances, preferred, ignore) ? preferred : placeNewRect(instances, size, ignore);
  return rect ? ({ ...instance, enabled: true, rect: { ...rect } } as Instance) : ({ ...instance, enabled: false, rect: null } as Instance);
}

/**
 * 複製（imple 5.2 の6）：新しい `newId` で、種類・方向・配色・入力源・種類ごとの設定・専用の位置を受け継ぎ、
 * 複製元のすぐ後ろに加える。自動配置では位置を持たない（自動整列が並べる）。
 * 手動配置では、複製元と同じ大きさが入る空き → 1マスの空き の順に探して置き、どちらもなければ無効にして加える。
 * 複製元が無効なら、複製も無効のまま加える。複製元がなければ null
 */
export function duplicateInstance(layout: Layout, sourceId: string, newId: string): Layout | null {
  const index = layout.instances.findIndex((i) => i.id === sourceId);
  if (index < 0) return null;
  const source = layout.instances[index];
  const copy = { ...source, id: newId, rect: null, options: structuredClone(source.options) } as Instance;
  let placed = copy;
  if (layout.mode === "manual" && source.enabled) {
    const size = source.rect ? { cs: source.rect.cs, rs: source.rect.rs } : { cs: 1, rs: 1 };
    placed = placeIn(layout.instances, copy, size, null);
  }
  const instances = [...layout.instances.slice(0, index + 1), placed, ...layout.instances.slice(index + 1)];
  return { ...layout, instances };
}

/**
 * 手動配置で、位置を持たないインスタンスを新しく置くときの大きさ（推奨の形ごと）。
 * 細長いものは横長（今の細長い種類は、既定の向きで横長の枠が合う）、正方形に近いものは正方形、形を選ばないものはやや横長
 */
export const NEW_INSTANCE_SIZES: Record<Shape, GridSize> = {
  long: { cs: 6, rs: 2 },
  compact: { cs: 3, rs: 3 },
  free: { cs: 4, rs: 3 },
};

/**
 * インスタンスを消す（imple 5.4）。手動配置では空いたマスはそのまま残り、自動配置では残りで並べ直される。
 * 種類の最後の1つも消せる。ないときは null
 */
export function removeInstance(layout: Layout, id: string): Layout | null {
  if (!layout.instances.some((i) => i.id === id)) return null;
  return { ...layout, instances: layout.instances.filter((i) => i.id !== id) };
}

/**
 * 新しいインスタンスを末尾に加える（「＋ モジュールを追加」）。自動配置では位置を持たない。
 * 手動配置で有効なものは、大きさ `size` で置き場所を探して置き、なければ無効にして加える
 */
export function addInstance(layout: Layout, instance: Instance, size: GridSize): Layout {
  const fresh = { ...instance, rect: null } as Instance;
  const placed = layout.mode === "manual" && fresh.enabled ? placeIn(layout.instances, fresh, size, null) : fresh;
  return { ...layout, instances: [...layout.instances, placed] };
}

/**
 * 有効／無効を切り替える。無効にしても、手動配置の位置は戻すときのために残す。
 * 手動配置で有効に戻すときは、残した位置が空いていればそこへ、なければ残した大きさ（なければ `size`）で
 * 置き場所を探す。
 * 自動配置では切り替えるだけ。インスタンスがないとき・変わらないとき・置き場所がないとき（1マスの空きもない）は null
 */
export function setInstanceEnabled(layout: Layout, id: string, enabled: boolean, size: GridSize): Layout | null {
  const instance = layout.instances.find((i) => i.id === id);
  if (!instance || instance.enabled === enabled) return null;
  let next: Instance;
  if (!enabled || layout.mode === "auto") {
    next = { ...instance, enabled } as Instance;
  } else {
    const kept = instance.rect;
    next = placeIn(layout.instances, instance, kept ? { cs: kept.cs, rs: kept.rs } : size, kept);
    if (!next.enabled) return null; // 置けなければ変えない（無効のまま、残した位置も保つ）
  }
  return { ...layout, instances: layout.instances.map((i) => (i.id === id ? next : i)) };
}
