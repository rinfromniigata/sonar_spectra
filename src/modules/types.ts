// モジュールの定義と描画のインターフェース（imple 4.2）。
// モジュールの種類ごとに「解析結果のどこを読むか・どう描くか・どんな設定を持つか」を1組にまとめ、
// レジストリに登録する。配置・設定パネル・レイアウト編集は、モジュールの中身を知らない。

import type { AnalysisFrame, Histories, SectionId } from "../frame_client";
import type { MessageKey, Translate } from "../i18n/use_t";
import type { CanvasColors } from "../theme/canvas_colors";
import type { Direction, ModuleKind, ModuleOptions, Shape } from "./options";
import type { StreamImage } from "./stream_image";

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

/** 描画の座標系（既定の向き、CSS ピクセル）の四角 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 色の移り変わりの1点：offset（0〜1）の位置で color（CSS の色。"transparent" も使える） */
export interface GradientStop {
  offset: number;
  color: string;
}

/**
 * 色の移り変わり（Canvas 2D の createLinearGradient と、中心が同じ2つの円の createRadialGradient と同じ意味）。
 * 座標は描画の座標系。点と点の間は、不透明度で掛けない値のまま直線で移る（Canvas 2D と同じ。transparent へは黒くなりながら消える）。
 * 端より外は端の色。点は MAX_GRADIENT_STOPS 個まで
 */
export type Gradient =
  /** (x0, y0) が offset 0、(x1, y1) が offset 1 の直線の向き */
  | { kind: "linear"; x0: number; y0: number; x1: number; y1: number; stops: readonly GradientStop[] }
  /** 中心 (x, y) からの距離が r0 で offset 0、r1 で offset 1 */
  | { kind: "radial"; x: number; y: number; r0: number; r1: number; stops: readonly GradientStop[] };

/** 色の移り変わりに置ける点の数の上限（描画の層のシェーダーの都合） */
export const MAX_GRADIENT_STOPS = 4;

/** 塗りの見た目 */
export interface FillStyle {
  /** CSS の色（パレットやトークンから読んだ値）か、色の移り変わり */
  color: string | Gradient;
  /** 不透明度（0〜1。省略は 1） */
  alpha?: number;
  /** 発光の値（shadowBlur と同じ意味。0 か省略は発光なし）。発光は描画の層がまとめてつける */
  glow?: number;
  /**
   * 発光だけを敷き、図形そのものは描かない（発光の色を図形の色と変えたいときに、発光用の色で同じ図形を先に出す）。
   * 発光の値が 0 なら何も描かない
   */
  glowOnly?: boolean;
}

/** 線の見た目 */
export interface StrokeStyle extends FillStyle {
  /** 太さ（CSS ピクセル） */
  width: number;
  /** 終点と始点をつなぐ（閉じた線） */
  closed?: boolean;
}

/**
 * 文字の発光の見た目。文字そのものは文字の層（Canvas 2D）に描き、発光だけを描画の層が敷く。
 * font・align・baseline・maxWidth は、文字の層で同じ文字を描くときの font・textAlign・textBaseline・fillText の maxWidth と同じ値にする
 */
export interface TextGlowStyle {
  /** Canvas 2D の font と同じ書き方（大きさは CSS ピクセル） */
  font: string;
  align: CanvasTextAlign;
  baseline: CanvasTextBaseline;
  /** fillText の maxWidth（これより広い文字は横に縮める）。省略は縮めない */
  maxWidth?: number;
  /** 発光の色（CSS の色） */
  color: string;
  /** 不透明度（0〜1。省略は 1） */
  alpha?: number;
  /** 発光の値（shadowBlur と同じ意味。0 以下なら何も描かない） */
  glow: number;
}

/**
 * 図形の受け口（imple 4.2）。モジュールは描くもの（形・色・発光）をここへ出すだけで、WebGL を直接触らない。
 * 座標はすべて描画の座標系（既定の向き、CSS ピクセル）。点の並びは x, y の順に交互に並べる。
 * 呼んだ順に重なる（後の図形が上）
 */
export interface ShapeSink {
  /**
   * 折れ線（端は切りっぱなし、継ぎ目は角）。fades は点ごとに、色ごと透明（transparent。透明な黒）へ近づける割合
   * （1 でそのまま、0 で透明。点の間はなめらかに移る。Canvas 2D で transparent との間のグラデーションを当てた線と同じ）
   */
  polyline(points: ArrayLike<number>, style: StrokeStyle, fades?: ArrayLike<number>): void;
  /** 塗りの帯：xs の各位置で top〜bottom を塗り、隣の位置とつなぐ（top と bottom が入れ替わってもよい） */
  band(xs: ArrayLike<number>, top: ArrayLike<number>, bottom: ArrayLike<number>, style: FillStyle): void;
  /**
   * 塗りの多角形（閉じた形）。center（省略は点の平均）から見て星形の形に限る（円形の塗りなど）
   */
  polygon(points: ArrayLike<number>, style: FillStyle, center?: readonly [number, number]): void;
  /** 円い点。radius は全部に同じ値か、点ごとの並び。alphas は点ごとの不透明度（style.alpha に掛ける） */
  points(points: ArrayLike<number>, radius: number | ArrayLike<number>, style: FillStyle, alphas?: ArrayLike<number>): void;
  /** 四角。x, y, 幅, 高さ の順に並べる（棒・1ピクセル幅の格子線など）。alphas は四角ごとの不透明度（style.alpha に掛ける） */
  rects(rects: ArrayLike<number>, style: FillStyle, alphas?: ArrayLike<number>): void;
  /** 流れる画像を dest に描く（画像の左端がいちばん古い列、右端が最新の列） */
  image(stream: StreamImage, dest: Rect, style?: { alpha?: number }): void;
  /**
   * 残光：この枠の前の回の絵（図形と発光）を消さずに残し、color を alpha の濃さで全体に重ねてから、この回の図形を描く
   * （毎回消さずに地の色を薄く重ねる Canvas 2D の描き方と同じ）。1回の描画で、図形より先に1度だけ呼ぶ。
   * 呼ばない回は、前の絵を残さない
   */
  trail(color: string, alpha: number): void;
  /**
   * 文字の発光だけを敷く（文字の層で (x, y) に同じ style で描く文字に shadowBlur でつけていた影と同じ見た目。
   * 文字そのものは描かないので、モジュールが文字の層に描く）
   */
  textGlow(text: string, x: number, y: number, style: TextGlowStyle): void;
}

/** 1回分の描くものの出し先（imple 4.2） */
export interface DrawOutput {
  /** 図形（描画の層が WebGL2 で描く） */
  shapes: ShapeSink;
  /** 文字の層（枠ごとの Canvas 2D。図形の上に重なる。座標系は既定の向きに回してある） */
  text: CanvasRenderingContext2D;
}

export interface RenderContext {
  /** 文字の層（DrawOutput.text と同じ Canvas 2D） */
  ctx: CanvasRenderingContext2D;
  /** 辞書から文言を引く。Canvas に文言を描くモジュール（LOUD の単位とピーク）が、描画のたびに呼ぶ */
  translate?: Translate;
}

export interface ModuleRenderer<O> {
  /** 枠の大きさ・向き・DPR が変わったとき。キャンバスは消去済み */
  resize(geometry: Geometry): void;
  /**
   * 1回分を描く。座標系は既定の向きに回してあり、(0, 0)〜(width, height) に描けばよい。
   * 図形は out.shapes へ、文字は out.text へ出す。
   * 文字の層は消されないので、文字を描くモジュールは毎回消してから描く。
   * frame はまだ届いていなければ null
   */
  draw(frame: AnalysisFrame | null, histories: Histories, options: O, colors: PaletteColors, dt: number, out: DrawOutput): void;
  dispose(): void;
}

/** 項目の共通部分 */
interface InspectorFieldBase<O> {
  /** 設定（options）のどの項目か */
  key: keyof O & string;
  labelKey: MessageKey;
  /** 別の項目が、この値のときだけ出す（例：「今の波形を表示」がオンのときだけ境目を出す） */
  visibleWhen?: { key: keyof O & string; equals: string | number | boolean };
}

/**
 * インスタンスの設定（S03）に出す項目。文言は辞書キーで書く。
 * - choice：選択肢から1つ選ぶ。選んでいる選択肢に noteKey があれば、注記として下に出す
 * - switch：オン／オフ
 * - slider：数値。format は表示の書式（percent は 0〜100 の値を「72%」と整形する）。
 *   noteKey の文言には、その項目の既定値を整形した {value} を渡す
 */
export type InspectorField<O> =
  | (InspectorFieldBase<O> & {
      type: "choice";
      choices: { value: string; labelKey: MessageKey; noteKey?: MessageKey }[];
    })
  | (InspectorFieldBase<O> & { type: "switch" })
  | (InspectorFieldBase<O> & {
      type: "slider";
      min: number;
      max: number;
      step: number;
      format?: "percent";
      noteKey?: MessageKey;
    });

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
