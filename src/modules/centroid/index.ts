// 重心と変化量のモジュール定義。スペクトルの重心の推移を線で、フラックスを棒で、流れる向きに描く。
// 種類ごとの設定項目はない（流れる速さは共通の項目）。初期状態では無効（既定の配置・自動整列には入らない）。

import { SectionId } from "../../frame_client";
import type { ModuleDefinition } from "../types";
import { createCentroidRenderer } from "./centroid_renderer";

export const centroidModule: ModuleDefinition<"centroid"> = {
  kind: "centroid",
  labelKey: "modules.centroid",
  // 細長い枠に向く
  shape: "long",
  // 履歴が左へ流れる（新しい列が右端）
  baseDirection: "left",
  flows: true,
  // 受信側が、このセクションを重心の履歴（histories.centroid）に積む
  sections: [SectionId.Centroid],
  defaultOptions: { speed: 1 },
  inspectorFields: [],
  defaultInstances: [{ enabled: false }],
  createRenderer: createCentroidRenderer,
};
