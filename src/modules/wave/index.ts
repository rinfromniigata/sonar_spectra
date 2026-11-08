// 波形のモジュール定義。左に音量の履歴、右に今の波形を描く。
// インスタンスの設定に出す項目（履歴の色・チャンネル・今の波形・境目）はここに記述する（流れる速さは共通の項目）。
// 並びはモックのインスペクターと同じ。境目は、今の波形を表示するときだけ出す。

import { SectionId } from "../../frame_client";
import type { ModuleDefinition } from "../types";
import { createWaveRenderer } from "./wave_renderer";

export const waveModule: ModuleDefinition<"wave"> = {
  kind: "wave",
  labelKey: "modules.waveform",
  shape: "long",
  // 履歴が左へ流れる
  baseDirection: "left",
  flows: true,
  sections: [SectionId.Waveform],
  // imple 5.1 の既定値
  defaultOptions: { channel: "stereo", showNow: true, split: 72, histColor: "solid", speed: 1 },
  inspectorFields: [
    {
      type: "choice",
      key: "histColor",
      labelKey: "instance.waveform.history_color",
      choices: [
        { value: "solid", labelKey: "instance.waveform.history_color_solid" },
        { value: "bands", labelKey: "instance.waveform.history_color_bands" },
      ],
    },
    {
      type: "choice",
      key: "channel",
      labelKey: "instance.waveform.channel",
      choices: [
        { value: "stereo", labelKey: "instance.waveform.channel_stereo", noteKey: "instance.waveform.channel_note_stereo" },
        { value: "mono", labelKey: "instance.waveform.channel_mono", noteKey: "instance.waveform.channel_note_mono" },
      ],
    },
    { type: "switch", key: "showNow", labelKey: "instance.waveform.show_now" },
    {
      type: "slider",
      key: "split",
      labelKey: "instance.waveform.split",
      // 範囲はモックのスライダーと、描画側の収め方（wave_math の SPLIT_MIN・SPLIT_MAX）に合わせる
      min: 10,
      max: 90,
      step: 1,
      format: "percent",
      noteKey: "instance.waveform.split_note",
      visibleWhen: { key: "showNow", equals: true },
    },
  ],
  defaultInstances: [{ enabled: true }],
  createRenderer: createWaveRenderer,
};
