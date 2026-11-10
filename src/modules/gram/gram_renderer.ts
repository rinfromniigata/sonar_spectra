// スペクトログラムの描画：横が時間（既定では右が新しい）、縦が周波数（下が低域）の、流れる画像（モックの drawGram に合わせる）。
// 常に既定の向き（左へ流れる）で描く。向きの回転は描画の層が頂点の変換で行う。
//
// 流れる画像（StreamImage。imple 4.2）は輪の形の画像で、履歴の1行を1列にする。新しく届いた行の列の中身だけを作って足し、
// 描画の層は足された列だけを GPU の画像に書いて、読み始めの位置をずらして表示する（すでに描いた分をずらし直さない）。
// 列の高さはデバイスピクセルで持ち（帯の高さがピクセルにそろう）、1列を流れる幅（デバイスピクセル）の幅で表示する。
// 色の付かないセルは透明にして、枠の地（描画の層が塗る）を見せる。
// 受信側の履歴（histories.gram）は、枠の大きさ・流れる速さ・配色が変わって画像を作り直すときに、過去の列を描き直すのに使う。

import { SPECTRUM_BANDS, type AnalysisFrame, type Histories } from "../../frame_client";
import { canvasColorFallback, createColorResolver, type Rgba } from "../../render/gl/color";
import type { SpeedOptions } from "../options";
import { StreamImage } from "../stream_image";
import type { Geometry, ModuleRenderer, PaletteColors } from "../types";
import { ROW_PX, cellStyle, columnStep, displayRow, rangeLevel, rowRanges, visibleColumns, type RowRange } from "./gram_math";

/** 色の文字列を RGBA に直す（同じ文字列は使い回す。ブラウザでは、直接読めない形を Canvas 2D に任せる） */
const resolveColor = createColorResolver(typeof document === "undefined" ? undefined : canvasColorFallback());

/** 列の中身を作るときの色（RGBA 0〜255。不透明度は掛けない） */
interface ColumnColors {
  main: Rgba;
  accent: Rgba;
}

const toByte = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);

export function createGramRenderer(): ModuleRenderer<SpeedOptions> {
  let width = 0;
  let height = 0;
  let dpr = 1;
  let stream: StreamImage | null = null;
  /** 画像を作ったときの条件。変わったら作り直す */
  let builtKey = "";
  /** 画像に足した履歴の行の累計（`RowHistory.total`） */
  let drawnTotal = 0;
  // 枠の大きさ・列の幅・帯（デバイスピクセル）
  let pixelWidth = 0;
  let pixelHeight = 0;
  let stepPx = 1;
  let ranges: RowRange[] = [];
  const display = new Float32Array(SPECTRUM_BANDS);
  /** 作業用の列（高さ × 4） */
  let column = new Uint8Array(0);

  /** 履歴の1行を、列の中身（上から下への RGBA）にして画像に足す */
  function pushRow(target: StreamImage, row: ArrayLike<number>, colors: ColumnColors): void {
    column.fill(0);
    displayRow(row, display);
    for (const range of ranges) {
      const style = cellStyle(rangeLevel(display, range));
      if (!style) continue;
      const color = style.hot ? colors.accent : colors.main;
      const r = toByte(color[0]);
      const g = toByte(color[1]);
      const b = toByte(color[2]);
      const a = toByte(color[3] * style.alpha);
      for (let y = range.y; y < range.y + range.height; y++) {
        const o = y * 4;
        column[o] = r;
        column[o + 1] = g;
        column[o + 2] = b;
        column[o + 3] = a;
      }
    }
    target.pushColumn(column);
  }

  /** 条件が変わったので、画像を作り直し、履歴から過去の列を足し直す */
  function rebuild(history: Histories["gram"], colors: ColumnColors): StreamImage {
    const columns = visibleColumns(pixelWidth, stepPx);
    const target = new StreamImage(columns, pixelHeight);
    stream = target;
    if (column.length !== pixelHeight * 4) column = new Uint8Array(pixelHeight * 4);
    const count = Math.min(history.length, columns);
    for (let j = 0; j < count; j++) pushRow(target, history.row(history.length - count + j), colors);
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
      // 画像は次の draw で作り直す
      stream = null;
      builtKey = "";
    },

    draw(_frame: AnalysisFrame | null, histories, options, colors: PaletteColors, _dt, out) {
      if (width <= 0 || height <= 0) return;
      const history = histories.gram;
      stepPx = Math.max(1, Math.round(columnStep(options.speed) * dpr));
      const columnColors: ColumnColors = { main: resolveColor(colors.main), accent: resolveColor(colors.accent) };
      const key = `${pixelWidth}x${pixelHeight}|${stepPx}|${colors.main}|${colors.accent}`;

      let target = stream;
      if (!target || key !== builtKey) {
        builtKey = key;
        target = rebuild(history, columnColors);
      } else {
        // 前回から増えた行だけ、右端に足す
        const added = Math.min(history.total - drawnTotal, history.length, target.width);
        for (let k = 0; k < added; k++) pushRow(target, history.row(history.length - added + k), columnColors);
        drawnTotal = history.total;
      }

      // 1列を stepPx デバイスピクセルの幅で、右端（最新の列）を枠の右端にそろえて置く（左端の余りは枠の外）
      const scale = width / pixelWidth;
      const span = target.width * stepPx * scale;
      out.shapes.image(target, { x: width - span, y: 0, width: span, height });
    },

    dispose() {
      stream = null;
      builtKey = "";
    },
  };
}
