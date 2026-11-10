// 位相の描画：リサージュ（線＋点描）と周波数別の定位（モーションブラー）、下端の相関のバー
// （モックの drawStereo に合わせる）。位相は方向を持たない。
//
// - 残光：毎回キャンバスを消さず、地の色を薄く重ねて前の絵を残す。重ねる濃さは経過時間に直す
// - リサージュ：外周の円と L・R の軸の上に、直近 20ms の点列を古い点ほど薄い線でつなぎ、点描を重ねる
// - 周波数別の定位：縦が周波数（下が低域、対数）、横が左右の位置。帯域を下から線でつなぎ、強さに応じた大きさ・色の
//   点を打つ。モーションブラーでは、前の回から動いた帯域に、動いた道筋の尾を引く
// - 負荷（T9-1）：発光は発光の層（glow_layer）でまとめてつけ（点や尾を1つずつ光らせない）、折れ線は短い区間に分け、
//   縦横の目安の線は1ピクセル幅の四角で描く（canvas_helpers）。相関の印（四角1つ）は shadowBlur のまま

import { LISSAJOUS_POINTS, PAN_BANDS, readStereo, type AnalysisFrame, type StereoValues } from "../../frame_client";
import { setGlow, strokePolyline } from "../canvas_helpers";
import { createGlowLayer } from "../glow_layer";
import type { StereoOptions } from "../options";
import type { Geometry, ModuleRenderer, PaletteColors, RenderContext } from "../types";
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

const CORRELATION_MARK_GLOW = 6;

export function createStereoRenderer({ ctx, createBuffer }: RenderContext): ModuleRenderer<StereoOptions> {
  let width = 0;
  let height = 0;
  const glow = createGlowLayer(createBuffer);
  // 外周の円の点（画面の座標）
  const circleX = new Float32Array(CIRCLE_SEGMENTS + 1);
  const circleY = new Float32Array(CIRCLE_SEGMENTS + 1);
  // モーションブラーの尾の色（発光の回は強調色、そのままの回は強さで主色か強調色）
  const tailGlow: (CanvasGradient | null)[] = Array.from({ length: PAN_BANDS }, () => null);
  const tailSharp: (CanvasGradient | null)[] = Array.from({ length: PAN_BANDS }, () => null);
  /** 表示している相関（ならした値）。まだなければ null */
  let correlation: number | null = null;
  // リサージュの点（画面の座標）
  const lx = new Float32Array(LISSAJOUS_POINTS);
  const ly = new Float32Array(LISSAJOUS_POINTS);
  // 周波数別の定位の点（画面の座標）と強さ、前の回の点
  const px = new Float32Array(PAN_BANDS);
  const py = new Float32Array(PAN_BANDS);
  const plevel = new Float32Array(PAN_BANDS);
  const prevX = new Float32Array(PAN_BANDS);
  let hasPrevious = false;

  /** 点 from〜to の折れ線を、今の線の色・太さで描く（短い区間に分ける） */
  function polyline(c: CanvasRenderingContext2D, xs: Float32Array, ys: Float32Array, from: number, to: number): void {
    strokePolyline(
      c,
      to - from + 1,
      (i) => xs[from + i],
      (i) => ys[from + i],
    );
  }

  function drawLissajous(values: StereoValues | null, options: StereoOptions, colors: PaletteColors): void {
    const layout = lissajousLayout(width, height);

    // 外周の円と、L・R の軸（軸は1本ずつ描く。離れた線を1つのパスにすると重い）
    for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      const [x, y] = project(layout, Math.cos(a), Math.sin(a));
      circleX[i] = x;
      circleY[i] = y;
    }
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    polyline(ctx, circleX, circleY, 0, CIRCLE_SEGMENTS);
    ctx.strokeStyle = colors.grid;
    for (const [x1, y1, x2, y2] of AXES) {
      const [ax, ay] = project(layout, x1, y1);
      const [bx, by] = project(layout, x2, y2);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    if (!values) return;
    const n = LISSAJOUS_POINTS;
    for (let i = 0; i < n; i++) {
      const [x, y] = project(layout, values.x[i], values.y[i]);
      lx[i] = x;
      ly[i] = y;
    }

    // 点列の線：古い点ほど薄く。不透明度の近い線分をまとめて描く
    glow.draw(ctx, TRAIL_GLOW, (c) => {
      c.strokeStyle = colors.accent;
      c.lineWidth = TRAIL_LINE_WIDTH;
      for (const group of segmentGroups(n)) {
        c.globalAlpha = group.alpha;
        polyline(c, lx, ly, group.start - 1, group.end - 1);
      }
      c.globalAlpha = 1;
    });

    // 点描（大きく・明るく・両方。なしでは描かない）。明るい芯は発光させない
    const style = dotStyle(options.dots);
    if (style) {
      const half = style.size / 2;
      glow.draw(ctx, style.glow, (c) => {
        c.fillStyle = colors.accent;
        for (let i = 0; i < n; i += DOT_STEP) {
          c.globalAlpha = dotAlpha(i, n);
          c.fillRect(lx[i] - half, ly[i] - half, style.size, style.size);
        }
        c.globalAlpha = 1;
      });
      if (style.bright) {
        const core = Math.max(1, style.size * 0.55);
        ctx.fillStyle = colors.text;
        for (let i = 0; i < n; i += DOT_STEP) {
          ctx.globalAlpha = dotAlpha(i, n);
          ctx.fillRect(lx[i] - core / 2, ly[i] - core / 2, core, core);
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawPan(values: StereoValues | null, options: StereoOptions, colors: PaletteColors): void {
    const layout = panLayout(width, height);
    const { top, bottom, cx, half } = layout;

    // 中央の縦線、周波数の目安の横線、左右の端（太さ1の線と同じ位置を、1ピクセル幅の四角で塗る）
    ctx.fillStyle = colors.grid;
    ctx.fillRect(cx, top, 1, bottom - top);
    for (const f of PAN_GRID_LEVELS) {
      const y = bottom - f * (bottom - top);
      ctx.fillRect(cx - half, y - 0.5, 2 * half, 1);
    }
    ctx.fillRect(cx - half - 0.5, top, 1, bottom - top);
    ctx.fillRect(cx + half - 0.5, top, 1, bottom - top);

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
    // 尾の発光は強調色（元の描き方の shadowColor と同じ）、尾そのものは強さで主色か強調色
    if (options.blur && hasPrevious) {
      ctx.strokeStyle = colors.accent;
      ctx.globalAlpha = BLUR_PREVIOUS_ALPHA;
      ctx.lineWidth = 1;
      polyline(ctx, prevX, py, 0, PAN_BANDS - 1);
      ctx.globalAlpha = 1;
      let tails = 0;
      for (let i = 0; i < PAN_BANDS; i++) {
        tailGlow[i] = null;
        tailSharp[i] = null;
        if (Math.abs(px[i] - prevX[i]) < BLUR_MIN_DX) continue;
        const toward = (color: string) => {
          const gradient = ctx.createLinearGradient(prevX[i], py[i], px[i], py[i]);
          gradient.addColorStop(0, "transparent");
          gradient.addColorStop(1, color);
          return gradient;
        };
        tailGlow[i] = toward(colors.accent);
        tailSharp[i] = plevel[i] > PAN_HOT_LEVEL ? tailGlow[i] : toward(colors.main);
        tails++;
      }
      if (tails > 0) {
        glow.draw(ctx, BLUR_GLOW, (c, pass) => {
          const styles = pass === "glow" ? tailGlow : tailSharp;
          for (let i = 0; i < PAN_BANDS; i++) {
            const style = styles[i];
            if (!style) continue;
            c.strokeStyle = style;
            c.globalAlpha = blurAlpha(px[i] - prevX[i]);
            c.lineWidth = 0.8 + plevel[i] * 2.2;
            c.beginPath();
            c.moveTo(prevX[i], py[i]);
            c.lineTo(px[i], py[i]);
            c.stroke();
          }
          c.globalAlpha = 1;
        });
      }
    }
    prevX.set(px);
    hasPrevious = true;

    // 帯域を下から順につなぐ線と、強さに応じた大きさ・色の点
    glow.draw(ctx, PAN_LINE_GLOW, (c) => {
      c.strokeStyle = colors.accent;
      c.globalAlpha = PAN_LINE_ALPHA;
      c.lineWidth = PAN_LINE_WIDTH;
      polyline(c, px, py, 0, PAN_BANDS - 1);
      c.globalAlpha = 1;
    });
    glow.draw(ctx, PAN_DOT_GLOW, (c) => {
      for (let i = 0; i < PAN_BANDS; i++) {
        const size = panDotSize(plevel[i]);
        c.fillStyle = plevel[i] > PAN_HOT_LEVEL ? colors.accent : colors.main;
        c.globalAlpha = 0.45 + 0.55 * plevel[i];
        c.fillRect(px[i] - size / 2, py[i] - size / 2, size, size);
      }
      c.globalAlpha = 1;
    });
  }

  /** 下端の相関のバー（左端が −1、中央が 0、右端が 1） */
  function drawCorrelation(colors: PaletteColors): void {
    const bar = correlationBar(width, height);
    ctx.shadowBlur = 0;
    ctx.fillStyle = colors.grid;
    ctx.fillRect(bar.x, bar.y, bar.width, 2);
    ctx.fillStyle = colors.sub;
    setGlow(ctx, colors.sub, CORRELATION_MARK_GLOW);
    ctx.fillRect(correlationX(width, height, correlation ?? 0) - 2, bar.y - 3, 4, 8);
    ctx.shadowBlur = 0;
  }

  return {
    resize(geometry: Geometry) {
      width = geometry.width;
      height = geometry.height;
      hasPrevious = false;
      glow.resize(width, height, geometry.devicePixelRatio);
    },

    draw(frame: AnalysisFrame | null, _histories, options, colors, dt) {
      if (width <= 0 || height <= 0) return;
      const values = frame ? readStereo(frame) : null;
      correlation = smoothCorrelation(correlation, values ? values.correlation : 0, dt);
      const pan = options.mode === "pan";
      if (!pan) hasPrevious = false;

      ctx.save();
      // 残光：消さずに地の色を薄く重ねる
      ctx.shadowBlur = 0;
      ctx.fillStyle = colors.bg;
      ctx.globalAlpha = trailAlpha(pan ? (options.blur ? TRAIL_ALPHA_PAN_BLUR : TRAIL_ALPHA_PAN) : TRAIL_ALPHA_LISSAJOUS, dt);
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;

      if (pan) drawPan(values, options, colors);
      else drawLissajous(values, options, colors);
      drawCorrelation(colors);
      ctx.restore();
    },

    dispose() {
      correlation = null;
      hasPrevious = false;
      tailGlow.fill(null);
      tailSharp.fill(null);
      glow.dispose();
    },
  };
}
