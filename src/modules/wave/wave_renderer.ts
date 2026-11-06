// 波形の描画：左に音量の履歴、右に今の波形（モックの drawWave に合わせる）。
// 常に既定の向き（履歴が左へ流れる）で描く。向きの回転は ModuleFrame が座標系ごと行う。
//
// - 履歴：受信側の履歴（約60行/秒）の1行を HISTORY_SCROLL_PX × 流れる速さの幅で並べ、最新の行を境目に置く。
//   ステレオは上に L（主色）・下に R（副色）を背中合わせに、モノラルは L と R を混ぜた値を上下対称に描く。
//   帯域別の色では、列ごとに強い帯域の色で塗る
// - 今の波形：直近 20ms を境目から右端までに描く。硬い芯（混ぜた信号を強くならして小さく）と、
//   柔らかい外縁（そのままの信号）の2本と、その間の半透明の塗り。両端で中心に戻す

import { WaveSummary, readWaveform, type AnalysisFrame, type Histories } from "../../frame_client";
import { drawGridLines, setGlow } from "../canvas_helpers";
import type { WaveOptions } from "../options";
import type { Geometry, ModuleRenderer, PaletteColors, RenderContext } from "../types";
import {
  CORE_GAIN,
  OUTER_GAIN,
  bandRole,
  coreRadius,
  endWindow,
  historyAmplitude,
  historyColumns,
  movingAverage,
  resampleLinear,
  waveLayout,
} from "./wave_math";

const GRID_X = 8;
const GRID_Y = 2;
const HISTORY_ALPHA = 0.9;
const HISTORY_GLOW = 8;
const BANDS_GLOW = 6;
const SPLIT_LINE_ALPHA = 0.6;
const SPLIT_LINE_DASH = [2, 3];
const FILL_ALPHA = 0.22;
const OUTER_ALPHA = 0.75;
const OUTER_GLOW = 8;
const CORE_WIDTH = 1.8;
const CORE_GLOW = 4;

export function createWaveRenderer({ ctx }: RenderContext): ModuleRenderer<WaveOptions> {
  let width = 0;
  let height = 0;
  // 今の波形の作業領域（幅が変わったときだけ作り直す）
  let left = new Float32Array(0);
  let right = new Float32Array(0);
  let mixed = new Float32Array(0);
  let core = new Float32Array(0);

  function buffers(points: number): void {
    if (left.length === points) return;
    left = new Float32Array(points);
    right = new Float32Array(points);
    mixed = new Float32Array(points);
    core = new Float32Array(points);
  }

  function drawHistory(histories: Histories, options: WaveOptions, colors: PaletteColors, split: number, step: number): void {
    const history = histories.wave;
    const count = Math.min(history.length, historyColumns(split, step));
    if (count === 0) return;
    const first = history.length - count;
    const start = split - (count - 1) * step;
    const mid = height / 2;
    const mono = options.channel === "mono";
    const valueOf = (row: Float32Array, channel: 0 | 1) =>
      mono ? (row[WaveSummary.EnvL] + row[WaveSummary.EnvR]) / 2 : row[channel === 0 ? WaveSummary.EnvL : WaveSummary.EnvR];

    if (options.histColor === "bands") {
      ctx.globalAlpha = HISTORY_ALPHA;
      for (let i = 0; i < count; i++) {
        const row = history.row(first + i);
        const role = bandRole(row[WaveSummary.BandLow], row[WaveSummary.BandMid], row[WaveSummary.BandHigh]);
        const color = colors[role];
        const up = historyAmplitude(valueOf(row, 0), mid);
        const down = historyAmplitude(valueOf(row, 1), mid);
        ctx.fillStyle = color;
        setGlow(ctx, color, BANDS_GLOW);
        ctx.fillRect(start + i * step - step / 2, mid - up, step, up + down);
      }
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      return;
    }

    const band = (color: string, channel: 0 | 1, upward: boolean) => {
      ctx.beginPath();
      for (let i = 0; i < count; i++) {
        const a = historyAmplitude(valueOf(history.row(first + i), channel), mid);
        const x = start + i * step;
        const y = upward ? mid - a : mid + a;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(split, mid);
      ctx.lineTo(start, mid);
      ctx.closePath();
      setGlow(ctx, color, HISTORY_GLOW);
      ctx.fillStyle = color;
      ctx.globalAlpha = HISTORY_ALPHA;
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    if (mono) {
      band(colors.main, 0, true);
      band(colors.main, 0, false);
    } else {
      band(colors.main, 0, true);
      band(colors.sub, 1, false);
    }
    ctx.shadowBlur = 0;
  }

  function drawSplitLine(colors: PaletteColors, split: number): void {
    ctx.strokeStyle = colors.textMuted;
    ctx.globalAlpha = SPLIT_LINE_ALPHA;
    ctx.lineWidth = 1;
    ctx.setLineDash(SPLIT_LINE_DASH);
    ctx.beginPath();
    ctx.moveTo(split + 0.5, 0);
    ctx.lineTo(split + 0.5, height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  function drawNow(frame: AnalysisFrame | null, options: WaveOptions, colors: PaletteColors, split: number): void {
    const span = Math.max(1, width - split);
    const n = Math.floor(span);
    buffers(n + 1);
    const wave = frame ? readWaveform(frame) : null;
    if (wave) {
      resampleLinear(wave.nowL, left);
      resampleLinear(wave.nowR, right);
    } else {
      left.fill(0);
      right.fill(0);
    }
    for (let u = 0; u <= n; u++) mixed[u] = (left[u] + right[u]) / 2;
    movingAverage(mixed, coreRadius(n), core);

    const mid = height / 2;
    const coreY = (u: number) => mid - core[u] * CORE_GAIN * mid * endWindow(u, span);
    const outerY = (values: Float32Array, u: number) => mid - values[u] * OUTER_GAIN * mid * endWindow(u, span);
    const lanes: [Float32Array, string][] = options.channel === "mono" ? [[mixed, colors.main]] : [[left, colors.main], [right, colors.sub]];

    for (const [values, color] of lanes) {
      // 外縁と芯の間の半透明の塗り
      ctx.beginPath();
      for (let u = 0; u <= n; u++) {
        if (u === 0) ctx.moveTo(split + u, outerY(values, u));
        else ctx.lineTo(split + u, outerY(values, u));
      }
      for (let u = n; u >= 0; u--) ctx.lineTo(split + u, coreY(u));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.globalAlpha = FILL_ALPHA;
      ctx.fill();
      ctx.globalAlpha = 1;
      // 柔らかい外縁
      ctx.beginPath();
      for (let u = 0; u <= n; u++) {
        if (u === 0) ctx.moveTo(split + u, outerY(values, u));
        else ctx.lineTo(split + u, outerY(values, u));
      }
      setGlow(ctx, color, OUTER_GLOW);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.globalAlpha = OUTER_ALPHA;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 硬い芯
    ctx.beginPath();
    for (let u = 0; u <= n; u++) {
      if (u === 0) ctx.moveTo(split + u, coreY(u));
      else ctx.lineTo(split + u, coreY(u));
    }
    setGlow(ctx, colors.main, CORE_GLOW);
    ctx.strokeStyle = colors.main;
    ctx.lineWidth = CORE_WIDTH;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  return {
    resize(geometry: Geometry) {
      width = geometry.width;
      height = geometry.height;
    },

    draw(frame, histories, options, colors) {
      if (width <= 0 || height <= 0) return;
      const { split, step } = waveLayout(width, options);
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      drawGridLines(ctx, width, height, GRID_X, GRID_Y, colors.grid);
      drawHistory(histories, options, colors, split, step);
      if (options.showNow) {
        drawSplitLine(colors, split);
        drawNow(frame, options, colors, split);
      }
      ctx.restore();
    },

    dispose() {
      buffers(0);
    },
  };
}
