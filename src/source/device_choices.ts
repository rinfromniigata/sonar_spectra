// 設定パネル（S02）の出力デバイスのセレクトの選択肢。
// 先頭は「既定のデバイス」（deviceId が null。OSの既定の出力デバイスに追従する）で、分かれば今の既定のデバイスの名前を添える。
// 選んでいるデバイスが一覧にない（取り外した・一覧をまだ読めていない）ときは、末尾に「見つからないデバイス」として残す
// （セレクトの値が選択肢から外れて、別のデバイスを選んでいるように見えないように）。

import type { DeviceInfo } from "./source_status";

/** セレクトの値で「既定のデバイス」を表すもの（デバイスのIDは空にならない） */
export const DEFAULT_DEVICE_VALUE = "";

export type DeviceChoice =
  | { kind: "default"; value: typeof DEFAULT_DEVICE_VALUE; defaultName: string | null }
  | { kind: "device"; value: string; name: string }
  | { kind: "missing"; value: string };

export function deviceChoices(devices: readonly DeviceInfo[], selectedId: string | null): DeviceChoice[] {
  const defaultDevice = devices.find((d) => d.isDefault);
  const choices: DeviceChoice[] = [
    { kind: "default", value: DEFAULT_DEVICE_VALUE, defaultName: defaultDevice?.name ?? null },
    ...devices.map((d): DeviceChoice => ({ kind: "device", value: d.id, name: d.name })),
  ];
  if (selectedId !== null && !devices.some((d) => d.id === selectedId)) choices.push({ kind: "missing", value: selectedId });
  return choices;
}

/** セレクトの値と deviceId の変換 */
export function deviceIdFromValue(value: string): string | null {
  return value === DEFAULT_DEVICE_VALUE ? null : value;
}
