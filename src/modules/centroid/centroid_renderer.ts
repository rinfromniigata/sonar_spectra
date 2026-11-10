// 重心と変化量の描画：音の明るさ（スペクトルの重心）の推移を線で、音色の変化の激しさ（フラックス）を下の棒で流す。
// 右端に今の値（モックの drawCentroid に合わせる）。常に既定の向き（履歴が左へ流れ、新しい列が右端）で描く。
// 向きの回転は描画の層（図形）と ModuleFrame（文字の層）が行う。
//
// - 履歴：受信側の履歴（約60行/秒）の1行を columnStep(速さ) px の1列として、右端から並べる
// - 重心の線：対数の軸（50 Hz〜16 kHz）に写し、時間方向にならす（centroid_math）。無音は下端
// - 変化量の棒：1行ごとの高さ。大きい（高さの 0.55 を超える）列は強調色
// - 数値：直近 15 行の平均を 0.25 秒ごとに書き換える（読めなくならないように）。無音は「—」で、変化量は出さない
// - 図形（格子・棒・線）は描画の層（ShapeSink）へ出し、線の発光は描画の層がつける（imple 4.2）。数値は文字の層に描く。
//   線と棒は、受信側の履歴から毎回まとめて作り直す（流れる画像にすると、線の発光とふちのならしを付け直せないため）

import { type AnalysisFrame, type Histories } from "../../frame_client";
import type { SpeedOptions } from "../options";
import { ensureLength, gridRects } from "../shape_helpers";
import type { Geometry, ModuleRenderer, PaletteColors, RenderContext, ShapeSink } from "../types";
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
  let grid = new Float32Array(0);
  let positions = new Float32Array(0);
  let linePoints = new Float32Array(0);
  // 変化量の棒（副色・強調色）の四角と不透明度
  const bars = { sub: [] as number[], accent: [] as number[] };
  const barAlphas = { sub: [] as number[], accent: [] as number[] };
  /** 画面に出している数値と、書き換えてからの経過（秒） */
  let readout: Readout | null = null;
  let sinceReadout = 0;

  function drawBars(shapes: ShapeSink, history: Histories["centroid"], count: number, step: number, layout: CentroidLayout, colors: PaletteColors): void {
    const first = history.length - count;
    const start = width - count * step;
    const barWidth = Math.max(1, step - 1);
    for (const key of ["sub", "accent"] as const) {
      bars[key].length = 0;
      barAlphas[key].length = 0;
    }
    for (let i = 0; i < count; i++) {
      const level = fluxLevel(history.row(first + i)[1]);
      if (level <= 0) continue;
      const style = barStyle(level);
      const key = style.hot ? "accent" : "sub";
      const barHeight = level * layout.fluxHeight;
      bars[key].push(start + i * step, height - barHeight, barWidth, barHeight);
      barAlphas[key].push(style.alpha);
    }
    // 棒どうしは重ならないので、色ごとにまとめて出す
    for (const key of ["sub", "accent"] as const) {
      if (bars[key].length > 0) shapes.rects(bars[key], { color: colors[key] }, barAlphas[key]);
    }
  }

  function drawLine(shapes: ShapeSink, count: number, step: number, layout: CentroidLayout, colors: PaletteColors): void {
    const start = width - count * step;
    linePoints = ensureLength(linePoints, count * 2);
    for (let i = 0; i < count; i++) {
      linePoints[i * 2] = start + i * step;
      linePoints[i * 2 + 1] = lineY(layout, positions[i]);
    }
    shapes.polyline(linePoints.subarray(0, count * 2), { color: colors.main, width: LINE_WIDTH, glow: LINE_GLOW });
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
      grid = gridRects(width, height, GRID_X, GRID_Y);
    },

    draw(_frame: AnalysisFrame | null, histories, options, colors, dt, out) {
      if (width <= 0 || height <= 0) return;
      const history = histories.centroid;
      const step = columnStep(options.speed);
      const count = Math.min(history.length, visibleColumns(width, step));
      positions = ensureLength(positions, count);
      smoothedPositions(history, count, positions);

      sinceReadout += Math.max(0, dt);
      if (!readout || sinceReadout >= READOUT_INTERVAL) {
        readout = readoutOf(history);
        sinceReadout = 0;
      }

      const layout = centroidLayout(height);
      const { shapes } = out;
      shapes.rects(grid, { color: colors.grid });
      if (count > 0) {
        drawBars(shapes, history, count, step, layout, colors);
        drawLine(shapes, count, step, layout, colors);
      }
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      drawReadout(readout, layout, colors);
      ctx.restore();
    },

    dispose() {
      positions = new Float32Array(0);
      linePoints = new Float32Array(0);
      readout = null;
      sinceReadout = 0;
    },
  };
}
