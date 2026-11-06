// 構成のうち、インスタンスと配色の型（imple 5.1）。構成全体と保存の型は、ストアを作るとき（T4-2）に足す。

import type { Direction, ModuleKind, ModuleOptions } from "../modules/options";

/** 12×8 の格子の位置（1始まり。モックと同じ） */
export interface GridRect {
  c: number;
  r: number;
  cs: number;
  rs: number;
}

/** 種類 K のインスタンス */
export interface InstanceOf<K extends ModuleKind> {
  id: string;
  kind: K;
  enabled: boolean;
  /** 自動配置中は null */
  rect: GridRect | null;
  /** 既定の配置で専用の位置を持つもの */
  slot?: "pan";
  direction: Direction | null;
  /** "preset.a" など、または自分で作った配色のID */
  paletteId: string;
  /** 初版は既定の1系統だけ */
  sourceId: "default";
  options: ModuleOptions[K];
}

/** 種類を問わないインスタンス */
export type Instance = { [K in ModuleKind]: InstanceOf<K> }[ModuleKind];

/** 自分で作った配色（ダーク用の値） */
export interface Palette {
  id: string;
  name: string;
  main: string;
  sub: string;
  accent: string;
}
