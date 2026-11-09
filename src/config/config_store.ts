// 構成のストア（imple 4.4 の useConfigStore）：現在の構成、保存済みの構成、使用中の構成のID、変更ありかどうか、
// 入力源のデバイス。保存は Rust の settings_store に任せる。
// - 状態は shallowRef に置き、変わるたびに新しいオブジェクトに置き換える（描画ループが毎フレーム読むので、
//   深いリアクティブのプロキシを通さない。変更は updateCurrent などのメソッドからだけ行う）
// - 起動時の復元：保存された状態があればそれを、なければ既定の状態を作って保存する。読み込みに失敗したとき
//   （権限など）は既定の状態で起動するが、元のファイルを上書きしないよう、その回は保存しない
// - 自動保存：変わるたびに、少し間を置いて（300ms）保存する。保存は重ねず、最後の状態を書く
// - 構成の操作（T7-3）：名前を付けて保存・上書き・切り替え・複製・削除。中身は saved_configs の純粋関数。
//   切り替えは、変更があれば上書き・別名で保存・破棄のどれにするかを渡されるまで切り替えない（needsConfirm を返す）
// - 変更ありの判定：今の構成を変えるたびに、使用中の保存済み構成と中身を比べ直す（元に戻せば変更なしに戻る）

import { computed, inject, shallowRef, type ComputedRef, type InjectionKey, type ShallowRef } from "vue";
import { createConfigId } from "./persisted_state";
import {
  canRemove,
  duplicate,
  findSavedConfig,
  importConfig as importConfigState,
  isModified,
  overwrite as overwriteState,
  remove,
  saveAs as saveAsState,
  switchTo,
} from "./saved_configs";
import type { Config, PersistedState, SavedConfig } from "./types";

/** 変更から保存までの間（imple 4.4） */
export const SAVE_DELAY_MS = 300;

export interface ConfigPersistence {
  load(): Promise<PersistedState | null>;
  save(state: PersistedState): Promise<void>;
}

export interface ConfigStoreOptions {
  persistence: ConfigPersistence;
  /** 既定の状態を作る（初めての起動、退避のあと、読み込みの失敗） */
  createDefault: () => PersistedState;
  /** 復元した状態を整え直す（モジュールの設定の既定値を補う） */
  normalize?: (state: PersistedState) => PersistedState;
  saveDelayMs?: number;
  onError?: (error: unknown) => void;
  /** 新しい保存済み構成の ID（名前を付けて保存・複製） */
  newConfigId?: () => string;
  /** 保存日（savedAt）に使う今の時刻 */
  now?: () => Date;
}

/** 復元の結果。created は既定の状態を作って保存した、unavailable は読み込みに失敗して既定の状態で起動した（保存しない） */
export type RestoreResult = "restored" | "created" | "unavailable";

/** 変更があるときの切り替えで、今の構成をどうするか */
export type SwitchResolution =
  /** 使用中の構成に上書きしてから切り替える */
  | { action: "overwrite" }
  /** 名前を付けて保存してから切り替える */
  | { action: "saveAs"; name: string }
  /** 変更を捨てて切り替える */
  | { action: "discard" };

/**
 * 切り替えの結果。switched は切り替えた、needsConfirm は変更があるのでどうするかを確かめる（何も変えていない）、
 * unchanged は使用中で変更もない、notFound はない構成、invalidName は別名で保存の名前が空（何も変えていない）
 */
export type SwitchResult = "switched" | "needsConfirm" | "unchanged" | "notFound" | "invalidName";

export interface ConfigStore {
  readonly state: Readonly<ShallowRef<PersistedState>>;
  /** 今表示している構成 */
  readonly current: ComputedRef<Config>;
  /** 使用中の保存済み構成 */
  readonly activeConfig: ComputedRef<SavedConfig | null>;
  /** 保存後に変更があるか */
  readonly dirty: ComputedRef<boolean>;
  /** 入力源のデバイス。null は既定の出力デバイス */
  readonly deviceId: ComputedRef<string | null>;
  /** 起動時に1度呼ぶ */
  restore(): Promise<RestoreResult>;
  /**
   * 今の構成を変える（写しを recipe で書き換えて置き換える）。使用中の保存済み構成と中身が違えば「保存後に変更あり」になる
   */
  updateCurrent(recipe: (draft: Config) => void): void;
  /** 名前を付けて保存し、使用中にする。足した構成の ID を返す。名前が空なら null（何もしない） */
  saveAs(name: string): string | null;
  /** 使用中の保存済み構成に上書きする。できたら true */
  overwrite(): boolean;
  /** 保存済み構成に切り替える。変更があるときは resolution を渡すまで切り替えない */
  switchConfig(id: string, resolution?: SwitchResolution): SwitchResult;
  /** 保存済み構成を、名前を付けて複製する（元のすぐ後ろ。使用中は変えない）。足した構成の ID を返す。できなければ null */
  duplicateConfig(id: string, name: string): string | null;
  /** 保存済み構成を削除できるか（使用中は削除できない） */
  canRemoveConfig(id: string): boolean;
  /** 保存済み構成を削除する。使用中・ない構成なら false（何もしない） */
  removeConfig(id: string): boolean;
  /**
   * 読み込んで検証した構成を、新しい ID で一覧の末尾に足す（使用中は変えない）。モジュールの設定の既定値を補う。
   * 足した構成の ID を返す。名前が空なら null
   */
  importConfig(saved: SavedConfig): string | null;
  /** 入力源のデバイスを変える。構成には含めないので「保存後に変更あり」にはならない */
  setDeviceId(deviceId: string | null): void;
  /** 間を置いている保存を、すぐに行って終わるまで待つ（ウィンドウを閉じるとき） */
  flush(): Promise<void>;
  dispose(): void;
}

export function createConfigStore(options: ConfigStoreOptions): ConfigStore {
  const { persistence, createDefault } = options;
  const normalize = options.normalize ?? ((s: PersistedState) => s);
  const delay = options.saveDelayMs ?? SAVE_DELAY_MS;
  const onError = options.onError ?? ((error: unknown) => console.error(error));
  const newConfigId = options.newConfigId ?? createConfigId;
  const now = options.now ?? (() => new Date());

  const state = shallowRef<PersistedState>(createDefault());
  /** 保存してよいか（復元が済み、読み込みに失敗していない） */
  let persistEnabled = false;
  /** まだ保存していない変更があるか */
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let saving: Promise<void> | null = null;

  /** 保存していない変更がなくなるまで書く（同時には1つだけ書く） */
  async function drain(): Promise<void> {
    for (;;) {
      if (saving) {
        await saving;
        continue;
      }
      if (!pending || !persistEnabled) return;
      pending = false;
      saving = persistence
        .save(state.value)
        .catch(onError)
        .finally(() => {
          saving = null;
        });
    }
  }

  function clearTimer(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function commit(next: PersistedState): void {
    state.value = next;
    pending = true;
    if (!persistEnabled) return;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void drain();
    }, delay);
  }

  async function restore(): Promise<RestoreResult> {
    let loaded: PersistedState | null;
    try {
      loaded = await persistence.load();
    } catch (error) {
      onError(error);
      state.value = createDefault();
      persistEnabled = false;
      return "unavailable";
    }
    persistEnabled = true;
    if (loaded) {
      // 変更ありは、保存された値ではなく中身を比べて決め直す（判定の決まりが変わっても食い違わないように）
      const normalized = normalize(loaded);
      state.value = { ...normalized, dirty: isModified(normalized) };
      return "restored";
    }
    state.value = createDefault();
    pending = true;
    await drain();
    return "created";
  }

  function updateCurrent(recipe: (draft: Config) => void): void {
    const draft = structuredClone(state.value.current);
    recipe(draft);
    const next = { ...state.value, current: draft };
    commit({ ...next, dirty: isModified(next) });
  }

  function saveAs(name: string): string | null {
    const id = newConfigId();
    const next = saveAsState(state.value, name, id, now());
    if (!next) return null;
    commit(next);
    return id;
  }

  function overwrite(): boolean {
    const next = overwriteState(state.value, now());
    if (!next) return false;
    commit(next);
    return true;
  }

  function switchConfig(id: string, resolution?: SwitchResolution): SwitchResult {
    let base = state.value;
    if (!findSavedConfig(base, id)) return "notFound";
    if (base.dirty) {
      if (!resolution) return "needsConfirm";
      if (resolution.action === "overwrite") {
        base = overwriteState(base, now()) ?? base;
      } else if (resolution.action === "saveAs") {
        const saved = saveAsState(base, resolution.name, newConfigId(), now());
        if (!saved) return "invalidName";
        base = saved;
      }
    } else if (id === base.activeConfigId) {
      return "unchanged";
    }
    commit(switchTo(base, id)!);
    return "switched";
  }

  function duplicateConfig(sourceId: string, name: string): string | null {
    const id = newConfigId();
    const next = duplicate(state.value, sourceId, name, id, now());
    if (!next) return null;
    commit(next);
    return id;
  }

  function removeConfig(id: string): boolean {
    const next = remove(state.value, id);
    if (!next) return false;
    commit(next);
    return true;
  }

  function importConfig(saved: SavedConfig): string | null {
    const id = newConfigId();
    const next = importConfigState(state.value, saved, id);
    if (!next) return null;
    commit(normalize(next));
    return id;
  }

  function setDeviceId(deviceId: string | null): void {
    if (state.value.source.deviceId === deviceId) return;
    commit({ ...state.value, source: { deviceId } });
  }

  async function flush(): Promise<void> {
    clearTimer();
    await drain();
  }

  return {
    state,
    current: computed(() => state.value.current),
    activeConfig: computed(() => state.value.savedConfigs.find((c) => c.id === state.value.activeConfigId) ?? null),
    dirty: computed(() => state.value.dirty),
    deviceId: computed(() => state.value.source.deviceId),
    restore,
    updateCurrent,
    saveAs,
    overwrite,
    switchConfig,
    duplicateConfig,
    canRemoveConfig: (id) => canRemove(state.value, id),
    removeConfig,
    importConfig,
    setDeviceId,
    flush,
    dispose: clearTimer,
  };
}

export const CONFIG_STORE_KEY: InjectionKey<ConfigStore> = Symbol("config-store");

/** アプリに provide された構成のストア */
export function useConfigStore(): ConfigStore {
  const store = inject(CONFIG_STORE_KEY, null);
  if (!store) throw new Error("config store is not provided");
  return store;
}
