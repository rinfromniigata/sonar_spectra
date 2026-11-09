// 構成の管理（S02b）の操作と、画面に出す途中の状態（切り替えの確認・名前の入力・お知らせ）。
// 構成の書き換えは構成のストア（T7-3）の操作で行い、ここでは確認と名前の入力の流れ、ファイルの書き出し・読み込みを扱う。
// - 切り替え：変更がなければすぐ切り替える。変更があれば確認を出し、上書き・別の名前で保存・破棄・キャンセルを選ばせる。
//   別の名前で保存は、名前を入れてもらってから保存して切り替える
// - 名前を付けて保存：名前を入れてもらってから保存する（初めの値は「{使用中の名前}のコピー」）
// - 複製：「{name}のコピー」として元のすぐ後ろに足す。削除：使用中は消せない（ボタンを押せなくする）
// - 書き出し・読み込み：config/config_file。結果はお知らせ（notice）で知らせる。ダイアログで選ばなかったときは何も出さない

import { shallowRef, type ShallowRef } from "vue";
import type { ConfigStore, SwitchResult } from "../config/config_store";
import { exportConfigFile, readConfigFile, tauriConfigFileIo, type ConfigFileIo } from "../config/config_file";
import { findSavedConfig, normalizeConfigName } from "../config/saved_configs";

/** お知らせ。文言は画面が辞書から引く */
export type ConfigNotice =
  | { kind: "exported" | "imported"; name: string }
  | { kind: "export_failed" | "import_failed" };

/** 名前の入力。saveAs は名前を付けて保存、switchSaveAs は切り替えの前の別名で保存 */
export interface NameForm {
  purpose: "saveAs" | "switchSaveAs";
  initial: string;
}

export interface ConfigManagerNames {
  /** 「{name}のコピー」 */
  copy(name: string): string;
  /** ダイアログのファイルの種類の名前 */
  filterName(): string;
  /** 名前からファイル名を作れないときのファイル名 */
  fallbackFileName(): string;
}

export interface ConfigManager {
  readonly notice: ShallowRef<ConfigNotice | null>;
  /** 変更があるときの切り替えの確認。なければ null */
  readonly pendingSwitch: ShallowRef<{ id: string } | null>;
  readonly nameForm: ShallowRef<NameForm | null>;
  requestSwitch(id: string): SwitchResult;
  /** 確認で上書き・破棄を選んだ */
  resolveSwitch(action: "overwrite" | "discard"): void;
  /** 確認で「別の名前で保存」を選んだ（名前の入力に進む） */
  startSwitchSaveAs(): void;
  startSaveAs(): void;
  /** 名前の入力を確定する。名前が空なら false（入力はそのまま） */
  submitName(name: string): boolean;
  /** 確認・名前の入力をやめる */
  cancel(): void;
  duplicate(id: string): void;
  remove(id: string): void;
  exportConfig(id: string): Promise<void>;
  importConfig(): Promise<void>;
  clearNotice(): void;
}

export interface ConfigManagerOptions {
  config: ConfigStore;
  names: ConfigManagerNames;
  io?: ConfigFileIo;
  onError?: (error: unknown) => void;
}

export function createConfigManager(options: ConfigManagerOptions): ConfigManager {
  const { config, names } = options;
  const io = options.io ?? tauriConfigFileIo;
  const onError = options.onError ?? ((error: unknown) => console.error(error));
  const notice = shallowRef<ConfigNotice | null>(null);
  const pendingSwitch = shallowRef<{ id: string } | null>(null);
  const nameForm = shallowRef<NameForm | null>(null);

  function activeName(): string {
    return config.activeConfig.value?.name ?? "";
  }

  function cancel(): void {
    pendingSwitch.value = null;
    nameForm.value = null;
  }

  function requestSwitch(id: string): SwitchResult {
    notice.value = null;
    nameForm.value = null;
    const result = config.switchConfig(id);
    pendingSwitch.value = result === "needsConfirm" ? { id } : null;
    return result;
  }

  function resolveSwitch(action: "overwrite" | "discard"): void {
    const pending = pendingSwitch.value;
    if (!pending) return;
    config.switchConfig(pending.id, { action });
    cancel();
  }

  function submitName(name: string): boolean {
    const form = nameForm.value;
    if (!form || normalizeConfigName(name) === null) return false;
    if (form.purpose === "saveAs") {
      config.saveAs(name);
    } else {
      const pending = pendingSwitch.value;
      if (pending) config.switchConfig(pending.id, { action: "saveAs", name });
    }
    cancel();
    return true;
  }

  return {
    notice,
    pendingSwitch,
    nameForm,
    requestSwitch,
    resolveSwitch,
    startSwitchSaveAs() {
      if (!pendingSwitch.value) return;
      nameForm.value = { purpose: "switchSaveAs", initial: names.copy(activeName()) };
    },
    startSaveAs() {
      notice.value = null;
      pendingSwitch.value = null;
      nameForm.value = { purpose: "saveAs", initial: names.copy(activeName()) };
    },
    submitName,
    cancel,
    duplicate(id) {
      const source = findSavedConfig(config.state.value, id);
      if (source) config.duplicateConfig(id, names.copy(source.name));
    },
    remove(id) {
      config.removeConfig(id);
    },
    async exportConfig(id) {
      const saved = findSavedConfig(config.state.value, id);
      if (!saved) return;
      notice.value = null;
      try {
        const result = await exportConfigFile(saved, io, {
          filterName: names.filterName(),
          fallbackFileName: names.fallbackFileName(),
        });
        if (result === "exported") notice.value = { kind: "exported", name: saved.name };
      } catch (error) {
        onError(error);
        notice.value = { kind: "export_failed" };
      }
    },
    async importConfig() {
      notice.value = null;
      try {
        const saved = await readConfigFile(io, { filterName: names.filterName() });
        if (!saved) return;
        if (config.importConfig(saved) === null) throw new Error("imported config has no name");
        notice.value = { kind: "imported", name: normalizeConfigName(saved.name) ?? saved.name };
      } catch (error) {
        onError(error);
        notice.value = { kind: "import_failed" };
      }
    },
    clearNotice() {
      notice.value = null;
    },
  };
}
