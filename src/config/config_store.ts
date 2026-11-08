// 構成のストア（imple 4.4 の useConfigStore）：現在の構成、保存済みの構成、使用中の構成のID、変更ありかどうか、
// 入力源のデバイス。保存は Rust の settings_store に任せる。
// - 状態は shallowRef に置き、変わるたびに新しいオブジェクトに置き換える（描画ループが毎フレーム読むので、
//   深いリアクティブのプロキシを通さない。変更は updateCurrent などのメソッドからだけ行う）
// - 起動時の復元：保存された状態があればそれを、なければ既定の状態を作って保存する。読み込みに失敗したとき
//   （権限など）は既定の状態で起動するが、元のファイルを上書きしないよう、その回は保存しない
// - 自動保存：変わるたびに、少し間を置いて（300ms）保存する。保存は重ねず、最後の状態を書く

import { computed, inject, shallowRef, type ComputedRef, type InjectionKey, type ShallowRef } from "vue";
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
}

/** 復元の結果。created は既定の状態を作って保存した、unavailable は読み込みに失敗して既定の状態で起動した（保存しない） */
export type RestoreResult = "restored" | "created" | "unavailable";

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
  /** 今の構成を変える（写しを recipe で書き換えて置き換える）。「保存後に変更あり」になる */
  updateCurrent(recipe: (draft: Config) => void): void;
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
      state.value = normalize(loaded);
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
    commit({ ...state.value, current: draft, dirty: true });
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
