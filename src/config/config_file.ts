// 構成ファイルの書き出し・読み込み（imple 3.4・5.2 の12・13）。
// - 形式：{ format: "sonar_spectra.config", schema: 2, config: SavedConfig }（Rust の settings_store/config_file.rs と同じ）
// - 書き出し：保存ダイアログで選んだ場所に、tauri-plugin-fs で書く。state.json は変えない
// - 読み込み：開くダイアログで選んだファイルを tauri-plugin-fs で読み、Rust の validate_config_file で確かめる
//   （古い schema の移行も Rust）。一覧に足すのは呼び出し側（構成のストアの importConfig）
// - fs の権限には場所を書いていない。ダイアログで選んだファイルだけが、その都度読み書きを許される
//   （tauri-plugin-dialog が選んだパスを fs の範囲に足す。src-tauri/capabilities/default.json）
// - ウィンドウの位置と入力源のデバイスは構成に含まれないので、ファイルにも入らない

import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { configOf } from "./saved_configs";
import { STATE_SCHEMA, type SavedConfig } from "./types";

export const CONFIG_FORMAT = "sonar_spectra.config";
export const CONFIG_FILE_EXTENSION = "json";

/** 構成ファイルの中身 */
export interface ConfigFile {
  format: typeof CONFIG_FORMAT;
  schema: typeof STATE_SCHEMA;
  config: SavedConfig;
}

/** 書き出すファイルの本文（読みやすいよう字下げし、末尾に改行） */
export function buildConfigFile(saved: SavedConfig): string {
  const file: ConfigFile = {
    format: CONFIG_FORMAT,
    schema: STATE_SCHEMA,
    config: { id: saved.id, name: saved.name, savedAt: saved.savedAt, ...configOf(saved) },
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Windows のファイル名に使えない文字（制御文字を含む） */
const UNSAFE_FILE_CHARS = /[<>:"/\\|?*\u0000-\u001f]/g;

/** 構成の名前から、保存ダイアログに最初に出すファイル名を作る（使えない文字は "_"） */
export function configFileName(name: string, fallback: string): string {
  const base = name.replace(UNSAFE_FILE_CHARS, "_").replace(/[. ]+$/, "").trim();
  return `${base === "" ? fallback : base}.${CONFIG_FILE_EXTENSION}`;
}

/** ダイアログ・ファイル・検証の呼び出し口（テストで差し替える） */
export interface ConfigFileIo {
  /** 保存ダイアログ。選ばなければ null */
  chooseSavePath(defaultName: string, filterName: string): Promise<string | null>;
  /** 開くダイアログ。選ばなければ null */
  chooseOpenPath(filterName: string): Promise<string | null>;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  /** Rust の validate_config_file。形式の違う・壊れたファイルは失敗する */
  validate(text: string): Promise<SavedConfig>;
}

const filters = (name: string) => [{ name, extensions: [CONFIG_FILE_EXTENSION] }];

/** アプリで使う呼び出し口（Tauri のプラグインとコマンド） */
export const tauriConfigFileIo: ConfigFileIo = {
  chooseSavePath: (defaultName, filterName) => save({ defaultPath: defaultName, filters: filters(filterName) }),
  chooseOpenPath: async (filterName) => {
    const picked = await open({ multiple: false, directory: false, filters: filters(filterName) });
    return typeof picked === "string" ? picked : null;
  },
  readText: (path) => readTextFile(path),
  writeText: (path, text) => writeTextFile(path, text),
  validate: (text) => invoke<SavedConfig>("validate_config_file", { text }),
};

export interface ConfigFileLabels {
  /** ダイアログのファイルの種類の名前（辞書） */
  filterName: string;
  /** 名前からファイル名を作れないときのファイル名（辞書） */
  fallbackFileName: string;
}

/** 書き出す。選ばなければ "cancelled"。書けなければ失敗する */
export async function exportConfigFile(saved: SavedConfig, io: ConfigFileIo, labels: ConfigFileLabels): Promise<"exported" | "cancelled"> {
  const path = await io.chooseSavePath(configFileName(saved.name, labels.fallbackFileName), labels.filterName);
  if (path === null) return "cancelled";
  await io.writeText(path, buildConfigFile(saved));
  return "exported";
}

/** 読み込んで確かめる。選ばなければ null。読めない・形式が違えば失敗する */
export async function readConfigFile(io: ConfigFileIo, labels: Pick<ConfigFileLabels, "filterName">): Promise<SavedConfig | null> {
  const path = await io.chooseOpenPath(labels.filterName);
  if (path === null) return null;
  return io.validate(await io.readText(path));
}
