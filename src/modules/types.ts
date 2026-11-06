// モジュールの定義と描画のインターフェース（imple 4.2）。
// モジュールの種類ごとに「解析結果のどこを読むか・どう描くか・どんな設定を持つか」を1組にまとめ、
// レジストリに登録する。配置・設定パネル・レイアウト編集は、モジュールの中身を知らない。

import type { AnalysisFrame, Histories, SectionId } from "../frame_client";
import type { MessageKey } from "../i18n/use_t";
import type { CanvasColors } from "../theme/canvas_colors";
import type { Direction, ModuleKind, ModuleOptions, Shape } from "./options";

/** 枠の大きさと向き。描画側は常に既定の向きで描けばよく、width・height はその向きでの大きさ */
export interface Geometry {
  /** 描画の座標系（既定の向き）での幅（CSS ピクセル） */
  width: number;
  /** 描画の座標系（既定の向き）での高さ（CSS ピクセル） */
  height: number;
  devicePixelRatio: number;
  /** 既定の向きから時計回りに何回 90° 回したか */
  quarterTurns: 0 | 1 | 2 | 3;
}

/** 描画に使う色（インスタンスの配色を当てた後の値。Canvas にそのまま渡せる） */
export interface PaletteColors {
  /** 主色（L・Mid・主な線） */
  main: string;
  /** 副色（R・Side） */
  sub: string;
  /** 強調色（ピーク・注意） */
  accent: string;
  bg: string;
  grid: string;
  line: string;
  text: string;
  textMuted: string;
  danger: string;
  /** 目盛りなどの数字の書体（Canvas の font に使う） */
  fontNumeric: string;
  theme: "dark" | "light";
}

/** 描画側が持つ、画面に出さない画像（流れるモジュールが、すでに描いた分をずらして使う） */
export interface OffscreenBuffer {
  /** 画面のキャンバスに `drawImage` できるもの。幅と高さは、デバイスピクセルで指定した値 */
  canvas: CanvasImageSource & { width: number; height: number };
  ctx: CanvasRenderingContext2D;
}

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  /** 画面に出さない画像を作る（幅と高さはデバイスピクセル）。省略すると、ブラウザのキャンバスで作る */
  createBuffer?: (width: number, height: number) => OffscreenBuffer;
}

/** ブラウザのキャンバスで、画面に出さない画像を作る */
export function createBrowserBuffer(width: number, height: number): OffscreenBuffer {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas context is not available");
  return { canvas, ctx };
}

export interface ModuleRenderer<O> {
  /** 枠の大きさ・向き・DPR が変わったとき。キャンバスは消去済み */
  resize(geometry: Geometry): void;
  /**
   * 1回分を描く。座標系は既定の向きに回してあり、(0, 0)〜(width, height) に描けばよい。
   * frame はまだ届いていなければ null
   */
  draw(frame: AnalysisFrame | null, histories: Histories, options: O, colors: PaletteColors, dt: number): void;
  dispose(): void;
}

/** インスタンスの設定（S03）に出す項目。文言は辞書キーで書く */
export type InspectorField<O> =
  | {
      type: "choice";
      key: keyof O & string;
      labelKey: MessageKey;
      choices: { value: string; labelKey: MessageKey; noteKey?: MessageKey }[];
    }
  | { type: "switch"; key: keyof O & string; labelKey: MessageKey }
  | { type: "slider"; key: keyof O & string; labelKey: MessageKey; min: number; max: number; step: number };

/** 既定の構成に置くインスタンス1つ分 */
export interface DefaultInstanceSpec<K extends ModuleKind> {
  enabled: boolean;
  /** 既定の配置で専用の位置を持つもの */
  slot?: "pan";
  /** 種類の既定値から変えるもの */
  options?: Partial<ModuleOptions[K]>;
}

export interface ModuleDefinition<K extends ModuleKind> {
  kind: K;
  /** 見出しの辞書キー */
  labelKey: MessageKey;
  shape: Shape;
  /** 既定の流れる方向。null は方向なし */
  baseDirection: Direction | null;
  /** 流れる速さの設定を持つか */
  flows: boolean;
  /** 必要な解析 */
  sections: SectionId[];
  defaultOptions: ModuleOptions[K];
  inspectorFields: InspectorField<ModuleOptions[K]>[];
  /** 既定の構成に置くインスタンス（並び順に作る。1つ目以外は、全種類の1つ目の後ろに並ぶ） */
  defaultInstances: DefaultInstanceSpec<K>[];
  createRenderer(context: RenderContext): ModuleRenderer<ModuleOptions[K]>;
}

/** 描画ループが ModuleFrame に渡す1回分の入力 */
export interface FrameDrawInput {
  frame: AnalysisFrame | null;
  histories: Histories;
  /** トークンから読んだ色（配色は ModuleFrame がインスタンスごとに当てる） */
  colors: CanvasColors;
  /** 前回の描画からの経過（秒） */
  dt: number;
}

/** 種類を問わないモジュールの定義 */
export type AnyModuleDefinition = { [K in ModuleKind]: ModuleDefinition<K> }[ModuleKind];
