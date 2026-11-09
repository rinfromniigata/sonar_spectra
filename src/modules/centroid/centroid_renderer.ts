// 重心と変化量の描画：音の明るさ（スペクトルの重心）の推移を線で、音色の変化の激しさ（フラックス）を下の棒で流す。
// 右端に今の値（モックの drawCentroid に合わせる）。常に既定の向き（履歴が左へ流れ、新しい列が右端）で描く。
// 向きの回転は ModuleFrame が座標系ごと行う。
//
// - 履歴：受信側の履歴（約60行/秒）の1行を columnStep(速さ) px の1列として、右端から並べる
// - 重心の線：対数の軸（50 Hz〜16 kHz）に写し、時間方向にならす（centroid_math）。無音は下端
// - 変化量の棒：1行ごとの高さ。大きい（高さの 0.55 を超える）列は強調色
// - 数値：直近 15 行の平均を 0.25 秒ごとに書き換える（読めなくならないように）。無音は「—」で、変化量は出さない

import { type AnalysisFrame, type Histories } from "../../frame_client";
import { drawGridLines, setGlow } from "../canvas_helpers";
import type { SpeedOptions } from "../options";
import type { Geometry, ModuleRenderer, PaletteColors, RenderContext } from "../types";
import {
  NO_VALUE,
  READOUT_INTERVAL,
  barStyle,
  centroidLayout,
  columnStep,
  fluxLevel,
  formatFlux,
  formatHz,
  lineY,
  readoutOf,
  smoothedPositions,
  visibleColumns,
  type CentroidLayout,
  type Readout,
} from "./centroid_math";

const GRID_X = 8;
const GRID_Y = 4;
const LINE_WIDTH = 1.6;
const LINE_GLOW = 10;
const TEXT_MARGIN = 6;

export function createCentroidRenderer({ ctx }: RenderContext): ModuleRenderer<SpeedOptions> {
  let width = 0;
  let height = 0;
  let positions = new Float32Array(0);
  /** 画面に出している数値と、書き換えてからの経過（秒） */
  let readout: Readout | null = null;
  let sinceReadout = 0;

  function drawBars(history: Histories["centroid"], count: number, step: number, layout: CentroidLayout, colors: PaletteColors): void {
    const first = history.length - count;
    const start = width - count * step;
    const barWidth = Math.max(1, step - 1);
    ctx.shadowBlur = 0;
    for (let i = 0; i < count; i++) {
      const level = fluxLevel(history.row(first + i)[1]);
      if (level <= 0) continue;
      const style = barStyle(level);
      ctx.fillStyle = style.hot ? colors.accent : colors.sub;
      ctx.globalAlpha = style.alpha;
      const barHeight = level * layout.fluxHeight;
      ctx.fillRect(start + i * step, height - barHeight, barWidth, barHeight);
    }
    ctx.globalAlpha = 1;
  }

  function drawLine(count: number, step: number, layout: CentroidLayout, colors: PaletteColors): void {
    const start = width - count * step;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = start + i * step;
      const y = lineY(layout, positions[i]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = colors.main;
    ctx.lineWidth = LINE_WIDTH;
    setGlow(ctx, colors.main, LINE_GLOW);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  function drawReadout(values: Readout, layout: CentroidLayout, colors: PaletteColors): void {
    ctx.font = `${layout.fontSize}px ${colors.fontNumeric}`;
    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = "right";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(values.hz === null ? NO_VALUE : formatHz(values.hz), width - TEXT_MARGIN, layout.top + 2);
    if (values.hz !== null) ctx.fillText(formatFlux(values.flux), width - TEXT_MARGIN, height - layout.fluxHeight - 4);
  }

  return {
    resize(geometry: Geometry) {
      width = geometry.width;
      height = geometry.height;
    },

    draw(_frame: AnalysisFrame | null, histories, options, colors, dt) {
      if (width <= 0 || height <= 0) return;
      const history = histories.centroid;
      const step = columnStep(options.speed);
      const count = Math.min(history.length, visibleColumns(width, step));
      if (positions.length < count) positions = new Float32Array(Math.max(count, positions.length * 2));
      smoothedPositions(history, count, positions);

      sinceReadout += Math.max(0, dt);
      if (!readout || sinceReadout >= READOUT_INTERVAL) {
        readout = readoutOf(history);
        sinceReadout = 0;
      }

      const layout = centroidLayout(height);
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      drawGridLines(ctx, width, height, GRID_X, GRID_Y, colors.grid);
      if (count > 0) {
        drawBars(history, count, step, layout, colors);
        drawLine(count, step, layout, colors);
      }
      drawReadout(readout, layout, colors);
      ctx.restore();
    },

    dispose() {
      positions = new Float32Array(0);
      readout = null;
      sinceReadout = 0;
    },
  };
}
