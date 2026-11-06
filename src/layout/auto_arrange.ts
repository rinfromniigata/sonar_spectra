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
import { FULL_GRID, GRID_COLUMNS, GRID_ROWS, cellCount, splitRect, unionIfRect } from "./grid";
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
  for (let changed = groups.length > 0; changed && empty.length > 0; ) {
    changed = false;
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

  // 領域を、相乗りする数に分ける。マスが足りない分は、あとで最も大きい位置を半分にして置く
  const rects = new Map<string, GridRect>();
  const overflow: Instance[] = [];
  for (const group of groups) {
    const parts = splitRect(group.rect, group.members.length, cellAspect);
    if (parts) {
      group.members.forEach((member, i) => rects.set(member.id, parts[i]));
    } else {
      const fit = Math.max(1, Math.min(group.members.length, cellCount(group.rect)));
      const partial = splitRect(group.rect, fit, cellAspect) ?? [group.rect];
      group.members.slice(0, fit).forEach((member, i) => rects.set(member.id, partial[i]));
      overflow.push(...group.members.slice(fit));
    }
  }
  for (const instance of overflow) {
    const largest = [...rects.entries()].sort((a, b) => cellCount(b[1]) - cellCount(a[1]))[0];
    if (!largest || cellCount(largest[1]) < 2) break; // 96マスより多いときだけ。置けない分は置かない
    const [kept, given] = splitRect(largest[1], 2, cellAspect)!;
    rects.set(largest[0], kept);
    rects.set(instance.id, given);
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
