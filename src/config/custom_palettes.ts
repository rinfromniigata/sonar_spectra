// 自分で作った配色（構成の customPalettes）の操作。構成を受け取り、変えた構成を返す純粋関数。
// 変わらないときは null を返し、置く側は書かない（「保存後に変更あり」にしない。instance_settings と同じ扱い）。
// - 標準の配色は編集・削除できない（コードに持つ）。変えたいときは複製してから変える（SPEC・S02a）
// - 削除：その配色を使っていたインスタンスは、配色を既定（マゼンタ主）に戻す（imple 5.4）
// - 色はダーク用の値を `#rrggbb`（小文字）で持つ。読めない値は受け付けない
// - 名前は、今の構成の配色の一覧と、標準の配色の名前（reserved。今の言語の文言）と重ならない（imple 5.4。v3で追加）。
//   作る・複製・名前の変更で、すでにある名前なら末尾に `_{n}` を付ける（unique_name）。すでにある同名の配色は書き換えない

import { formatHexColor, parseHexColor, type PaletteTriple } from "../theme/light_palette";
import { DEFAULT_PALETTE_ID, findCustomPalette } from "./palettes";
import type { Config, Palette } from "./types";
import { uniqueName } from "./unique_name";

/** 自分で作った配色のIDの頭（標準の配色の "preset." と重ならない） */
export const CUSTOM_PALETTE_ID_PREFIX = "custom.";

/** 名前の長さの上限（文字数） */
export const PALETTE_NAME_MAX_LENGTH = 40;

export function createPaletteId(): string {
  return `${CUSTOM_PALETTE_ID_PREFIX}${crypto.randomUUID()}`;
}

/** 色を `#rrggbb`（小文字）にそろえる。読めなければ null */
export function normalizeColor(text: string): string | null {
  const rgb = parseHexColor(text);
  return rgb ? formatHexColor(rgb) : null;
}

/** 名前の前後の空白を除き、長さを上限までにする。空なら null */
export function normalizePaletteName(text: string): string | null {
  const name = [...text.trim()].slice(0, PALETTE_NAME_MAX_LENGTH).join("").trim();
  return name === "" ? null : name;
}

/**
 * 一覧に足す・名前を変えるときの名前：前後の空白を除いて上限までにし、ほかの配色（exceptId を除く）と
 * 標準の配色の名前（reserved）にあれば `_{n}` を付ける。空なら null
 */
export function availablePaletteName(
  customPalettes: readonly Palette[],
  text: string,
  reserved: readonly string[] = [],
  exceptId?: string,
): string | null {
  const name = normalizePaletteName(text);
  if (name === null) return null;
  const taken = [...customPalettes.filter((p) => p.id !== exceptId).map((p) => p.name), ...reserved];
  return uniqueName(name, taken, PALETTE_NAME_MAX_LENGTH);
}

/**
 * 新しい配色の名前。`format(n)`（「マイ配色 {number}」）のうち、まだない名前（標準の配色の名前を含む）で n が最も小さいもの
 */
export function nextPaletteName(
  customPalettes: readonly Palette[],
  format: (n: number) => string,
  reserved: readonly string[] = [],
): string {
  const names = new Set([...customPalettes.map((p) => p.name), ...reserved]);
  for (let n = 1; ; n++) {
    const name = format(n);
    if (!names.has(name)) return name;
  }
}

/** 配色を末尾に足す。色は `#rrggbb` にそろえ、読めなければ足さない。名前がかぶれば `_{n}` を付ける */
export function addPalette(config: Config, palette: Palette, reserved: readonly string[] = []): Config | null {
  const name = availablePaletteName(config.customPalettes, palette.name, reserved);
  const main = normalizeColor(palette.main);
  const sub = normalizeColor(palette.sub);
  const accent = normalizeColor(palette.accent);
  if (name === null || main === null || sub === null || accent === null) return null;
  if (findCustomPalette(palette.id, config.customPalettes)) return null;
  return { ...config, customPalettes: [...config.customPalettes, { id: palette.id, name, main, sub, accent }] };
}

export type PalettePatch = Partial<Pick<Palette, "name"> & PaletteTriple>;

/**
 * 名前・主色・副色・強調色を変える。空の名前・読めない色は無視する。名前がほかの配色・標準の配色とかぶれば `_{n}` を付ける。
 * 何も変わらなければ null
 */
export function updatePalette(config: Config, id: string, patch: PalettePatch, reserved: readonly string[] = []): Config | null {
  const index = config.customPalettes.findIndex((p) => p.id === id);
  if (index < 0) return null;
  const current = config.customPalettes[index];
  const next: Palette = { ...current };
  if (patch.name !== undefined) {
    const name = normalizePaletteName(patch.name);
    // 今の名前のままなら、ほかとかぶっていても（以前からある同名）そのままにする
    if (name !== null && name !== current.name) {
      next.name = availablePaletteName(config.customPalettes, name, reserved, id) ?? current.name;
    }
  }
  for (const key of ["main", "sub", "accent"] as const) {
    const value = patch[key];
    if (value !== undefined) next[key] = normalizeColor(value) ?? current[key];
  }
  if (next.name === current.name && next.main === current.main && next.sub === current.sub && next.accent === current.accent) {
    return null;
  }
  const customPalettes = config.customPalettes.slice();
  customPalettes[index] = next;
  return { ...config, customPalettes };
}

/** 配色を消し、それを使っていたインスタンスの配色を既定に戻す。ない配色なら null */
export function removePalette(config: Config, id: string): Config | null {
  if (!findCustomPalette(id, config.customPalettes)) return null;
  return {
    ...config,
    customPalettes: config.customPalettes.filter((p) => p.id !== id),
    layout: {
      ...config.layout,
      instances: config.layout.instances.map((instance) =>
        instance.paletteId === id ? { ...instance, paletteId: DEFAULT_PALETTE_ID } : instance,
      ),
    },
  };
}
