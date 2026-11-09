// 保存済みの構成の操作（imple 5.2 の9・11・5.4）。状態（PersistedState）を受け取り、変えた状態を返す純粋関数。
// 変わらない・できないときは null を返す。
// - 名前を付けて保存：今の構成の写しを、新しい id・name・savedAt で末尾に足し、使用中にする。変更なしになる
// - 上書き：使用中の保存済み構成を、今の構成の写しで置き換える（savedAt を更新）。変更なしになる
// - 切り替え：今の構成を、選んだ保存済み構成の写しにし、使用中にする。変更なしになる
//   （変更があるときに上書き・別名で保存・破棄のどれにするかを確かめるのは、ストアの switchConfig）
// - 複製：保存済み構成の写しを、新しい id・name・savedAt で元のすぐ後ろに足す。使用中は変えない
// - 削除：使用中の構成は消せない。それ以外は一覧から消すだけで、今の構成は変えない
// - 読み込み：検証済みの構成を新しい id で末尾に足す。使用中は変えない（一覧から切り替えて使う）
// - 同じ名前は許し、id で区別する（imple 5.4）
// - 変更ありの判定：今の構成と、使用中の保存済み構成の中身（配置・モジュールの設定・自分で作った配色・テーマと表示）を比べる。
//   変えてから元に戻せば、変更なしに戻る

import type { Config, PersistedState, SavedConfig } from "./types";

/** 構成の名前の長さの上限（文字数） */
export const CONFIG_NAME_MAX_LENGTH = 40;

/** 名前の前後の空白を除き、長さを上限までにする。空なら null */
export function normalizeConfigName(text: string): string | null {
  const name = [...text.trim()].slice(0, CONFIG_NAME_MAX_LENGTH).join("").trim();
  return name === "" ? null : name;
}

/** 保存済み構成から、構成の中身（配置・自分で作った配色・テーマ・表示）だけを写して取り出す */
export function configOf(saved: Config): Config {
  return structuredClone({
    layout: saved.layout,
    customPalettes: saved.customPalettes,
    theme: saved.theme,
    display: saved.display,
  });
}

/**
 * キーの順序と undefined の項目によらない文字列にする（保存したファイルから読んだものと、画面で作ったものとで、
 * キーの並びが違っても同じ中身なら同じになるように）
 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 2つの構成の中身が同じか */
export function configsEqual(a: Config, b: Config): boolean {
  return canonical(configOf(a)) === canonical(configOf(b));
}

export function findSavedConfig(state: PersistedState, id: string): SavedConfig | undefined {
  return state.savedConfigs.find((c) => c.id === id);
}

/** 今の構成が、使用中の保存済み構成から変わっているか（使用中の構成がなければ、変わっているとみなす） */
export function isModified(state: Pick<PersistedState, "current" | "activeConfigId" | "savedConfigs">): boolean {
  const active = state.savedConfigs.find((c) => c.id === state.activeConfigId);
  return !active || !configsEqual(state.current, active);
}

/** 名前を付けて保存。名前が空なら null */
export function saveAs(state: PersistedState, name: string, id: string, now: Date): PersistedState | null {
  const normalized = normalizeConfigName(name);
  if (normalized === null) return null;
  const saved: SavedConfig = { ...configOf(state.current), id, name: normalized, savedAt: now.toISOString() };
  return { ...state, savedConfigs: [...state.savedConfigs, saved], activeConfigId: id, dirty: false };
}

/** 上書き。使用中の構成がなければ null */
export function overwrite(state: PersistedState, now: Date): PersistedState | null {
  const index = state.savedConfigs.findIndex((c) => c.id === state.activeConfigId);
  if (index < 0) return null;
  const active = state.savedConfigs[index];
  const savedConfigs = state.savedConfigs.slice();
  savedConfigs[index] = { ...configOf(state.current), id: active.id, name: active.name, savedAt: now.toISOString() };
  return { ...state, savedConfigs, dirty: false };
}

/** 切り替え（今の構成は捨てる）。ない構成なら null */
export function switchTo(state: PersistedState, id: string): PersistedState | null {
  const target = findSavedConfig(state, id);
  if (!target) return null;
  return { ...state, current: configOf(target), activeConfigId: id, dirty: false };
}

/** 複製。ない構成・空の名前なら null */
export function duplicate(state: PersistedState, sourceId: string, name: string, id: string, now: Date): PersistedState | null {
  const index = state.savedConfigs.findIndex((c) => c.id === sourceId);
  const normalized = normalizeConfigName(name);
  if (index < 0 || normalized === null) return null;
  const copy: SavedConfig = { ...configOf(state.savedConfigs[index]), id, name: normalized, savedAt: now.toISOString() };
  const savedConfigs = [...state.savedConfigs.slice(0, index + 1), copy, ...state.savedConfigs.slice(index + 1)];
  return { ...state, savedConfigs };
}

/**
 * 読み込んだ構成を、新しい id で末尾に足す（imple 5.2 の13）。名前と保存日はファイルのまま。使用中と今の構成は変えない。
 * 同じファイルを2回読み込めば2件になる（imple 5.4）。名前が空なら null
 */
export function importConfig(state: PersistedState, saved: SavedConfig, id: string): PersistedState | null {
  const name = normalizeConfigName(saved.name);
  if (name === null) return null;
  const added: SavedConfig = { ...configOf(saved), id, name, savedAt: saved.savedAt };
  return { ...state, savedConfigs: [...state.savedConfigs, added] };
}

/** 削除できるか（使用中でなく、一覧にある） */
export function canRemove(state: PersistedState, id: string): boolean {
  return id !== state.activeConfigId && findSavedConfig(state, id) !== undefined;
}

/** 削除。使用中・ない構成なら null */
export function remove(state: PersistedState, id: string): PersistedState | null {
  if (!canRemove(state, id)) return null;
  return { ...state, savedConfigs: state.savedConfigs.filter((c) => c.id !== id) };
}
