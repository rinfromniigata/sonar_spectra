// 自動整列：有効なインスタンスと画面比から配置を選ぶ純粋関数（imple 4.3）。
//
// 1. 画面比の帯からテンプレートを選ぶ
// 2. 各種類の1つ目をその種類の領域に、2つ目の位相（slot: "pan"）を専用の位置に置く
// 3. 置くものがない領域は、隣と合わせて長方形になる領域に吸収させる（スペクトログラムを優先）
// 4. 同じ種類の2つ目以降は、その種類の領域を分けて隣に並べる。テンプレートにない種類（VU・クロマ・
//    重心と変化量）は、推奨の形が近い領域に相乗りする
// 5. 縦長の帯では、レベルを横向きにする

import type { GridRect, Instance } from "../config/types";
import type { Direction, ModuleKind, Shape } from "../modules/options";
import { moduleRegistry } from "../modules/registry";
import { FULL_GRID, GRID_COLUMNS, GRID_ROWS, adjacent, cellCount, halvings, splitRect, unionIfRect } from "./grid";
import { AREA_KEYS, TEMPLATES, bandFor, type AreaKey, type Band } from "./templates";

export interface AutoLayout {
  band: Band;
  /** インスタンスのID → 位置。無効なインスタンスは入らない */
  rects: Map<string, GridRect>;
  /** 自動整列が決める方向（インスタンスの方向より優先する）。縦長の帯のレベルなど */
  directions: Map<string, Direction>;
}

/** テンプレートに領域がない種類が相乗りする先（推奨の形ごと。先にあるものから選ぶ） */
const HOSTS_BY_SHAPE: Record<Shape, readonly AreaKey[]> = {
  compact: ["loud", "stereo"],
  long: ["gram", "wave"],
  free: ["gram"],
};

function defaultShapeOf(kind: ModuleKind): Shape {
  return moduleRegistry.get(kind)?.shape ?? "free";
}

interface Group {
  key: AreaKey | null;
  rect: GridRect;
  members: Instance[];
}

/** 合わせて長方形になる空いた領域の組を1つ見つけて合わせる。見つかれば true */
function mergeEmptyPair(empty: GridRect[]): boolean {
  for (let i = 0; i < empty.length; i++) {
    for (let j = i + 1; j < empty.length; j++) {
      const union = unionIfRect(empty[i], empty[j]);
      if (union) {
        empty.splice(j, 1);
        empty[i] = union;
        return true;
      }
    }
  }
  return false;
}

/**
 * 空いた領域 `area` のうち、`rect` の辺に合わせた部分（`rect` と合わせると長方形になる部分）と、残りの部分。
 * `rect` が `area` と辺を接し、接する向きの幅が `area` の中に収まるときだけ切り分けられる
 */
function alignedPiece(rect: GridRect, area: GridRect): { piece: GridRect; rest: GridRect[] } | null {
  const touchesSide = rect.c + rect.cs === area.c || area.c + area.cs === rect.c;
  if (touchesSide && rect.r >= area.r && rect.r + rect.rs <= area.r + area.rs) {
    const rest: GridRect[] = [];
    if (rect.r > area.r) rest.push({ c: area.c, r: area.r, cs: area.cs, rs: rect.r - area.r });
    const end = rect.r + rect.rs;
    if (end < area.r + area.rs) rest.push({ c: area.c, r: end, cs: area.cs, rs: area.r + area.rs - end });
    return { piece: { c: area.c, r: rect.r, cs: area.cs, rs: rect.rs }, rest };
  }
  const touchesEnd = rect.r + rect.rs === area.r || area.r + area.rs === rect.r;
  if (touchesEnd && rect.c >= area.c && rect.c + rect.cs <= area.c + area.cs) {
    const rest: GridRect[] = [];
    if (rect.c > area.c) rest.push({ c: area.c, r: area.r, cs: rect.c - area.c, rs: area.rs });
    const end = rect.c + rect.cs;
    if (end < area.c + area.cs) rest.push({ c: end, r: area.r, cs: area.c + area.cs - end, rs: area.rs });
    return { piece: { c: rect.c, r: area.r, cs: rect.cs, rs: area.rs }, rest };
  }
  return null;
}

/**
 * 空いた領域を1つ、隣の領域の辺に合わせて切り分け、合う部分をその領域に吸収させる（残りは空いた領域に戻す）。
 * 候補が複数あれば、スペクトログラム（S04「残りをスペクトログラムで埋める」）→ 吸収する部分が大きいもの の順に選ぶ。
 * 吸収できれば true（空いたマスは必ず減る）
 */
function absorbPartially(groups: Group[], empty: GridRect[]): boolean {
  let best: { score: number[]; index: number; group: Group; piece: GridRect; rest: GridRect[] } | null = null;
  empty.forEach((area, index) => {
    for (const group of groups) {
      const split = alignedPiece(group.rect, area);
      if (!split) continue;
      const score = [group.key === "gram" ? 1 : 0, cellCount(split.piece)];
      if (!best || compareScores(score, best.score) > 0) best = { score, index, group, ...split };
    }
  });
  const chosen = best as { index: number; group: Group; piece: GridRect; rest: GridRect[] } | null;
  if (!chosen) return false;
  chosen.group.rect = unionIfRect(chosen.group.rect, chosen.piece)!;
  empty.splice(chosen.index, 1, ...chosen.rest);
  return true;
}

/** 同じ種類として隣に並べる組か（種類と、専用の位置の有無が同じ） */
function sameGroup(a: Instance, b: Instance): boolean {
  return a.kind === b.kind && a.slot === b.slot;
}

/** 相乗りの並びを、同じ種類どうしが続くようにまとめる（種類の順は、最初に出てきた順） */
function clusterBySameGroup(members: Instance[]): Instance[] {
  const clusters: Instance[][] = [];
  for (const member of members) {
    const cluster = clusters.find((c) => sameGroup(c[0], member));
    if (cluster) cluster.push(member);
    else clusters.push([member]);
  }
  return clusters.flat();
}

/** スコアを先頭から比べる（辞書式）。a が良ければ正、同じなら 0 */
function compareScores(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** 組の全員が、組のほかのだれかと辺を接しているか（1つだけなら真） */
function groupConnected(ids: string[], rects: Map<string, GridRect>): boolean {
  if (ids.length < 2) return true;
  return ids.every((id) => ids.some((other) => other !== id && adjacent(rects.get(id)!, rects.get(other)!)));
}

/**
 * 領域に入りきらなかったインスタンスを置く。置き場所の候補は、どのモジュールにも吸収されずに残った空き領域（`free`。
 * そのまま使う）と、置いてある位置（2マス以上）を半分に分けたもの。全通りから、次の順で良いものを選ぶ：
 * 新しいインスタンスが同じ種類に接する → 分けた側の種類の「隣り合い」を壊さない → 空き領域を使う →
 * 見た目の長辺で切る → 大きい位置。置き場所がなければ false
 */
function placeOverflow(
  instance: Instance,
  rects: Map<string, GridRect>,
  free: GridRect[],
  byId: Map<string, Instance>,
  cellAspect: number,
): boolean {
  const placed = [...rects.entries()];
  const groupOf = (member: Instance) => placed.filter(([id]) => sameGroup(byId.get(id)!, member)).map(([id]) => id);
  const siblingIds = groupOf(instance);
  const touchesSibling = (given: GridRect, trial: Map<string, GridRect>) =>
    siblingIds.length === 0 || siblingIds.some((id) => adjacent(given, trial.get(id)!));
  let best: { score: number[]; targetId: string | null; freeIndex: number; kept: GridRect | null; given: GridRect } | null = null;

  free.forEach((area, freeIndex) => {
    const score = [touchesSibling(area, rects) ? 1 : 0, 1, 1, 1, cellCount(area)];
    if (!best || compareScores(score, best.score) > 0) best = { score, targetId: null, freeIndex, kept: null, given: area };
  });

  for (const [targetId, target] of placed) {
    if (cellCount(target) < 2) continue;
    const targetMember = byId.get(targetId)!;
    const targetGroup = sameGroup(targetMember, instance) ? [...groupOf(targetMember), instance.id] : groupOf(targetMember);
    const wasConnected = groupConnected(groupOf(targetMember), rects);
    const longIsHorizontal = target.cs * cellAspect >= target.rs;
    for (const { horizontal, parts } of halvings(target)) {
      for (const give of [0, 1] as const) {
        const given = parts[give];
        const kept = parts[1 - give];
        const trial = new Map(rects).set(targetId, kept).set(instance.id, given);
        const score = [
          touchesSibling(given, trial) ? 1 : 0,
          !wasConnected || groupConnected(targetGroup, trial) ? 1 : 0,
          0,
          horizontal === longIsHorizontal ? 1 : 0,
          cellCount(target),
        ];
        if (!best || compareScores(score, best.score) > 0) best = { score, targetId, freeIndex: -1, kept, given };
      }
    }
  }
  const chosen = best as { targetId: string | null; freeIndex: number; kept: GridRect | null; given: GridRect } | null;
  if (!chosen) return false;
  if (chosen.targetId !== null && chosen.kept) rects.set(chosen.targetId, chosen.kept);
  else free.splice(chosen.freeIndex, 1);
  rects.set(instance.id, chosen.given);
  return true;
}

/** 縦長の帯でのレベルの向き：縦の流れを横に倒す */
function tallLevelDirection(direction: Direction | null): Direction {
  return direction === "down" ? "left" : direction === "left" ? "left" : "right";
}

export function autoArrange(
  instances: readonly Instance[],
  aspect: number,
  shapeOf: (kind: ModuleKind) => Shape = defaultShapeOf,
): AutoLayout {
  const band = bandFor(aspect);
  const template = TEMPLATES[band];
  const cellAspect = (aspect * GRID_ROWS) / GRID_COLUMNS;
  const enabled = instances.filter((i) => i.enabled);

  // 2. 1つ目を領域に置く
  const owner = new Map<AreaKey, Instance>();
  const extras: Instance[] = [];
  for (const instance of enabled) {
    const key: AreaKey | null =
      instance.slot === "pan" ? "pan" : (AREA_KEYS as readonly string[]).includes(instance.kind) ? (instance.kind as AreaKey) : null;
    if (key && !owner.has(key)) owner.set(key, instance);
    else extras.push(instance);
  }

  const groups: Group[] = AREA_KEYS.filter((key) => owner.has(key)).map((key) => ({
    key,
    rect: template[key],
    members: [owner.get(key)!],
  }));

  // 3. 空いた領域を、隣と合わせて長方形になる領域に吸収させる
  let empty = AREA_KEYS.filter((key) => !owner.has(key)).map((key) => template[key]);
  // 先に、空いた領域どうしを合わせられるだけ合わせる（片方だけが先に吸収され、残りが半端な形で取り残されないように）
  while (mergeEmptyPair(empty));
  for (let changed = groups.length > 0; changed && empty.length > 0; ) {
    changed = false;
    // 小さい空き領域から吸収する（合わせ先の選択肢が少ないので、大きい領域の吸収で塞がれないように）
    empty.sort((a, b) => cellCount(a) - cellCount(b));
    empty = empty.filter((area) => {
      const candidates = groups
        .map((group) => ({ group, union: unionIfRect(group.rect, area) }))
        .filter((c): c is { group: Group; union: GridRect } => c.union !== null)
        .sort((a, b) => Number(b.group.key === "gram") - Number(a.group.key === "gram") || cellCount(b.group.rect) - cellCount(a.group.rect));
      if (candidates.length === 0) return true;
      candidates[0].group.rect = candidates[0].union;
      changed = true;
      return false;
    });
    // どれも吸収できなければ、空いた領域どうしを合わせてから試し直す（縦長の最下段が両方空いたときなど）
    if (!changed) changed = mergeEmptyPair(empty);
    // それでもだめなら、空いた領域を隣の辺に合わせて切り分け、合う部分だけを隣に吸収させる
    if (!changed) changed = absorbPartially(groups, empty);
  }

  // 4. 2つ目以降と、テンプレートにない種類を、相乗りする領域に加える
  for (const instance of extras) {
    const sameKind = groups.find((g) => g.members.some((m) => m.kind === instance.kind && m.slot === instance.slot));
    const host =
      sameKind ??
      HOSTS_BY_SHAPE[shapeOf(instance.kind)].map((key) => groups.find((g) => g.key === key)).find((g) => g !== undefined) ??
      [...groups].sort((a, b) => cellCount(b.rect) - cellCount(a.rect))[0];
    if (host) host.members.push(instance);
    else groups.push({ key: null, rect: FULL_GRID, members: [instance] });
  }

  // 領域を、相乗りする数に分ける。マスが足りない分は、あとでほかの位置を半分にして置く
  const rects = new Map<string, GridRect>();
  const overflow: Instance[] = [];
  for (const group of groups) {
    // 同じ種類どうしを続けて並べる（splitRect は続く2つを必ず隣り合わせる）
    group.members = clusterBySameGroup(group.members);
    // マス数までは必ず分けられる（splitRect）。返った数だけ置き、残りはあふれた分にする
    const parts = splitRect(group.rect, Math.min(group.members.length, cellCount(group.rect)), cellAspect) ?? [group.rect];
    group.members.slice(0, parts.length).forEach((member, i) => rects.set(member.id, parts[i]));
    overflow.push(...group.members.slice(parts.length));
  }
  const byId = new Map(enabled.map((i) => [i.id, i]));
  for (const instance of overflow) {
    if (!placeOverflow(instance, rects, empty, byId, cellAspect)) break; // 96マスより多いときだけ。置けない分は置かない
  }

  // 5. 縦長の帯ではレベルを横向きにする
  const directions = new Map<string, Direction>();
  if (band === "tall") {
    for (const instance of enabled) {
      if (instance.kind === "level") directions.set(instance.id, tallLevelDirection(instance.direction));
    }
  }

  return { band, rects, directions };
}
