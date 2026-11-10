// 入力源の状態：Rust のイベント `source-status`（src-tauri/src/audio_source/mod.rs の StatusEvent）の型と、
// 画面に出す形への変換。T2-12 のタイトル帯のチップと、T2-13 の状態の表示（S01b〜S01d）が使う。

import type { ChipStatus } from "../components/ui/types";
import type { MessageKey } from "../i18n/use_t";

/** イベントの名前（Rust の audio_engine::SOURCE_STATUS_EVENT と同じ） */
export const SOURCE_STATUS_EVENT = "source-status";

/** 入力源が使えない理由 */
export type UnavailableReason = "notFound" | "disconnected" | "inUse" | "other";

/** 入力源の状態。Rust の `#[serde(tag = "state", rename_all = "camelCase")]` の形 */
export type SourceStatus =
  | { state: "opening" }
  | { state: "live" }
  | { state: "silent" }
  | { state: "unavailable"; reason: UnavailableReason };

export interface DeviceInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

/** イベントの中身。デバイスが決まっていない（見つからないなど）ときは device が null */
export interface SourceStatusEvent {
  status: SourceStatus;
  device: DeviceInfo | null;
}

/** 画面に重ねる状態の表示（S01b〜S01d）。none は何も重ねない */
export type OverlayMode = "none" | "silent" | "opening" | "unavailable";

/** 状態から、重ねる表示を決める。まだ状態が届いていない起動直後は、起動中（S01d）として扱う */
export function overlayMode(event: SourceStatusEvent | null): OverlayMode {
  switch (event?.status.state ?? "opening") {
    case "live":
      return "none";
    case "silent":
      return "silent";
    case "opening":
      return "opening";
    case "unavailable":
      return "unavailable";
  }
}

/** 画面の中央に出す表示（SPEC 11節のS01〔v5〕）。同時に当てはまっても、中央には1つだけ出す */
export interface CenterNotice {
  /** 「描画を開始できません」を出す */
  renderUnavailable: boolean;
  /** 入力源の状態の表示（StatusOverlay）を出す */
  overlay: boolean;
}

/**
 * 入力源の状態 × 描画の層の状態から、出す表示を決める。
 * - 描画を開始できないとき：無音（S01b）は描画を開始できない表示だけ。使えない（S01c）・開いている途中（S01d）は
 *   その表示だけ（描画を開始できない表示は出さない）
 * - 編集中は StatusOverlay を出さないので、描画を開始できないときはその表示を出す
 */
export function centerNotice(event: SourceStatusEvent | null, renderUnavailable: boolean, editing = false): CenterNotice {
  const mode = overlayMode(event);
  if (!renderUnavailable) return { renderUnavailable: false, overlay: !editing && mode !== "none" };
  const overlayWins = !editing && (mode === "unavailable" || mode === "opening");
  return { renderUnavailable: !overlayWins, overlay: overlayWins };
}

/** チップの表示：点の色（`status`）と、文言の辞書キー（デバイス名が要るときは `device` も） */
export interface ChipView {
  status: ChipStatus;
  messageKey: Extract<MessageKey, "source.chip_live" | "source.chip_silent" | "source.chip_unavailable" | "status.opening">;
  /** `source.chip_live` のプレースホルダに入れるデバイス名。要らないときは null */
  device: string | null;
}

/**
 * 状態からチップの表示を決める。まだ状態が届いていないとき（起動直後）は「起動中」とする。
 * 起動中・切り替え中でデバイスが分かっていれば、デバイス名つきで点だけ消灯の色にする（モックの S01d）
 */
export function chipView(event: SourceStatusEvent | null): ChipView {
  const state = event?.status.state ?? "opening";
  const device = event?.device?.name ?? null;
  switch (state) {
    case "live":
      return device === null
        ? { status: "live", messageKey: "status.opening", device: null }
        : { status: "live", messageKey: "source.chip_live", device };
    case "silent":
      return { status: "silent", messageKey: "source.chip_silent", device: null };
    case "unavailable":
      return { status: "unavailable", messageKey: "source.chip_unavailable", device: null };
    case "opening":
      return device === null
        ? { status: "silent", messageKey: "status.opening", device: null }
        : { status: "silent", messageKey: "source.chip_live", device };
  }
}
