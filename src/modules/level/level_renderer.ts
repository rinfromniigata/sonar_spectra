// レベルメーターの描画：L・R の2本のバーと、dB の目盛り、ピークの保持。
// 常に既定の向き（上へ伸びる）で描く。向きの回転は ModuleFrame が座標系ごと行う。
// 図形（目盛りの線・バー・ピーク）は描画の層（ShapeSink）へ出し、発光は図形の発光の値で描画の層がつける（imple 4.2）。
// 目盛りの数字と L・R は文字の層に描く。

import { readLevel, type AnalysisFrame } from "../../frame_client";
import type { DrawOutput, Geometry, ModuleRenderer, PaletteColors, RenderContext } from "../types";
import type { NoOptions } from "../options";
import {
  DB_FLOOR,
  TICK_DB,
  barLeft,
  levelLayout,
  toDb,
  updatePeakHold,
  yOfDb,
} from "./level_math";

/** バーの塗りの不透明度と発光の大きさ（モックの値） */
const BAR_ALPHA = 0.55;
const BAR_GLOW = 3;
/** バーの上端の何割を強調色にするか（0 dB 付近の注意） */
const HOT_ZONE_START = 0.85;
const HOT_ZONE_END = 0.9;
const PEAK_MARK_HEIGHT = 2;

export function createLevelRenderer({ ctx }: RenderContext): ModuleRenderer<NoOptions> {
  let width = 0;
  let height = 0;
  /** L・R のピークの保持（dB） */
  const held: [number, number] = [DB_FLOOR, DB_FLOOR];

  return {
    resize(geometry: Geometry) {
      width = geometry.width;
      height = geometry.height;
    },

    draw(frame: AnalysisFrame | null, _histories, _options, colors: PaletteColors, dt: number, out: DrawOutput) {
      if (width <= 0 || height <= 0) return;
      const { shapes } = out;
      const layout = levelLayout(width, height);
      const values = frame ? readLevel(frame) : null;
      const levels: [number, number] = values ? [toDb(values.peakL), toDb(values.peakR)] : [DB_FLOOR, DB_FLOOR];

      ctx.clearRect(0, 0, width, height);
      ctx.save();

      // 目盛り：数字と、バーのほうへ伸びる細い線
      ctx.font = `${layout.tickFontSize}px ${colors.fontNumeric}`;
      ctx.fillStyle = colors.textMuted;
      const ticks = new Float32Array(TICK_DB.length * 4);
      TICK_DB.forEach((db, i) => {
        const y = yOfDb(layout, db);
        ctx.fillText(String(db), layout.labelX, y + 3);
        ticks.set([layout.gridX, y, layout.gridWidth, 1], i * 4);
      });
      shapes.rects(ticks, { color: colors.grid });

      // バー：L が主色、R が副色。上端の 10% は強調色。発光はバーの色（移行前の shadowColor と同じ）
      const barColors = [colors.main, colors.sub] as const;
      for (const channel of [0, 1] as const) {
        held[channel] = updatePeakHold(held[channel], levels[channel], dt);
        const x = barLeft(layout, channel);

        shapes.rects([x, layout.top, layout.barWidth, layout.span], { color: colors.grid });

        const y = yOfDb(layout, levels[channel]);
        if (layout.bottom - y > 0) {
          const color = barColors[channel];
          const bar = [x, y, layout.barWidth, layout.bottom - y];
          shapes.rects(bar, { color, alpha: BAR_ALPHA, glow: BAR_GLOW, glowOnly: true });
          shapes.rects(bar, {
            color: {
              kind: "linear",
              x0: 0,
              y0: layout.bottom,
              x1: 0,
              y1: layout.top,
              stops: [
                { offset: 0, color },
                { offset: HOT_ZONE_START, color },
                { offset: HOT_ZONE_END, color: colors.accent },
              ],
            },
            alpha: BAR_ALPHA,
          });
        }

        shapes.rects([x, yOfDb(layout, held[channel]) - 1, layout.barWidth, PEAK_MARK_HEIGHT], { color: colors.accent });
      }

      // 下端の文字
      ctx.fillText("L", barLeft(layout, 0) + layout.barWidth / 2 - 3, layout.labelBaseline);
      ctx.fillText("R", barLeft(layout, 1) + layout.barWidth / 2 - 3, layout.labelBaseline);

      ctx.restore();
    },

    dispose() {
      held[0] = DB_FLOOR;
      held[1] = DB_FLOOR;
    },
  };
}
