// 位相の描画：リサージュ（線＋点描）と周波数別の定位（モーションブラー）、下端の相関のバー
// （モックの drawStereo に合わせる）。位相は方向を持たない。
//
// - 残光：毎回キャンバスを消さず、地の色を薄く重ねて前の絵を残す。重ねる濃さは経過時間に直す
// - リサージュ：外周の円と L・R の軸の上に、直近 20ms の点列を古い点ほど薄い線でつなぎ、点描を重ねる
// - 周波数別の定位：縦が周波数（下が低域、対数）、横が左右の位置。帯域を下から線でつなぎ、強さに応じた大きさ・色の
//   点を打つ。モーションブラーでは、前の回から動いた帯域に、動いた道筋の尾を引く

import { LISSAJOUS_POINTS, PAN_BANDS, readStereo, type AnalysisFrame, type StereoValues } from "../../frame_client";
import { setGlow } from "../canvas_helpers";
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

export function createStereoRenderer({ ctx }: RenderContext): ModuleRenderer<StereoOptions> {
  let width = 0;
  let height = 0;
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

  function polyline(xs: Float32Array, ys: Float32Array, from: number, to: number): void {
    ctx.beginPath();
    ctx.moveTo(xs[from], ys[from]);
    for (let i = from + 1; i <= to; i++) ctx.lineTo(xs[i], ys[i]);
  }

  function drawLissajous(values: StereoValues | null, options: StereoOptions, colors: PaletteColors): void {
    const layout = lissajousLayout(width, height);

    // 外周の円と、L・R の軸
    ctx.beginPath();
    for (let i = 0; i <= CIRCLE_SEGMENTS; i++) {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      const [x, y] = project(layout, Math.cos(a), Math.sin(a));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = colors.line;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = colors.grid;
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of AXES) {
      const [ax, ay] = project(layout, x1, y1);
      const [bx, by] = project(layout, x2, y2);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();

    if (!values) return;
    const n = LISSAJOUS_POINTS;
    for (let i = 0; i < n; i++) {
      const [x, y] = project(layout, values.x[i], values.y[i]);
      lx[i] = x;
      ly[i] = y;
    }

    // 点列の線：古い点ほど薄く。不透明度の近い線分をまとめて描く（発光の描画の回数を抑えるため）
    setGlow(ctx, colors.accent, TRAIL_GLOW);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = TRAIL_LINE_WIDTH;
    for (const group of segmentGroups(n)) {
      polyline(lx, ly, group.start - 1, group.end - 1);
      ctx.globalAlpha = group.alpha;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    // 点描（大きく・明るく・両方。なしでは描かない）
    const style = dotStyle(options.dots);
    if (style) {
      const half = style.size / 2;
      const core = Math.max(1, style.size * 0.55);
      for (let i = 0; i < n; i += DOT_STEP) {
        ctx.globalAlpha = dotAlpha(i, n);
        setGlow(ctx, colors.accent, style.glow);
        ctx.fillStyle = colors.accent;
        ctx.fillRect(lx[i] - half, ly[i] - half, style.size, style.size);
        if (style.bright) {
          ctx.shadowBlur = 0;
          ctx.fillStyle = colors.text;
          ctx.fillRect(lx[i] - core / 2, ly[i] - core / 2, core, core);
        }
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
  }

  function drawPan(values: StereoValues | null, options: StereoOptions, colors: PaletteColors): void {
    const layout = panLayout(width, height);
    const { top, bottom, cx, half } = layout;

    // 中央の縦線、周波数の目安の横線、左右の端
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx + 0.5, top);
    ctx.lineTo(cx + 0.5, bottom);
    for (const f of PAN_GRID_LEVELS) {
      const y = bottom - f * (bottom - top);
      ctx.moveTo(cx - half, y);
      ctx.lineTo(cx + half, y);
    }
    ctx.moveTo(cx - half, top);
    ctx.lineTo(cx - half, bottom);
    ctx.moveTo(cx + half, top);
    ctx.lineTo(cx + half, bottom);
    ctx.stroke();

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

    // モーションブラー：前の回の線を薄く残し、動いた帯域に、動いた道筋の尾を引く
    if (options.blur && hasPrevious) {
      polyline(prevX, py, 0, PAN_BANDS - 1);
      ctx.strokeStyle = colors.accent;
      ctx.globalAlpha = BLUR_PREVIOUS_ALPHA;
      ctx.lineWidth = 1;
      ctx.stroke();
      setGlow(ctx, colors.accent, BLUR_GLOW);
      for (let i = 0; i < PAN_BANDS; i++) {
        const dx = px[i] - prevX[i];
        if (Math.abs(dx) < BLUR_MIN_DX) continue;
        const gradient = ctx.createLinearGradient(prevX[i], py[i], px[i], py[i]);
        gradient.addColorStop(0, "transparent");
        gradient.addColorStop(1, plevel[i] > PAN_HOT_LEVEL ? colors.accent : colors.main);
        ctx.strokeStyle = gradient;
        ctx.globalAlpha = blurAlpha(dx);
        ctx.lineWidth = 0.8 + plevel[i] * 2.2;
        ctx.beginPath();
        ctx.moveTo(prevX[i], py[i]);
        ctx.lineTo(px[i], py[i]);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
    }
    prevX.set(px);
    hasPrevious = true;

    // 帯域を下から順につなぐ線と、強さに応じた大きさ・色の点
    polyline(px, py, 0, PAN_BANDS - 1);
    ctx.strokeStyle = colors.accent;
    ctx.globalAlpha = PAN_LINE_ALPHA;
    ctx.lineWidth = PAN_LINE_WIDTH;
    setGlow(ctx, colors.accent, PAN_LINE_GLOW);
    ctx.stroke();
    for (let i = 0; i < PAN_BANDS; i++) {
      const size = panDotSize(plevel[i]);
      const color = plevel[i] > PAN_HOT_LEVEL ? colors.accent : colors.main;
      ctx.fillStyle = color;
      setGlow(ctx, color, PAN_DOT_GLOW);
      ctx.globalAlpha = 0.45 + 0.55 * plevel[i];
      ctx.fillRect(px[i] - size / 2, py[i] - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
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
    },
  };
}
