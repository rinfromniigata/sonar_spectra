// 配色の管理（S02a）と、インスタンスの設定（S03）の「＋ 配色を作る」の操作を、構成のストアに書く。
// 構成の書き換えは config/custom_palettes の純粋関数で行い、ここではストアへの書き込みと、編集中の配色・ドロワーの扱いだけを持つ。
// - 作る：既定の配色（マゼンタ主）のダーク用の値を初期値に、「マイ配色 n」を足して編集中にする
// - 複製：標準の配色はトークンのダークの値、自分で作った配色はその値を写し、「{name}のコピー」を足して編集中にする
// - 削除：使っていたインスタンスは既定の配色に戻す。編集中なら編集をやめる
// - インスタンスの設定の「＋ 配色を作る」：そのインスタンスの今の配色の値を初期値に作って、そのインスタンスに当て、
//   インスタンスの設定を閉じて、配色の管理を編集中の状態で開く（色を変えるとそのモジュールにすぐ効く）

import type { RuntimeStore } from "../app/runtime_store";
import type { ConfigStore } from "../config/config_store";
import {
  addPalette,
  createPaletteId,
  nextPaletteName,
  removePalette,
  updatePalette,
  type PalettePatch,
} from "../config/custom_palettes";
import { setPaletteId } from "../config/instance_settings";
import {
  DEFAULT_PALETTE_ID,
  findCustomPalette,
  findPresetPalette,
  paletteDarkColors,
  type PresetPalette,
} from "../config/palettes";
import type { Config } from "../config/types";

/** 新しい配色の名前の作り方（辞書を引く側が渡す） */
export interface PaletteNames {
  /** 「マイ配色 {number}」 */
  fresh(n: number): string;
  /** 「{name}のコピー」 */
  copy(name: string): string;
  /** 標準の配色の名前（「マゼンタ主」） */
  preset(palette: PresetPalette): string;
}

export interface PaletteActions {
  create(): void;
  duplicate(id: string): void;
  remove(id: string): void;
  update(id: string, patch: PalettePatch): void;
  createForInstance(instanceId: string): void;
}

export interface PaletteActionsOptions {
  config: ConfigStore;
  runtime: RuntimeStore;
  names: PaletteNames;
  newId?: () => string;
}

export function createPaletteActions(options: PaletteActionsOptions): PaletteActions {
  const { config, runtime, names } = options;
  const newId = options.newId ?? createPaletteId;

  /** 今の構成に op を当てる。変わらなければ書かない。書いたら true */
  function apply(op: (current: Config) => Config | null): boolean {
    if (!op(config.current.value)) return false;
    config.updateCurrent((draft) => {
      const next = op(draft);
      if (next) Object.assign(draft, next);
    });
    return true;
  }

  /**
   * sourceId の配色の値を写した配色を足して、編集中にする。assignTo を渡すと、そのインスタンスの配色にもする。
   * 足せたら true
   */
  function addAndEdit(sourceId: string, name: string, assignTo?: string): boolean {
    const id = newId();
    const colors = paletteDarkColors(sourceId, config.current.value.customPalettes);
    const added = apply((current) => {
      const next = addPalette(current, { id, name, ...colors });
      if (!next || assignTo === undefined) return next;
      const instances = setPaletteId(next.layout.instances, assignTo, id);
      return instances ? { ...next, layout: { ...next.layout, instances } } : next;
    });
    if (added) runtime.editPalette(id);
    return added;
  }

  function freshName(): string {
    return nextPaletteName(config.current.value.customPalettes, names.fresh);
  }

  return {
    create() {
      addAndEdit(DEFAULT_PALETTE_ID, freshName());
    },
    duplicate(id) {
      const custom = findCustomPalette(id, config.current.value.customPalettes);
      const preset = custom ? undefined : findPresetPalette(id);
      if (!custom && !preset) return;
      addAndEdit(id, names.copy(custom ? custom.name : names.preset(preset!)));
    },
    remove(id) {
      if (!apply((current) => removePalette(current, id))) return;
      if (runtime.editingPaletteId.value === id) runtime.editPalette(null);
    },
    update(id, patch) {
      apply((current) => updatePalette(current, id, patch));
    },
    createForInstance(instanceId) {
      const instance = config.current.value.layout.instances.find((i) => i.id === instanceId);
      if (!instance || !addAndEdit(instance.paletteId, freshName(), instanceId)) return;
      runtime.closeInstanceSettings();
      runtime.openDrawer("palettes");
    },
  };
}
