// スペクトラムの描画：線＋塗り（既定）・バー・鏡写し・円形と、ピークの残像（モックの drawSpec に合わせる）。
// 常に既定の向き（低域が左・高域が右、強さが上へ伸びる）で描く。向きの回転は ModuleFrame が座標系ごと行う。
//
// 平滑化（上がるときは即座に、下がるときは指数で）とピークの残像は、描画の側で持つ。
// 解析は帯域ごとの振幅（線形）だけを送り、dB への換算と表示の範囲は spec_math.ts で行う。
// 負荷（T9-1）：発光は発光の層（glow_layer）でまとめてつけ、線・塗りは短い区間に分けて描く（canvas_helpers）。
// 円形の塗りだけは、帯に分けると継ぎ目が出るので1つのパスのまま描く

import { SPECTRUM_BANDS, readSpectrum, type AnalysisFrame } from "../../frame_client";
import { drawGridLines, fillBetween, strokePolyline } from "../canvas_helpers";
import { createGlowLayer } from "../glow_layer";
import type { SpecOptions } from "../options";
import type { Geometry, ModuleRenderer, PaletteColors, RenderContext } from "../types";
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

const LABEL_ALPHA = 0.9;
const LABEL_OFFSET_X = 8;
const LABEL_BOTTOM = 4;

export function createSpecRenderer({ ctx, createBuffer }: RenderContext): ModuleRenderer<SpecOptions> {
  let width = 0;
  let height = 0;
  const glow = createGlowLayer(createBuffer);
  const bandX = (i: number) => xOfBand(i, width);
  // 表示の高さ（0〜1）。raw＝今のフレーム、smooth＝平滑化、peak＝ピークの残像
  const raw = new Float32Array(SPECTRUM_BANDS);
  const smooth = new Float32Array(SPECTRUM_BANDS);
  const peak = new Float32Array(SPECTRUM_BANDS);

  function drawFill(colors: PaletteColors, ghost: boolean): void {
    const h = height;
    // 輪郭の下を塗りつぶして光量を出し、下端に向けて暗く消して下のメーターとの境目を切る
    const gradient = ctx.createLinearGradient(0, h * 0.1, 0, h);
    gradient.addColorStop(0, colors.main);
    gradient.addColorStop(0.55, colors.main);
    gradient.addColorStop(1, "transparent");
    glow.draw(ctx, FILL_GLOW, (c) => {
      c.globalAlpha = FILL_ALPHA;
      c.fillStyle = gradient;
      fillBetween(c, SPECTRUM_BANDS, bandX, (i) => h - smooth[i] * h * FILL_HEIGHT, () => h);
      c.globalAlpha = 1;
    });

    // 平滑化した輪郭（主色）と、今のフレームそのままの細い線（副色）
    const line = (c: CanvasRenderingContext2D, values: Float32Array, scale: number) =>
      strokePolyline(c, SPECTRUM_BANDS, bandX, (i) => h - values[i] * h * scale);
    glow.draw(ctx, LINE_GLOW, (c) => {
      c.strokeStyle = colors.main;
      c.lineWidth = LINE_WIDTH;
      line(c, smooth, FILL_HEIGHT);
    });
    glow.draw(ctx, RAW_LINE_GLOW, (c) => {
      c.strokeStyle = colors.sub;
      c.lineWidth = 1;
      line(c, raw, RAW_LINE_HEIGHT);
    });

    if (ghost) {
      ctx.strokeStyle = colors.accent;
      ctx.globalAlpha = GHOST_ALPHA;
      ctx.lineWidth = 1;
      line(ctx, peak, FILL_HEIGHT);
      ctx.globalAlpha = 1;
    }
  }

  function drawBars(colors: PaletteColors, ghost: boolean): void {
    const w = width;
    const h = height;
    const barWidth = w / BAR_COUNT;
    const segment = Math.max(3, h / 40);
    const gap = Math.max(1, segment * 0.35);
    for (let j = 0; j < BAR_COUNT; j++) {
      const bodyHeight = barValue(smooth, j) * h * FILL_HEIGHT;
      const segments = Math.floor(bodyHeight / (segment + gap));
      for (let k = 0; k < segments; k++) {
        const y = h - (k + 1) * (segment + gap);
        ctx.fillStyle = y < h * BAR_HOT_FROM ? colors.accent : colors.main;
        ctx.globalAlpha = BAR_ALPHA_MIN + (1 - BAR_ALPHA_MIN) * (k / Math.max(1, segments));
        ctx.fillRect(j * barWidth + 1, y, barWidth - 2, segment);
      }
      if (ghost) {
        const y = h - barValue(peak, j) * h * FILL_HEIGHT;
        ctx.globalAlpha = BAR_PEAK_ALPHA;
        ctx.fillStyle = colors.sub;
        ctx.fillRect(j * barWidth + 1, y - BAR_PEAK_HEIGHT, barWidth - 2, BAR_PEAK_HEIGHT);
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawMirror(colors: PaletteColors, ghost: boolean): void {
    const mid = height / 2;
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "transparent");
    gradient.addColorStop(0.5, colors.main);
    gradient.addColorStop(1, "transparent");
    glow.draw(ctx, MIRROR_FILL_GLOW, (c) => {
      c.globalAlpha = MIRROR_FILL_ALPHA;
      c.fillStyle = gradient;
      fillBetween(c, SPECTRUM_BANDS, bandX, (i) => mid - smooth[i] * mid * MIRROR_HEIGHT, (i) => mid + smooth[i] * mid * MIRROR_HEIGHT);
      c.globalAlpha = 1;
    });

    const edges = (c: CanvasRenderingContext2D, values: Float32Array) => {
      for (const sign of [-1, 1] as const) {
        strokePolyline(c, SPECTRUM_BANDS, bandX, (i) => mid + sign * values[i] * mid * MIRROR_HEIGHT);
      }
    };
    glow.draw(ctx, LINE_GLOW, (c) => {
      c.strokeStyle = colors.main;
      c.lineWidth = MIRROR_LINE_WIDTH;
      edges(c, smooth);
    });
    if (ghost) {
      ctx.strokeStyle = colors.accent;
      ctx.globalAlpha = MIRROR_GHOST_ALPHA;
      ctx.lineWidth = 1;
      edges(ctx, peak);
      ctx.globalAlpha = 1;
    }
  }

  function drawRadial(colors: PaletteColors, ghost: boolean): void {
    const { cx, cy, r0, r1 } = radialLayout(width, height);
    const steps = SPECTRUM_BANDS * 2;
    const angle = (k: number) => -Math.PI / 2 + (k / steps) * Math.PI * 2;
    const ringX = (values: Float32Array) => (k: number) => cx + Math.cos(angle(k)) * (r0 + values[radialBand(k)] * r1);
    const ringY = (values: Float32Array) => (k: number) => cy + Math.sin(angle(k)) * (r0 + values[radialBand(k)] * r1);
    /** 輪の塗り：1つの閉じたパス */
    const ringPath = (c: CanvasRenderingContext2D, values: Float32Array) => {
      const x = ringX(values);
      const y = ringY(values);
      c.beginPath();
      c.moveTo(x(0), y(0));
      for (let k = 1; k <= steps; k++) c.lineTo(x(k), y(k));
      c.closePath();
    };
    /** 輪の線：短い区間に分けて描く（最後の点は最初の点と同じ位置なので、輪は閉じる） */
    const ringStroke = (c: CanvasRenderingContext2D, values: Float32Array) =>
      strokePolyline(c, steps + 1, ringX(values), ringY(values));

    // 内側と外側の目安の円
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r0, 0, Math.PI * 2);
    ctx.moveTo(cx + r0 + r1, cy);
    ctx.arc(cx, cy, r0 + r1, 0, Math.PI * 2);
    ctx.stroke();

    const gradient = ctx.createRadialGradient(cx, cy, r0 * 0.6, cx, cy, r0 + r1);
    gradient.addColorStop(0, "transparent");
    gradient.addColorStop(1, colors.main);
    glow.draw(ctx, RADIAL_FILL_GLOW, (c) => {
      ringPath(c, smooth);
      c.fillStyle = gradient;
      c.globalAlpha = RADIAL_FILL_ALPHA;
      c.fill();
      c.globalAlpha = 1;
    });
    glow.draw(ctx, LINE_GLOW, (c) => {
      c.strokeStyle = colors.main;
      c.lineWidth = LINE_WIDTH;
      ringStroke(c, smooth);
    });
    if (ghost) {
      ctx.strokeStyle = colors.accent;
      ctx.globalAlpha = GHOST_ALPHA;
      ctx.lineWidth = 1;
      ringStroke(ctx, peak);
      ctx.globalAlpha = 1;
    }
  }

  /** 下端の周波数の目盛り（数字と単位の記号なので、辞書は通さない） */
  function drawFrequencyLabels(colors: PaletteColors): void {
    ctx.shadowBlur = 0;
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
      glow.resize(width, height, geometry.devicePixelRatio);
    },

    draw(frame: AnalysisFrame | null, _histories, options, colors, dt) {
      if (width <= 0 || height <= 0) return;
      const spectrum = frame ? readSpectrum(frame) : null;
      toDisplayBands(spectrum ? spectrum.bands : null, raw);
      updateSmooth(smooth, raw, dt);
      updatePeakHold(peak, smooth, dt);

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      if (options.mode === "radial") {
        drawRadial(colors, options.ghost);
      } else {
        drawGridLines(ctx, width, height, GRID_X, GRID_Y, colors.grid);
        if (options.mode === "bars") drawBars(colors, options.ghost);
        else if (options.mode === "mirror") drawMirror(colors, options.ghost);
        else drawFill(colors, options.ghost);
        drawFrequencyLabels(colors);
      }
      ctx.restore();
    },

    dispose() {
      raw.fill(0);
      smooth.fill(0);
      peak.fill(0);
      glow.dispose();
    },
  };
}
