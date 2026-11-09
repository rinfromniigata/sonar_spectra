// クロマのモジュール定義。解析のクロマ（音名ごとの強さ・今のコード・推定したキー）を読み、音名の円環で描く。
// 設定項目はない。初期状態では無効（既定の配置・自動整列には入らない）。

import { SectionId } from "../../frame_client";
import type { ModuleDefinition } from "../types";
import { createChromaRenderer } from "./chroma_renderer";

export const chromaModule: ModuleDefinition<"chroma"> = {
  kind: "chroma",
  labelKey: "modules.chroma",
  // 正方形に近い枠に向く。方向は持たない
  shape: "compact",
  baseDirection: null,
  flows: false,
  sections: [SectionId.Chroma],
  defaultOptions: {},
  inspectorFields: [],
  defaultInstances: [{ enabled: false }],
  createRenderer: createChromaRenderer,
};
