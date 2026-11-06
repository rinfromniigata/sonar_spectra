// スペクトログラムの描画：横が時間（既定では右が新しい）、縦が周波数（下が低域）の、流れる画像（モックの drawGram に合わせる）。
// 常に既定の向き（左へ流れる）で描く。向きの回転は ModuleFrame が座標系ごと行う。
//
// 描画側が画面に出さない画像（バッファ）を持ち、毎回、すでに描いた分を左へずらして、新しく届いた行の列だけを右端に足す。
// バッファはデバイスピクセルで持つ（列の幅・帯の高さがピクセルにそろい、ずらしても縞が出ない）。
// 受信側の履歴（histories.gram）は、枠の大きさ・流れる速さ・配色が変わってバッファを作り直すときに、過去の列を描き直すのに使う。

import { SPECTRUM_BANDS, type AnalysisFrame, type Histories } from "../../frame_client";
import type { SpeedOptions } from "../options";
import { createBrowserBuffer, type Geometry, type ModuleRenderer, type OffscreenBuffer, type PaletteColors, type RenderContext } from "../types";
import { ROW_PX, cellStyle, columnStep, displayRow, rangeLevel, rowRanges, visibleColumns, type RowRange } from "./gram_math";

export function createGramRenderer({ ctx, createBuffer = createBrowserBuffer }: RenderContext): ModuleRenderer<SpeedOptions> {
  let width = 0;
  let height = 0;
  let dpr = 1;
  let buffer: OffscreenBuffer | null = null;
  /** バッファを作ったときの条件。変わったら作り直す */
  let builtKey = "";
  /** バッファに描き込んだ履歴の行の累計（`RowHistory.total`） */
  let drawnTotal = 0;
  // バッファの大きさと列・帯（デバイスピクセル）
  let pixelWidth = 0;
  let pixelHeight = 0;
  let stepPx = 1;
  let ranges: RowRange[] = [];
  const display = new Float32Array(SPECTRUM_BANDS);

  /** 履歴の1行を、バッファの x（デバイスピクセル）から stepPx の幅の列として描く */
  function drawColumn(target: OffscreenBuffer, row: ArrayLike<number>, x: number, colors: PaletteColors): void {
    const bctx = target.ctx;
    bctx.globalAlpha = 1;
    bctx.fillStyle = colors.bg;
    bctx.fillRect(x, 0, stepPx, pixelHeight);
    displayRow(row, display);
    for (const range of ranges) {
      const style = cellStyle(rangeLevel(display, range));
      if (!style) continue;
      bctx.globalAlpha = style.alpha;
      bctx.fillStyle = style.hot ? colors.accent : colors.main;
      bctx.fillRect(x, range.y, stepPx, range.height);
    }
    bctx.globalAlpha = 1;
  }

  /** 条件が変わったので、バッファを作り直し、履歴から過去の列を描き直す */
  function rebuild(history: Histories["gram"], colors: PaletteColors): OffscreenBuffer {
    const target = createBuffer(pixelWidth, pixelHeight);
    buffer = target;
    target.ctx.setTransform(1, 0, 0, 1, 0, 0);
    target.ctx.globalAlpha = 1;
    target.ctx.fillStyle = colors.bg;
    target.ctx.fillRect(0, 0, pixelWidth, pixelHeight);
    const count = Math.min(history.length, visibleColumns(pixelWidth, stepPx));
    for (let j = 0; j < count; j++) {
      drawColumn(target, history.row(history.length - count + j), pixelWidth - (count - j) * stepPx, colors);
    }
    drawnTotal = history.total;
    return target;
  }

  return {
    resize(geometry: Geometry) {
      width = geometry.width;
      height = geometry.height;
      dpr = geometry.devicePixelRatio;
      pixelWidth = Math.max(1, Math.ceil(width * dpr));
      pixelHeight = Math.max(1, Math.ceil(height * dpr));
      ranges = rowRanges(pixelHeight, Math.max(1, Math.round(ROW_PX * dpr)));
      // バッファは次の draw で作り直す
      buffer = null;
      builtKey = "";
    },

    draw(_frame: AnalysisFrame | null, histories, options, colors) {
      if (width <= 0 || height <= 0) return;
      const history = histories.gram;
      stepPx = Math.max(1, Math.round(columnStep(options.speed) * dpr));
      const key = `${pixelWidth}x${pixelHeight}|${stepPx}|${colors.bg}|${colors.main}|${colors.accent}`;

      let target = buffer;
      if (!target || key !== builtKey) {
        builtKey = key;
        target = rebuild(history, colors);
      } else {
        // 前回から増えた行だけ、左へずらして右端に足す
        const added = Math.min(history.total - drawnTotal, history.length, visibleColumns(pixelWidth, stepPx));
        if (added > 0) {
          const shift = added * stepPx;
          target.ctx.globalAlpha = 1;
          target.ctx.drawImage(target.canvas, -shift, 0);
          for (let k = 0; k < added; k++) {
            drawColumn(target, history.row(history.length - added + k), pixelWidth - (added - k) * stepPx, colors);
          }
        }
        drawnTotal = history.total;
      }

      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(target.canvas, 0, 0, width, height);
    },

    dispose() {
      buffer = null;
      builtKey = "";
    },
  };
}
