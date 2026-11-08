// インスタンスの設定（S03）の書き込み：配色と、種類ごとの設定（options）の1項目を変える純粋関数。
// layout/manual の setDirection と同じく、変わったときだけ新しい並びを返し、変わらないとき（同じ値・
// 知らないID・その種類にない項目）は null を返す（置く側は null なら書かない。「保存後に変更あり」にしないため）。

import type { Instance } from "./types";

/** 流れる速さの範囲と刻み（SPEC：×0.25〜×3.00、既定×1.00。刻みはモックのスライダー） */
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 3;
export const SPEED_STEP = 0.05;

/** 流れる速さを範囲に収め、刻みに丸める（小数2桁）。数でなければ null */
export function normalizeSpeed(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const clamped = Math.min(SPEED_MAX, Math.max(SPEED_MIN, value));
  return Number((Math.round(clamped / SPEED_STEP) * SPEED_STEP).toFixed(2));
}

function replaceAt(instances: readonly Instance[], index: number, next: Instance): Instance[] {
  const result = [...instances];
  result[index] = next;
  return result;
}

/** そのインスタンスの配色を変える */
export function setPaletteId(instances: readonly Instance[], id: string, paletteId: string): Instance[] | null {
  const index = instances.findIndex((instance) => instance.id === id);
  if (index < 0 || instances[index].paletteId === paletteId) return null;
  return replaceAt(instances, index, { ...instances[index], paletteId });
}

/** そのインスタンスの設定（options）の1項目を変える。その種類が持たない項目は変えない */
export function setInstanceOption(instances: readonly Instance[], id: string, key: string, value: unknown): Instance[] | null {
  const index = instances.findIndex((instance) => instance.id === id);
  if (index < 0) return null;
  const target = instances[index];
  const options = target.options as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(options, key) || Object.is(options[key], value)) return null;
  return replaceAt(instances, index, { ...target, options: { ...options, [key]: value } } as Instance);
}

/** そのインスタンスの流れる速さを変える（範囲に収めて丸める）。流れる速さを持たない種類は変えない */
export function setSpeed(instances: readonly Instance[], id: string, speed: number): Instance[] | null {
  const value = normalizeSpeed(speed);
  return value === null ? null : setInstanceOption(instances, id, "speed", value);
}
