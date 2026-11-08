// 置いたモジュールの一覧（S03）の操作：追加・複製・削除・有効／無効を、構成のストアに書く。
// 配置の計算は layout/manual の純粋関数で行い、ここではストアへの書き込みと、選択・お知らせの扱いだけを持つ。
// - 配置の種類は変えない（自動配置なら自動整列が並べ直し、手動配置なら空きを探して置く。imple 5.2 の6・5.4）
// - 手動配置で格子に空きがなく、無効のまま加わったとき・有効にできなかったときは、お知らせ（notice）を出す
// - 消したもの・無効にしたものが選ばれていれば、選択を外す。加えたもの・複製したものは、置けたら選ぶ

import { shallowRef, type ShallowRef } from "vue";
import type { RuntimeStore } from "../app/runtime_store";
import type { ConfigStore } from "../config/config_store";
import { createInstance, createInstanceId } from "../config/default_instances";
import type { Instance } from "../config/types";
import type { MessageKey } from "../i18n/use_t";
import {
  NEW_INSTANCE_SIZES,
  addInstance,
  duplicateInstance,
  removeInstance,
  setInstanceEnabled,
  type Layout,
} from "../layout/manual";
import type { ModuleKind, Shape } from "../modules/options";
import type { ModuleRegistry } from "../modules/registry";
import type { ModuleDefinition } from "../modules/types";

/** 推奨の形の説明（辞書のキーは、使われていることを検査で見つけられるよう、文字列で書く） */
const SHAPE_KEYS: Record<Shape, MessageKey> = {
  long: "module_shape.long",
  compact: "module_shape.compact",
  free: "module_shape.free",
};

/** 「＋ モジュールを追加」で選べる種類：登録済みのすべての種類（種類の並び順）と、名前・推奨の形の説明の辞書キー */
export function addableKinds(registry: ModuleRegistry): { kind: ModuleKind; labelKey: MessageKey; shapeKey: MessageKey }[] {
  return registry.list().map((definition) => ({
    kind: definition.kind,
    labelKey: definition.labelKey,
    shapeKey: SHAPE_KEYS[definition.shape],
  }));
}

export interface LayoutEditActions {
  /** 一覧に出すお知らせ。なければ null */
  readonly notice: ShallowRef<MessageKey | null>;
  add(kind: ModuleKind): void;
  duplicate(id: string): void;
  remove(id: string): void;
  setEnabled(id: string, enabled: boolean): void;
  /** お知らせを消す（編集を終えたときなど） */
  clearNotice(): void;
}

export interface LayoutEditActionsOptions {
  config: ConfigStore;
  runtime: RuntimeStore;
  registry: ModuleRegistry;
  newId?: () => string;
}

export function createLayoutEditActions(options: LayoutEditActionsOptions): LayoutEditActions {
  const { config, runtime, registry } = options;
  const newId = options.newId ?? createInstanceId;
  const notice = shallowRef<MessageKey | null>(null);

  const layout = (): Layout => config.current.value.layout;

  function commit(next: Layout): void {
    config.updateCurrent((draft) => {
      draft.layout = next;
    });
  }

  function sizeFor(kind: ModuleKind) {
    return NEW_INSTANCE_SIZES[registry.get(kind)?.shape ?? "free"];
  }

  /** 加えたもの（`id`）が置けたら選び、手動配置で無効のまま加わったらお知らせを出す */
  function afterAdding(next: Layout, id: string, wanted: boolean): void {
    const added = next.instances.find((i) => i.id === id);
    if (!added) return;
    if (added.enabled) runtime.selectInstance(id);
    else if (wanted && next.mode === "manual") notice.value = "layout_edit.no_space";
  }

  function add(kind: ModuleKind): void {
    notice.value = null;
    const definition = registry.get(kind) as ModuleDefinition<ModuleKind> | undefined;
    if (!definition) return;
    const instance = createInstance(definition, { enabled: true }, newId()) as Instance;
    const next = addInstance(layout(), instance, sizeFor(kind));
    commit(next);
    afterAdding(next, instance.id, true);
  }

  function duplicate(id: string): void {
    notice.value = null;
    const source = layout().instances.find((i) => i.id === id);
    const copyId = newId();
    const next = duplicateInstance(layout(), id, copyId);
    if (!next || !source) return;
    commit(next);
    afterAdding(next, copyId, source.enabled);
  }

  function remove(id: string): void {
    notice.value = null;
    const next = removeInstance(layout(), id);
    if (!next) return;
    commit(next);
    if (runtime.selectedInstanceId.value === id) runtime.selectInstance(null);
  }

  function setEnabled(id: string, enabled: boolean): void {
    notice.value = null;
    const instance = layout().instances.find((i) => i.id === id);
    if (!instance) return;
    const next = setInstanceEnabled(layout(), id, enabled, sizeFor(instance.kind));
    if (!next) {
      // 手動配置で、有効にしようとしたが置き場所がない
      if (enabled && instance.enabled === false) notice.value = "layout_edit.no_space";
      return;
    }
    commit(next);
    if (!enabled && runtime.selectedInstanceId.value === id) runtime.selectInstance(null);
  }

  return {
    notice,
    add,
    duplicate,
    remove,
    setEnabled,
    clearNotice: () => {
      notice.value = null;
    },
  };
}
