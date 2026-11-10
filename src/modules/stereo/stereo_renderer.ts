// 位相の描画：リサージュ（線＋点描）と周波数別の定位（モーションブラー）、下端の相関のバー
// （モックの drawStereo に合わせる）。位相は方向を持たない。
//
// - 残光：前の回の絵を消さず、地の色を薄く重ねて残す（ShapeSink.trail。描画の層が枠の画像に残す）。
//   重ねる濃さは経過時間に直す
// - リサージュ：外周の円と L・R の軸の上に、直近 20ms の点列を古い点ほど薄い線でつなぎ、点描を重ねる
// - 周波数別の定位：縦が周波数（下が低域、対数）、横が左右の位置。帯域を下から線でつなぎ、強さに応じた大きさ・色の
//   点を打つ。モーションブラーでは、前の回から動いた帯域に、動いた道筋の尾（前の位置で透明、今の位置で濃い）を引く
// - 図形は描画の層（ShapeSink）へ出し、発光は図形の発光の値で描画の層がつける（imple 4.2）。L・R の記号は文字の層に描く
//   （文字の層は残光を持たないので、毎回消して描く。消さずに重ね続けた移行前の見え方と同じく、濃さは一定）

import { LISSAJOUS_POINTS, PAN_BANDS, readStereo, type AnalysisFrame, type StereoValues } from "../../frame_client";
import type { StereoOptions } from "../options";
import type { Geometry, ModuleRenderer, PaletteColors, RenderContext, ShapeSink } from "../types";
import {
  BLUR_MIN_DX,
  DOT_STEP,
  PAN_HOT_LEVEL,
  TRAIL_ALPHA_LISSAJOUS,
  TRAIL_ALPHA_PAN,
  TRAIL_ALPHA_PAN_BLUR,
  blurAlpha,
  correlationBar,
  correlationX,
  dotAlpha,
  dotStyle,
  lissajousLayout,
  panDotSize,
  panLayout,
  panLevel,
  panPoint,
  project,
  segmentGroups,
  smoothCorrelation,
  trailAlpha,
} from "./stereo_math";

const CIRCLE_SEGMENTS = 64;
/** L・R の軸（斜めの2本）と、中央の縦の軸の端（平面上の座標） */
const AXES: readonly [number, number, number, number][] = [
  [-Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2, -Math.SQRT1_2, Math.SQRT1_2],
  [0, -1, 0, 1],
];
const TRAIL_LINE_WIDTH = 1.1;
const TRAIL_GLOW = 6;

const PAN_GRID_LEVELS = [0.25, 0.5, 0.75] as const;
const PAN_LINE_ALPHA = 0.7;
const PAN_LINE_WIDTH = 1.1;
const PAN_LINE_GLOW = 6;
const PAN_DOT_GLOW = 5;
const BLUR_PREVIOUS_ALPHA = 0.22;
const BLUR_GLOW = 6;
/** 尾の色の移り変わり：前の位置で透明、今の位置でそのまま */
const TAIL_FADES = [0, 1] as const;

const CORRELATION_MARK_GLOW = 6;

export function createStereoRenderer({ ctx }: RenderContext): ModuleRenderer<StereoOptions> {
  let width = 0;
  let height = 0;
  /** 表示している相関（ならした値）。まだなければ null */
  let correlation: number | null = null;
  // 外周の円と、軸の点（画面の座標。大きさが変わったときだけ作り直す）
  let circle = new Float32Array(0);
  let axes: Float32Array[] = [];
  // リサージュの点（x, y を交互に）と、点描の四角・不透明度
  const lissajous = new Float32Array(LISSAJOUS_POINTS * 2);
  const dotCount = Math.ceil(LISSAJOUS_POINTS / DOT_STEP);
  const dotRects = new Float32Array(dotCount * 4);
  const coreRects = new Float32Array(dotCount * 4);
  const dotAlphas = new Float32Array(dotCount);
  for (let k = 0; k < dotCount; k++) dotAlphas[k] = dotAlpha(k * DOT_STEP, LISSAJOUS_POINTS);
  // 周波数別の定位の点と強さ、前の回の横の位置、点の並び（x, y を交互に）
  const px = new Float32Array(PAN_BANDS);
  const py = new Float32Array(PAN_BANDS);
  const plevel = new Float32Array(PAN_BANDS);
  const prevX = new Float32Array(PAN_BANDS);
  const panPoints = new Float32Array(PAN_BANDS * 2);
  const tail = new Float32Array(4);
  const rect = new Float32Array(4);
  let hasPrevious = false;

  function drawLissajous(shapes: ShapeSink, values: StereoValues | null, options: StereoOptions, colors: PaletteColors): void {
    const layout = lissajousLayout(width, height);

    // 外周の円と、L・R の軸（軸は1本ずつ）
    shapes.polyline(circle, { color: colors.line, width: 1, closed: true });
    for (const axis of axes) shapes.polyline(axis, { color: colors.grid, width: 1 });

    if (!values) return;
    const n = LISSAJOUS_POINTS;
    for (let i = 0; i < n; i++) {
      const [x, y] = project(layout, values.x[i], values.y[i]);
      lissajous[i * 2] = x;
      lissajous[i * 2 + 1] = y;
    }

    // 点列の線：古い点ほど薄く。不透明度の近い線分をまとめて描く（全部で1回の発光）
    for (const group of segmentGroups(n)) {
      shapes.polyline(lissajous.subarray((group.start - 1) * 2, group.end * 2), {
        color: colors.accent,
        alpha: group.alpha,
        width: TRAIL_LINE_WIDTH,
        glow: TRAIL_GLOW,
      });
    }

    // 点描（大きく・明るく・両方。なしでは描かない）。明るい芯は発光させない
    const style = dotStyle(options.dots);
    if (!style) return;
    const half = style.size / 2;
    const core = Math.max(1, style.size * 0.55);
    for (let i = 0, k = 0; i < n; i += DOT_STEP, k++) {
      const x = lissajous[i * 2];
      const y = lissajous[i * 2 + 1];
      dotRects.set([x - half, y - half, style.size, style.size], k * 4);
      coreRects.set([x - core / 2, y - core / 2, core, core], k * 4);
    }
    shapes.rects(dotRects, { color: colors.accent, glow: style.glow }, dotAlphas);
    if (style.bright) shapes.rects(coreRects, { color: colors.text }, dotAlphas);
  }

  function drawPan(shapes: ShapeSink, values: StereoValues | null, options: StereoOptions, colors: PaletteColors): void {
    const layout = panLayout(width, height);
    const { top, bottom, cx, half } = layout;

    // 中央の縦線、周波数の目安の横線、左右の端（太さ1の線と同じ位置を、1ピクセル幅の四角で塗る）
    const grid: number[] = [cx, top, 1, bottom - top];
    for (const f of PAN_GRID_LEVELS) grid.push(cx - half, bottom - f * (bottom - top) - 0.5, 2 * half, 1);
    grid.push(cx - half - 0.5, top, 1, bottom - top, cx + half - 0.5, top, 1, bottom - top);
    shapes.rects(grid, { color: colors.grid });

    // 左右の記号（辞書は通さない）
    ctx.font = `${Math.max(8, Math.min(10, width / 8))}px ${colors.fontNumeric}`;
    ctx.fillStyle = colors.textMuted;
    ctx.fillText("L", cx - half + 2, height - 2);
    ctx.fillText("R", cx + half - 8, height - 2);

    if (!values) {
      hasPrevious = false;
      return;
    }
    for (let i = 0; i < PAN_BANDS; i++) {
      const level = panLevel(values.panLevel[i], i);
      const [x, y] = panPoint(layout, i, values.pan[i], level);
      px[i] = x;
      py[i] = y;
      plevel[i] = level;
    }

    // モーションブラー：前の回の線を薄く残し、動いた帯域に、動いた道筋の尾を引く。
    // 尾の発光は強調色（移行前の描き方の shadowColor と同じ）、尾そのものは強さで主色か強調色。
    // 発光だけの尾（強調色）を先に全部出してから、尾そのものを出す（発光は1回）
    if (options.blur && hasPrevious) {
      for (let i = 0; i < PAN_BANDS; i++) {
        panPoints[i * 2] = prevX[i];
        panPoints[i * 2 + 1] = py[i];
      }
      shapes.polyline(panPoints, { color: colors.accent, alpha: BLUR_PREVIOUS_ALPHA, width: 1 });
      const tails = (glowOnly: boolean) => {
        for (let i = 0; i < PAN_BANDS; i++) {
          if (Math.abs(px[i] - prevX[i]) < BLUR_MIN_DX) continue;
          tail.set([prevX[i], py[i], px[i], py[i]]);
          const color = glowOnly || plevel[i] > PAN_HOT_LEVEL ? colors.accent : colors.main;
          const style = { color, alpha: blurAlpha(px[i] - prevX[i]), width: 0.8 + plevel[i] * 2.2 };
          shapes.polyline(tail, glowOnly ? { ...style, glow: BLUR_GLOW, glowOnly: true } : style, TAIL_FADES);
        }
      };
      tails(true);
      tails(false);
    }
    prevX.set(px);
    hasPrevious = true;

    // 帯域を下から順につなぐ線と、強さに応じた大きさ・色の点（点は帯域の順に重ねる）
    for (let i = 0; i < PAN_BANDS; i++) {
      panPoints[i * 2] = px[i];
      panPoints[i * 2 + 1] = py[i];
    }
    shapes.polyline(panPoints, { color: colors.accent, alpha: PAN_LINE_ALPHA, width: PAN_LINE_WIDTH, glow: PAN_LINE_GLOW });
    for (let i = 0; i < PAN_BANDS; i++) {
      const size = panDotSize(plevel[i]);
      rect.set([px[i] - size / 2, py[i] - size / 2, size, size]);
      shapes.rects(rect, {
        color: plevel[i] > PAN_HOT_LEVEL ? colors.accent : colors.main,
        alpha: 0.45 + 0.55 * plevel[i],
        glow: PAN_DOT_GLOW,
      });
    }
  }

  /** 下端の相関のバー（左端が −1、中央が 0、右端が 1） */
  function drawCorrelation(shapes: ShapeSink, colors: PaletteColors): void {
    const bar = correlationBar(width, height);
    shapes.rects([bar.x, bar.y, bar.width, 2], { color: colors.grid });
    shapes.rects([correlationX(width, height, correlation ?? 0) - 2, bar.y - 3, 4, 8], { color: colors.sub, glow: CORRELATION_MARK_GLOW });
  }

  return {
    resize(geometry: Geometry) {
      width = geometry.width;
      height = geometry.height;
      hasPrevious = false;
      const layout = lissajousLayout(width, height);
      circle = new Float32Array(CIRCLE_SEGMENTS * 2);
      for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
        const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
        const [x, y] = project(layout, Math.cos(a), Math.sin(a));
        circle[i * 2] = x;
        circle[i * 2 + 1] = y;
      }
      axes = AXES.map(([x1, y1, x2, y2]) => Float32Array.from([...project(layout, x1, y1), ...project(layout, x2, y2)]));
    },

    draw(frame: AnalysisFrame | null, _histories, options, colors, dt, out) {
      if (width <= 0 || height <= 0) return;
      const values = frame ? readStereo(frame) : null;
      correlation = smoothCorrelation(correlation, values ? values.correlation : 0, dt);
      const pan = options.mode === "pan";
      if (!pan) hasPrevious = false;

      const { shapes } = out;
      // 残光：前の回の絵に、地の色を薄く重ねる
      shapes.trail(colors.bg, trailAlpha(pan ? (options.blur ? TRAIL_ALPHA_PAN_BLUR : TRAIL_ALPHA_PAN) : TRAIL_ALPHA_LISSAJOUS, dt));
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      if (pan) drawPan(shapes, values, options, colors);
      else drawLissajous(shapes, values, options, colors);
      ctx.restore();
      drawCorrelation(shapes, colors);
    },

    dispose() {
      correlation = null;
      hasPrevious = false;
    },
  };
}
