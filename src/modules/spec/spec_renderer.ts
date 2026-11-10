// スペクトラムの描画：線＋塗り（既定）・バー・鏡写し・円形と、ピークの残像（モックの drawSpec に合わせる）。
// 常に既定の向き（低域が左・高域が右、強さが上へ伸びる）で描く。向きの回転は描画の層（図形）と ModuleFrame（文字の層）が行う。
//
// 平滑化（上がるときは即座に、下がるときは指数で）とピークの残像は、描画の側で持つ。
// 解析は帯域ごとの振幅（線形）だけを送り、dB への換算と表示の範囲は spec_math.ts で行う。
// 図形は描画の層（ShapeSink）へ出し、発光は図形の発光の値で描画の層がつける（imple 4.2）。塗りの色の移り変わり
// （下端に向けて消える・中央から外へ消える・円の外側ほど濃い）は Gradient で渡す。周波数の目盛りの文字は文字の層に描く

import { SPECTRUM_BANDS, readSpectrum, type AnalysisFrame } from "../../frame_client";
import type { SpecOptions } from "../options";
import { gridRects } from "../shape_helpers";
import type { Geometry, ModuleRenderer, PaletteColors, RenderContext, ShapeSink } from "../types";
import {
  BAR_COUNT,
  FREQUENCY_TICKS,
  barValue,
  radialBand,
  radialLayout,
  toDisplayBands,
  updatePeakHold,
  updateSmooth,
  xOfBand,
  xOfHz,
} from "./spec_math";

const GRID_X = 10;
const GRID_Y = 6;
/** 線＋塗り・バー・鏡写しで、最大の高さが枠の高さに占める割合（モックの値） */
const FILL_HEIGHT = 0.9;
const RAW_LINE_HEIGHT = 0.78;
const MIRROR_HEIGHT = 0.92;

const FILL_ALPHA = 0.82;
const FILL_GLOW = 24;
/** 線＋塗りの色の移り変わり：高さの 10% から主色、55% まで主色のまま、下端で透明（モック） */
const FILL_FADE_FROM = 0.1;
const FILL_FADE_SOLID = 0.55;
const LINE_WIDTH = 1.6;
const LINE_GLOW = 10;
const RAW_LINE_GLOW = 6;
const GHOST_ALPHA = 0.55;

const BAR_ALPHA_MIN = 0.55;
const BAR_HOT_FROM = 0.3;
const BAR_PEAK_ALPHA = 0.9;
const BAR_PEAK_HEIGHT = 2;

const MIRROR_FILL_ALPHA = 0.8;
const MIRROR_FILL_GLOW = 20;
const MIRROR_LINE_WIDTH = 1.4;
const MIRROR_GHOST_ALPHA = 0.5;

const RADIAL_FILL_ALPHA = 0.75;
const RADIAL_FILL_GLOW = 20;
/** 円形の塗りの色の移り変わりの始まり（内側の円の半径に対する割合。そこまでは透明） */
const RADIAL_FADE_FROM = 0.6;
/** 内側と外側の目安の円を、何本の線分で描くか */
const GUIDE_SEGMENTS = 128;

const LABEL_ALPHA = 0.9;
const LABEL_OFFSET_X = 8;
const LABEL_BOTTOM = 4;

/** 中心 (cx, cy)・半径 r の円の点（segments 個。閉じた線で描く） */
function circlePoints(cx: number, cy: number, r: number, segments: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(segments * 2);
  for (let k = 0; k < segments; k++) {
    const a = (k / segments) * Math.PI * 2;
    out[k * 2] = cx + Math.cos(a) * r;
    out[k * 2 + 1] = cy + Math.sin(a) * r;
  }
  return out;
}

export function createSpecRenderer({ ctx }: RenderContext): ModuleRenderer<SpecOptions> {
  let width = 0;
  let height = 0;
  let grid = new Float32Array(0);
  // 表示の高さ（0〜1）。raw＝今のフレーム、smooth＝平滑化、peak＝ピークの残像
  const raw = new Float32Array(SPECTRUM_BANDS);
  const smooth = new Float32Array(SPECTRUM_BANDS);
  const peak = new Float32Array(SPECTRUM_BANDS);
  // 作業領域：帯域の横の位置、帯の上下の端、線の点の並び
  const bandXs = new Float32Array(SPECTRUM_BANDS);
  const top = new Float32Array(SPECTRUM_BANDS);
  const bottom = new Float32Array(SPECTRUM_BANDS);
  const line = new Float32Array(SPECTRUM_BANDS * 2);
  // バー：段（主色・強調色）とピークの印の四角、段ごとの不透明度
  const segmentRects = { main: [] as number[], accent: [] as number[] };
  const segmentAlphas = { main: [] as number[], accent: [] as number[] };
  const peakMarks = new Float32Array(BAR_COUNT * 4);
  // 円形：輪の点の並び、目安の円
  const ring = new Float32Array(SPECTRUM_BANDS * 2 * 2);
  let guides: [Float32Array, Float32Array] = [new Float32Array(0), new Float32Array(0)];

  /** 帯域ごとの高さ（0〜1）を、y = base − value × scale の線の点の並びにする */
  function linePoints(values: Float32Array, base: number, scale: number): Float32Array {
    for (let i = 0; i < SPECTRUM_BANDS; i++) {
      line[i * 2] = bandXs[i];
      line[i * 2 + 1] = base - values[i] * scale;
    }
    return line;
  }

  function drawFill(shapes: ShapeSink, colors: PaletteColors, ghost: boolean): void {
    const h = height;
    // 輪郭の下を塗りつぶして光量を出し、下端に向けて暗く消して下のメーターとの境目を切る
    for (let i = 0; i < SPECTRUM_BANDS; i++) {
      top[i] = h - smooth[i] * h * FILL_HEIGHT;
      bottom[i] = h;
    }
    shapes.band(bandXs, top, bottom, {
      color: {
        kind: "linear",
        x0: 0,
        y0: h * FILL_FADE_FROM,
        x1: 0,
        y1: h,
        stops: [
          { offset: 0, color: colors.main },
          { offset: FILL_FADE_SOLID, color: colors.main },
          { offset: 1, color: "transparent" },
        ],
      },
      alpha: FILL_ALPHA,
      glow: FILL_GLOW,
    });

    // 平滑化した輪郭（主色）と、今のフレームそのままの細い線（副色）
    shapes.polyline(linePoints(smooth, h, h * FILL_HEIGHT), { color: colors.main, width: LINE_WIDTH, glow: LINE_GLOW });
    shapes.polyline(linePoints(raw, h, h * RAW_LINE_HEIGHT), { color: colors.sub, width: 1, glow: RAW_LINE_GLOW });
    if (ghost) shapes.polyline(linePoints(peak, h, h * FILL_HEIGHT), { color: colors.accent, alpha: GHOST_ALPHA, width: 1 });
  }

  function drawBars(shapes: ShapeSink, colors: PaletteColors, ghost: boolean): void {
    const w = width;
    const h = height;
    const barWidth = w / BAR_COUNT;
    const segment = Math.max(3, h / 40);
    const gap = Math.max(1, segment * 0.35);
    for (const key of ["main", "accent"] as const) {
      segmentRects[key].length = 0;
      segmentAlphas[key].length = 0;
    }
    for (let j = 0; j < BAR_COUNT; j++) {
      const bodyHeight = barValue(smooth, j) * h * FILL_HEIGHT;
      const segments = Math.floor(bodyHeight / (segment + gap));
      for (let k = 0; k < segments; k++) {
        const y = h - (k + 1) * (segment + gap);
        const key = y < h * BAR_HOT_FROM ? "accent" : "main";
        segmentRects[key].push(j * barWidth + 1, y, barWidth - 2, segment);
        segmentAlphas[key].push(BAR_ALPHA_MIN + (1 - BAR_ALPHA_MIN) * (k / Math.max(1, segments)));
      }
      const y = h - barValue(peak, j) * h * FILL_HEIGHT;
      peakMarks.set([j * barWidth + 1, y - BAR_PEAK_HEIGHT, barWidth - 2, BAR_PEAK_HEIGHT], j * 4);
    }
    // 段どうしは重ならないので、色ごとにまとめて出す
    for (const key of ["main", "accent"] as const) {
      if (segmentRects[key].length > 0) shapes.rects(segmentRects[key], { color: colors[key] }, segmentAlphas[key]);
    }
    if (ghost) shapes.rects(peakMarks, { color: colors.sub, alpha: BAR_PEAK_ALPHA });
  }

  function drawMirror(shapes: ShapeSink, colors: PaletteColors, ghost: boolean): void {
    const mid = height / 2;
    for (let i = 0; i < SPECTRUM_BANDS; i++) {
      top[i] = mid - smooth[i] * mid * MIRROR_HEIGHT;
      bottom[i] = mid + smooth[i] * mid * MIRROR_HEIGHT;
    }
    shapes.band(bandXs, top, bottom, {
      color: {
        kind: "linear",
        x0: 0,
        y0: 0,
        x1: 0,
        y1: height,
        stops: [
          { offset: 0, color: "transparent" },
          { offset: 0.5, color: colors.main },
          { offset: 1, color: "transparent" },
        ],
      },
      alpha: MIRROR_FILL_ALPHA,
      glow: MIRROR_FILL_GLOW,
    });

    const edges = (values: Float32Array, style: Parameters<ShapeSink["polyline"]>[1]) => {
      for (const sign of [-1, 1] as const) shapes.polyline(linePoints(values, mid, -sign * mid * MIRROR_HEIGHT), style);
    };
    edges(smooth, { color: colors.main, width: MIRROR_LINE_WIDTH, glow: LINE_GLOW });
    if (ghost) edges(peak, { color: colors.accent, alpha: MIRROR_GHOST_ALPHA, width: 1 });
  }

  function drawRadial(shapes: ShapeSink, colors: PaletteColors, ghost: boolean): void {
    const { cx, cy, r0, r1 } = radialLayout(width, height);
    const steps = SPECTRUM_BANDS * 2;
    /** 輪の点（steps 個。最後の点は最初の点と同じ位置なので、閉じた形・閉じた線にする） */
    const ringPoints = (values: Float32Array) => {
      for (let k = 0; k < steps; k++) {
        const angle = -Math.PI / 2 + (k / steps) * Math.PI * 2;
        const r = r0 + values[radialBand(k)] * r1;
        ring[k * 2] = cx + Math.cos(angle) * r;
        ring[k * 2 + 1] = cy + Math.sin(angle) * r;
      }
      return ring;
    };

    // 内側と外側の目安の円
    for (const guide of guides) shapes.polyline(guide, { color: colors.grid, width: 1, closed: true });

    // 輪の塗り：中心から扇形に（輪は中心から見て星形）。外側ほど主色が濃く、内側の円の 60% より内は透明
    shapes.polygon(
      ringPoints(smooth),
      {
        color: {
          kind: "radial",
          x: cx,
          y: cy,
          r0: r0 * RADIAL_FADE_FROM,
          r1: r0 + r1,
          stops: [
            { offset: 0, color: "transparent" },
            { offset: 1, color: colors.main },
          ],
        },
        alpha: RADIAL_FILL_ALPHA,
        glow: RADIAL_FILL_GLOW,
      },
      [cx, cy],
    );
    shapes.polyline(ringPoints(smooth), { color: colors.main, width: LINE_WIDTH, glow: LINE_GLOW, closed: true });
    if (ghost) shapes.polyline(ringPoints(peak), { color: colors.accent, alpha: GHOST_ALPHA, width: 1, closed: true });
  }

  /** 下端の周波数の目盛り（数字と単位の記号なので、辞書は通さない） */
  function drawFrequencyLabels(colors: PaletteColors): void {
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${Math.max(8, Math.min(11, width / 60))}px ${colors.fontNumeric}`;
    ctx.globalAlpha = LABEL_ALPHA;
    for (const { label, hz } of FREQUENCY_TICKS) {
      ctx.fillText(label, Math.max(2, xOfHz(hz, width) - LABEL_OFFSET_X), height - LABEL_BOTTOM);
    }
    ctx.globalAlpha = 1;
  }

  return {
    resize(geometry: Geometry) {
      width = geometry.width;
      height = geometry.height;
      grid = gridRects(width, height, GRID_X, GRID_Y);
      for (let i = 0; i < SPECTRUM_BANDS; i++) bandXs[i] = xOfBand(i, width);
      const { cx, cy, r0, r1 } = radialLayout(width, height);
      guides = [circlePoints(cx, cy, r0, GUIDE_SEGMENTS), circlePoints(cx, cy, r0 + r1, GUIDE_SEGMENTS)];
    },

    draw(frame: AnalysisFrame | null, _histories, options, colors, dt, out) {
      if (width <= 0 || height <= 0) return;
      const spectrum = frame ? readSpectrum(frame) : null;
      toDisplayBands(spectrum ? spectrum.bands : null, raw);
      updateSmooth(smooth, raw, dt);
      updatePeakHold(peak, smooth, dt);

      const { shapes } = out;
      ctx.clearRect(0, 0, width, height);
      if (options.mode === "radial") {
        drawRadial(shapes, colors, options.ghost);
        return;
      }
      shapes.rects(grid, { color: colors.grid });
      if (options.mode === "bars") drawBars(shapes, colors, options.ghost);
      else if (options.mode === "mirror") drawMirror(shapes, colors, options.ghost);
      else drawFill(shapes, colors, options.ghost);
      ctx.save();
      drawFrequencyLabels(colors);
      ctx.restore();
    },

    dispose() {
      raw.fill(0);
      smooth.fill(0);
      peak.fill(0);
    },
  };
}
