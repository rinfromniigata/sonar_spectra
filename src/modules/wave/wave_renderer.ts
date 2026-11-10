// 波形の描画：左に音量の履歴、右に今の波形（モックの drawWave に合わせる）。
// 常に既定の向き（履歴が左へ流れる）で描く。向きの回転は描画の層（図形）が行う。
//
// - 履歴：受信側の履歴（約60行/秒）の1行を HISTORY_SCROLL_PX × 流れる速さの幅で並べ、最新の行を境目に置く。
//   ステレオは上に L（主色）・下に R（副色）を背中合わせに、モノラルは L と R を混ぜた値を上下対称に描く。
//   帯域別の色では、列ごとに強い帯域の色で塗る
// - 今の波形：直近 20ms を境目から右端までに描く。硬い芯（混ぜた信号を強くならして小さく）と、
//   柔らかい外縁（そのままの信号）の2本と、その間の半透明の塗り。両端で中心に戻す
// - 図形はすべて描画の層（ShapeSink）へ出し、発光は図形の発光の値で描画の層がつける（imple 4.2）。文字は描かない
// - 履歴は、受信側の履歴から毎回まとめて作り直す（列は数百本で、描画の層には軽い。流れる画像〔輪の形のテクスチャ〕に
//   すると、描いた画像には発光と線のふちのならしを付け直せないため、図形のまま描く）

import { WaveSummary, readWaveform, type AnalysisFrame, type Histories } from "../../frame_client";
import type { WaveOptions } from "../options";
import { dashedVerticalRects, ensureLength, gridRects } from "../shape_helpers";
import type { Geometry, ModuleRenderer, PaletteColors, ShapeSink } from "../types";
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
/** 境目の点線（引く長さ・空ける長さ。モックの setLineDash([2, 3])） */
const SPLIT_LINE_DASH = [2, 3] as const;
const FILL_ALPHA = 0.22;
const OUTER_ALPHA = 0.75;
const OUTER_GLOW = 8;
const CORE_WIDTH = 1.8;
const CORE_GLOW = 4;

const ROLES = ["main", "sub", "accent"] as const;
type BandRole = (typeof ROLES)[number];

/** xs と ys の n 個を、x, y を交互に並べた点の並びにする（out を使い回す） */
function interleave(out: Float32Array, xs: Float32Array, ys: Float32Array, n: number): Float32Array {
  for (let i = 0; i < n; i++) {
    out[i * 2] = xs[i];
    out[i * 2 + 1] = ys[i];
  }
  return out.subarray(0, n * 2);
}

export function createWaveRenderer(): ModuleRenderer<WaveOptions> {
  let width = 0;
  let height = 0;
  let grid = new Float32Array(0);
  // 今の波形の作業領域（幅が変わったときだけ作り直す）。*Y は画面の高さ
  let left = new Float32Array(0);
  let right = new Float32Array(0);
  let mixed = new Float32Array(0);
  let core = new Float32Array(0);
  let nowX = new Float32Array(0);
  let leftY = new Float32Array(0);
  let rightY = new Float32Array(0);
  let mixedY = new Float32Array(0);
  let coreY = new Float32Array(0);
  let linePoints = new Float32Array(0);
  // 履歴の作業領域：列ごとの上下の振幅・帯域別の色の役割と、帯の位置・上下の端、帯域別の色の四角
  let upAmp = new Float32Array(0);
  let downAmp = new Float32Array(0);
  let roles: BandRole[] = [];
  let historyX = new Float32Array(0);
  let upperTop = new Float32Array(0);
  let middle = new Float32Array(0);
  let lowerBottom = new Float32Array(0);
  const roleRects: Record<BandRole, Float32Array<ArrayBuffer>> = { main: new Float32Array(0), sub: new Float32Array(0), accent: new Float32Array(0) };

  function buffers(points: number): void {
    if (left.length === points) return;
    left = new Float32Array(points);
    right = new Float32Array(points);
    mixed = new Float32Array(points);
    core = new Float32Array(points);
    nowX = new Float32Array(points);
    leftY = new Float32Array(points);
    rightY = new Float32Array(points);
    mixedY = new Float32Array(points);
    coreY = new Float32Array(points);
    linePoints = new Float32Array(points * 2);
  }

  function drawHistory(shapes: ShapeSink, histories: Histories, options: WaveOptions, colors: PaletteColors, split: number, step: number): void {
    const history = histories.wave;
    const count = Math.min(history.length, historyColumns(split, step));
    if (count === 0) return;
    const first = history.length - count;
    const start = split - (count - 1) * step;
    const mid = height / 2;
    const mono = options.channel === "mono";
    const bands = options.histColor === "bands";

    upAmp = ensureLength(upAmp, count);
    downAmp = ensureLength(downAmp, count);
    roles.length = count;
    for (let i = 0; i < count; i++) {
      const row = history.row(first + i);
      const l = row[WaveSummary.EnvL];
      const r = row[WaveSummary.EnvR];
      upAmp[i] = historyAmplitude(mono ? (l + r) / 2 : l, mid);
      downAmp[i] = historyAmplitude(mono ? (l + r) / 2 : r, mid);
      if (bands) roles[i] = bandRole(row[WaveSummary.BandLow], row[WaveSummary.BandMid], row[WaveSummary.BandHigh]);
    }

    if (bands) {
      // 列ごとに、強い帯域の色の四角（列どうしは重ならないので、色ごとにまとめて出す）
      const used: Record<BandRole, number> = { main: 0, sub: 0, accent: 0 };
      for (const role of ROLES) roleRects[role] = ensureLength(roleRects[role], count * 4);
      for (let i = 0; i < count; i++) {
        const role = roles[i];
        roleRects[role].set([start + i * step - step / 2, mid - upAmp[i], step, upAmp[i] + downAmp[i]], used[role] * 4);
        used[role]++;
      }
      for (const role of ROLES) {
        if (used[role] > 0) shapes.rects(roleRects[role].subarray(0, used[role] * 4), { color: colors[role], alpha: HISTORY_ALPHA, glow: BANDS_GLOW });
      }
      return;
    }

    // 帯は2列から（1列だけでは幅がない）
    if (count < 2) return;
    historyX = ensureLength(historyX, count);
    upperTop = ensureLength(upperTop, count);
    middle = ensureLength(middle, count);
    lowerBottom = ensureLength(lowerBottom, count);
    for (let i = 0; i < count; i++) {
      historyX[i] = start + i * step;
      upperTop[i] = mid - upAmp[i];
      middle[i] = mid;
      lowerBottom[i] = mid + downAmp[i];
    }
    // モノラルは上下とも主色、ステレオは上が L（主色）・下が R（副色）
    const xs = historyX.subarray(0, count);
    const mids = middle.subarray(0, count);
    shapes.band(xs, upperTop.subarray(0, count), mids, { color: colors.main, alpha: HISTORY_ALPHA, glow: HISTORY_GLOW });
    shapes.band(xs, mids, lowerBottom.subarray(0, count), { color: mono ? colors.main : colors.sub, alpha: HISTORY_ALPHA, glow: HISTORY_GLOW });
  }

  function drawNow(shapes: ShapeSink, frame: AnalysisFrame | null, options: WaveOptions, colors: PaletteColors, split: number): void {
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
      nowX[u] = split + u;
      coreY[u] = mid - core[u] * CORE_GAIN * scale;
      leftY[u] = mid - left[u] * OUTER_GAIN * scale;
      rightY[u] = mid - right[u] * OUTER_GAIN * scale;
      mixedY[u] = mid - mixed[u] * OUTER_GAIN * scale;
    }
    const lanes: [Float32Array, string][] = options.channel === "mono" ? [[mixedY, colors.main]] : [[leftY, colors.main], [rightY, colors.sub]];

    // 外縁と芯の間の半透明の塗り（外縁と芯が入れ替わるところは、交わる点で分けて塗る）
    for (const [ys, color] of lanes) shapes.band(nowX, ys, coreY, { color, alpha: FILL_ALPHA });
    // 柔らかい外縁（2本で1回の発光）
    for (const [ys, color] of lanes) {
      shapes.polyline(interleave(linePoints, nowX, ys, n + 1), { color, alpha: OUTER_ALPHA, width: 1, glow: OUTER_GLOW });
    }
    // 硬い芯
    shapes.polyline(interleave(linePoints, nowX, coreY, n + 1), { color: colors.main, width: CORE_WIDTH, glow: CORE_GLOW });
  }

  return {
    resize(geometry: Geometry) {
      width = geometry.width;
      height = geometry.height;
      grid = gridRects(width, height, GRID_X, GRID_Y);
    },

    draw(frame, histories, options, colors, _dt, out) {
      if (width <= 0 || height <= 0) return;
      const { shapes } = out;
      const { split, step } = waveLayout(width, options);
      shapes.rects(grid, { color: colors.grid });
      drawHistory(shapes, histories, options, colors, split, step);
      if (options.showNow) {
        shapes.rects(dashedVerticalRects(split, height, SPLIT_LINE_DASH[0], SPLIT_LINE_DASH[1]), { color: colors.textMuted, alpha: SPLIT_LINE_ALPHA });
        drawNow(shapes, frame, options, colors, split);
      }
    },

    dispose() {
      buffers(0);
      upAmp = new Float32Array(0);
      downAmp = new Float32Array(0);
      roles = [];
      historyX = new Float32Array(0);
      upperTop = new Float32Array(0);
      middle = new Float32Array(0);
      lowerBottom = new Float32Array(0);
      for (const role of ROLES) roleRects[role] = new Float32Array(0);
    },
  };
}
