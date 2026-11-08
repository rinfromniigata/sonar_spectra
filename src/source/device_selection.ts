// 入力源のデバイスの選択を、保存（構成のストアの source.deviceId）と Rust の select_output_device につなぐ。
// - restore：起動時、start_stream の前に呼ぶ。保存されたデバイスがあれば選んでおく（なければ何もしない＝既定のデバイス）
// - choose：設定パネルで選んだとき。保存してから切り替える。同じものなら何もしない（入力源を開き直さない）
// 切り替えの結果（Opening → Live、または Unavailable）は source-status で届く。

import type { ConfigStore } from "../config/config_store";
import { selectOutputDevice } from "./backend";

export interface DeviceSelection {
  restore(): Promise<void>;
  choose(deviceId: string | null): void;
}

type Select = (deviceId: string | null) => Promise<void>;

export function createDeviceSelection(
  config: Pick<ConfigStore, "deviceId" | "setDeviceId">,
  select: Select = selectOutputDevice,
  onError: (error: unknown) => void = (error) => console.error(error),
): DeviceSelection {
  return {
    async restore() {
      const saved = config.deviceId.value;
      if (saved === null) return;
      // 失敗しても続ける（start_stream は既定のデバイスか、Rust に残っている選択で始まる）
      await select(saved).catch(onError);
    },
    choose(deviceId) {
      if (deviceId === config.deviceId.value) return;
      config.setDeviceId(deviceId);
      select(deviceId).catch(onError);
    },
  };
}
