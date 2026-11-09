// 実行中だけの状態のストア（imple 4.4 の useRuntimeStore）：入力源の状態、レイアウト編集中かどうかと選んでいるインスタンス、開いているドロワー、全画面かどうか。
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
  /** レイアウト編集で選んでいるインスタンスのID。なければ null（編集を終えると null に戻る） */
  readonly selectedInstanceId: Ref<string | null>;
  /**
   * インスタンスの設定（S03 のポップオーバー）を開いているか。開いている間は、選んでいるインスタンスの設定を出す
   * （開いたまま別のモジュールを選ぶと、そちらに移る。モックと同じ）。×・Esc・編集を終えると閉じる
   */
  readonly instanceSettingsOpen: Ref<boolean>;
  /** 開いているドロワー。なければ null */
  readonly drawer: Ref<DrawerId | null>;
  /**
   * 見出しのボタンで戻る先のドロワー（設定パネルから開いた配色の管理なら settings）。
   * なければ null で、見出しのボタンは「閉じる」になる
   */
  readonly drawerBack: Ref<DrawerId | null>;
  /** 配色の管理（S02a）で編集している、自分で作った配色のID。なければ null */
  readonly editingPaletteId: Ref<string | null>;
  /** ボーダレスフルスクリーン中か（実際のウィンドウの状態を映す。保存しない。起動時の全画面は設定の display.startFullscreen） */
  readonly fullscreen: Ref<boolean>;
  /** ドロワーを開く。back を渡すと、見出しのボタンが「戻る」になり、そのドロワーへ戻る */
  openDrawer(id: DrawerId, back?: DrawerId | null): void;
  closeDrawer(): void;
  /** 見出しのボタン：戻る先があればそこを開き、なければ閉じる */
  backDrawer(): void;
  /** 配色の管理で編集する配色を選ぶ（null で選ばない） */
  editPalette(id: string | null): void;
  /** レイアウト編集を始める・終える。終えると選択を外し、インスタンスの設定を閉じる */
  setLayoutEditing(editing: boolean): void;
  selectInstance(id: string | null): void;
  /** そのインスタンスを選んで、インスタンスの設定を開く */
  openInstanceSettings(id: string): void;
  closeInstanceSettings(): void;
}

export function createRuntimeStore(): RuntimeStore {
  const drawer = ref<DrawerId | null>(null);
  const drawerBack = ref<DrawerId | null>(null);
  const editingPaletteId = ref<string | null>(null);
  const layoutEditing = ref(false);
  const fullscreen = ref(false);
  const selectedInstanceId = ref<string | null>(null);
  const instanceSettingsOpen = ref(false);
  return {
    source: shallowRef<SourceStatusEvent | null>(null),
    layoutEditing,
    selectedInstanceId,
    instanceSettingsOpen,
    drawer,
    drawerBack,
    editingPaletteId,
    fullscreen,
    openDrawer: (id, back = null) => {
      drawer.value = id;
      drawerBack.value = back;
    },
    closeDrawer: () => {
      drawer.value = null;
      drawerBack.value = null;
    },
    backDrawer: () => {
      drawer.value = drawerBack.value;
      drawerBack.value = null;
    },
    editPalette: (id) => {
      editingPaletteId.value = id;
    },
    setLayoutEditing: (editing) => {
      layoutEditing.value = editing;
      if (!editing) {
        selectedInstanceId.value = null;
        instanceSettingsOpen.value = false;
      }
    },
    selectInstance: (id) => {
      selectedInstanceId.value = id;
    },
    openInstanceSettings: (id) => {
      selectedInstanceId.value = id;
      instanceSettingsOpen.value = true;
    },
    closeInstanceSettings: () => {
      instanceSettingsOpen.value = false;
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
