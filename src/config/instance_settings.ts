// インスタンスの設定（S03）の書き込み：配色・種類ごとの設定（options）の1項目・流れる速さを変える純粋関数と、既定に戻す関数。
// layout/manual の setDirection と同じく、変わったときだけ新しい並びを返し、変わらないとき（同じ値・
// 知らないID・その種類にない項目）は null を返す（置く側は null なら書かない。「保存後に変更あり」にしないため）。

import type { ModuleKind } from "../modules/options";
import type { ModuleRegistry } from "../modules/registry";
import type { AnyModuleDefinition, DefaultInstanceSpec } from "../modules/types";
import { DEFAULT_PALETTE_ID } from "./palettes";
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

// ---------------------------------------------------------------------------
// 既定に戻す

/** 「既定に戻す」で戻る項目（方向・配色・種類ごとの設定）。配置・有効／無効・入力源・専用の位置は含まない */
export interface InstanceDefaults {
  direction: Instance["direction"];
  paletteId: string;
  options: Record<string, unknown>;
}

/**
 * そのインスタンスの既定。作られたときの値で、方向は種類の既定の向き、配色は既定の配色、設定は種類の既定値。
 * 専用の位置（slot）を持つインスタンスは、同じ位置の既定の指定を重ねる（周波数別の定位は、表示方式が「周波数別の定位」のまま）。
 * 専用の位置を持たないインスタンスは、位置を持たない最初の既定の指定を重ねる（複製や追加で増えたものも同じ）
 */
export function defaultsOf(instance: Instance, definition: AnyModuleDefinition): InstanceDefaults {
  const specs = definition.defaultInstances as readonly DefaultInstanceSpec<ModuleKind>[];
  const spec = specs.find((item) => item.slot === instance.slot) ?? specs.find((item) => !item.slot);
  return {
    direction: definition.baseDirection,
    paletteId: DEFAULT_PALETTE_ID,
    options: { ...(definition.defaultOptions as Record<string, unknown>), ...(spec?.options as Record<string, unknown> | undefined) },
  };
}

function sameOptions(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) if (!Object.is(a[key], b[key])) return false;
  return true;
}

/** 方向・配色・種類ごとの設定がすべて既定のままか（「既定に戻す」を押せるかの判定） */
export function isDefaultInstance(instance: Instance, definition: AnyModuleDefinition): boolean {
  const defaults = defaultsOf(instance, definition);
  return (
    instance.direction === defaults.direction &&
    instance.paletteId === defaults.paletteId &&
    sameOptions(instance.options as Record<string, unknown>, defaults.options)
  );
}

/**
 * そのインスタンスの方向・配色・種類ごとの設定を既定に戻す。配置（rect）・有効／無効・入力源・専用の位置は残し、
 * ほかのインスタンスは変えない。すでに既定のとき・知らないID・知らない種類は null（書かない）
 */
export function resetInstance(instances: readonly Instance[], id: string, registry: ModuleRegistry): Instance[] | null {
  const index = instances.findIndex((instance) => instance.id === id);
  if (index < 0) return null;
  const target = instances[index];
  const definition = registry.get(target.kind) as AnyModuleDefinition | undefined;
  if (!definition || isDefaultInstance(target, definition)) return null;
  const defaults = defaultsOf(target, definition);
  return replaceAt(instances, index, { ...target, ...defaults } as Instance);
}
