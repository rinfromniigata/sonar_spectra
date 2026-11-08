// 実行中だけの状態のストア（imple 4.4 の useRuntimeStore）：入力源の状態、レイアウト編集中かどうか、開いているドロワー。
// 保存しない。

import { inject, ref, shallowRef, type InjectionKey, type Ref, type ShallowRef } from "vue";
import type { SourceStatusEvent } from "../source/source_status";

/** 開くドロワー：設定（S02）、配色の管理（S02a）、構成の管理（S02b） */
export type DrawerId = "settings" | "palettes" | "configs";

export interface RuntimeStore {
  /** 最後に届いた入力源の状態（イベント source-status）。まだ届いていなければ null */
  readonly source: ShallowRef<SourceStatusEvent | null>;
  /** レイアウト編集中か（S03） */
  readonly layoutEditing: Ref<boolean>;
  /** 開いているドロワー。なければ null */
  readonly drawer: Ref<DrawerId | null>;
  openDrawer(id: DrawerId): void;
  closeDrawer(): void;
  setLayoutEditing(editing: boolean): void;
}

export function createRuntimeStore(): RuntimeStore {
  const drawer = ref<DrawerId | null>(null);
  const layoutEditing = ref(false);
  return {
    source: shallowRef<SourceStatusEvent | null>(null),
    layoutEditing,
    drawer,
    openDrawer: (id) => {
      drawer.value = id;
    },
    closeDrawer: () => {
      drawer.value = null;
    },
    setLayoutEditing: (editing) => {
      layoutEditing.value = editing;
    },
  };
}

export const RUNTIME_STORE_KEY: InjectionKey<RuntimeStore> = Symbol("runtime-store");

/** アプリに provide された実行中の状態のストア */
export function useRuntimeStore(): RuntimeStore {
  const store = inject(RUNTIME_STORE_KEY, null);
  if (!store) throw new Error("runtime store is not provided");
  return store;
}
