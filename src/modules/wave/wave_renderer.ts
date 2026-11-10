// 波形の描画：左に音量の履歴、右に今の波形（モックの drawWave に合わせる）。
// 常に既定の向き（履歴が左へ流れる）で描く。向きの回転は ModuleFrame が座標系ごと行う。
//
// - 履歴：受信側の履歴（約60行/秒）の1行を HISTORY_SCROLL_PX × 流れる速さの幅で並べ、最新の行を境目に置く。
//   ステレオは上に L（主色）・下に R（副色）を背中合わせに、モノラルは L と R を混ぜた値を上下対称に描く。
//   帯域別の色では、列ごとに強い帯域の色で塗る
// - 今の波形：直近 20ms を境目から右端までに描く。硬い芯（混ぜた信号を強くならして小さく）と、
//   柔らかい外縁（そのままの信号）の2本と、その間の半透明の塗り。両端で中心に戻す
// - 負荷（T9-1）：発光は発光の層（glow_layer）でまとめてつけ、線・塗りは短い区間に分けて描く（canvas_helpers）

import { WaveSummary, readWaveform, type AnalysisFrame, type Histories } from "../../frame_client";
import { drawGridLines, fillBetween, strokePolyline } from "../canvas_helpers";
import { createGlowLayer } from "../glow_layer";
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

type BandRole = "main" | "sub" | "accent";

export function createWaveRenderer({ ctx, createBuffer }: RenderContext): ModuleRenderer<WaveOptions> {
  let width = 0;
  let height = 0;
  const glow = createGlowLayer(createBuffer);
  // 今の波形の作業領域（幅が変わったときだけ作り直す）。*Y は画面の高さ
  let left = new Float32Array(0);
  let right = new Float32Array(0);
  let mixed = new Float32Array(0);
  let core = new Float32Array(0);
  let leftY = new Float32Array(0);
  let rightY = new Float32Array(0);
  let mixedY = new Float32Array(0);
  let coreY = new Float32Array(0);
  // 履歴の作業領域：列ごとの上下の振幅と、帯域別の色の役割
  let upAmp = new Float32Array(0);
  let downAmp = new Float32Array(0);
  let roles: BandRole[] = [];

  function buffers(points: number): void {
    if (left.length === points) return;
    left = new Float32Array(points);
    right = new Float32Array(points);
    mixed = new Float32Array(points);
    core = new Float32Array(points);
    leftY = new Float32Array(points);
    rightY = new Float32Array(points);
    mixedY = new Float32Array(points);
    coreY = new Float32Array(points);
  }

  function drawHistory(histories: Histories, options: WaveOptions, colors: PaletteColors, split: number, step: number): void {
    const history = histories.wave;
    const count = Math.min(history.length, historyColumns(split, step));
    if (count === 0) return;
    const first = history.length - count;
    const start = split - (count - 1) * step;
    const mid = height / 2;
    const mono = options.channel === "mono";
    const bands = options.histColor === "bands";

    if (upAmp.length < count) {
      upAmp = new Float32Array(Math.max(count, upAmp.length * 2));
      downAmp = new Float32Array(upAmp.length);
    }
    roles.length = count;
    for (let i = 0; i < count; i++) {
      const row = history.row(first + i);
      const l = row[WaveSummary.EnvL];
      const r = row[WaveSummary.EnvR];
      upAmp[i] = historyAmplitude(mono ? (l + r) / 2 : l, mid);
      downAmp[i] = historyAmplitude(mono ? (l + r) / 2 : r, mid);
      if (bands) roles[i] = bandRole(row[WaveSummary.BandLow], row[WaveSummary.BandMid], row[WaveSummary.BandHigh]);
    }
    const x = (i: number) => start + i * step;

    if (bands) {
      glow.draw(ctx, BANDS_GLOW, (c) => {
        c.globalAlpha = HISTORY_ALPHA;
        for (let i = 0; i < count; i++) {
          c.fillStyle = colors[roles[i]];
          c.fillRect(x(i) - step / 2, mid - upAmp[i], step, upAmp[i] + downAmp[i]);
        }
        c.globalAlpha = 1;
      });
      return;
    }

    // モノラルは上下とも主色、ステレオは上が L（主色）・下が R（副色）
    const lower = mono ? colors.main : colors.sub;
    glow.draw(ctx, HISTORY_GLOW, (c) => {
      c.globalAlpha = HISTORY_ALPHA;
      c.fillStyle = colors.main;
      fillBetween(c, count, x, (i) => mid - upAmp[i], () => mid);
      c.fillStyle = lower;
      fillBetween(c, count, x, () => mid, (i) => mid + downAmp[i]);
      c.globalAlpha = 1;
    });
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
    for (let u = 0; u <= n; u++) {
      const scale = mid * endWindow(u, span);
      coreY[u] = mid - core[u] * CORE_GAIN * scale;
      leftY[u] = mid - left[u] * OUTER_GAIN * scale;
      rightY[u] = mid - right[u] * OUTER_GAIN * scale;
      mixedY[u] = mid - mixed[u] * OUTER_GAIN * scale;
    }
    const x = (u: number) => split + u;
    const lanes: [Float32Array, string][] = options.channel === "mono" ? [[mixedY, colors.main]] : [[leftY, colors.main], [rightY, colors.sub]];

    // 外縁と芯の間の半透明の塗り
    ctx.globalAlpha = FILL_ALPHA;
    for (const [ys, color] of lanes) {
      ctx.fillStyle = color;
      fillBetween(ctx, n + 1, x, (u) => ys[u], (u) => coreY[u]);
    }
    ctx.globalAlpha = 1;
    // 柔らかい外縁
    glow.draw(ctx, OUTER_GLOW, (c) => {
      c.lineWidth = 1;
      c.globalAlpha = OUTER_ALPHA;
      for (const [ys, color] of lanes) {
        c.strokeStyle = color;
        strokePolyline(c, n + 1, x, (u) => ys[u]);
      }
      c.globalAlpha = 1;
    });
    // 硬い芯
    glow.draw(ctx, CORE_GLOW, (c) => {
      c.strokeStyle = colors.main;
      c.lineWidth = CORE_WIDTH;
      strokePolyline(c, n + 1, x, (u) => coreY[u]);
    });
  }

  return {
    resize(geometry: Geometry) {
      width = geometry.width;
      height = geometry.height;
      glow.resize(width, height, geometry.devicePixelRatio);
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
      upAmp = new Float32Array(0);
      downAmp = new Float32Array(0);
      roles = [];
      glow.dispose();
    },
  };
}
