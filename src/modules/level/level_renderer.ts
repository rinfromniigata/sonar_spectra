// レベルメーターの描画：L・R の2本のバーと、dB の目盛り、ピークの保持。
// 常に既定の向き（上へ伸びる）で描く。向きの回転は ModuleFrame が座標系ごと行う。

import { readLevel, type AnalysisFrame } from "../../frame_client";
import type { Geometry, ModuleRenderer, PaletteColors, RenderContext } from "../types";
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

    draw(frame: AnalysisFrame | null, _histories, _options, colors: PaletteColors, dt: number) {
      if (width <= 0 || height <= 0) return;
      const layout = levelLayout(width, height);
      const values = frame ? readLevel(frame) : null;
      const levels: [number, number] = values ? [toDb(values.peakL), toDb(values.peakR)] : [DB_FLOOR, DB_FLOOR];

      ctx.clearRect(0, 0, width, height);
      ctx.save();

      // 目盛り：数字と、バーのほうへ伸びる細い線
      ctx.font = `${layout.tickFontSize}px ${colors.fontNumeric}`;
      for (const db of TICK_DB) {
        const y = yOfDb(layout, db);
        ctx.fillStyle = colors.textMuted;
        ctx.fillText(String(db), layout.labelX, y + 3);
        ctx.fillStyle = colors.grid;
        ctx.fillRect(layout.gridX, y, layout.gridWidth, 1);
      }

      // バー：L が主色、R が副色。上端の 10% は強調色
      const barColors = [colors.main, colors.sub] as const;
      for (const channel of [0, 1] as const) {
        held[channel] = updatePeakHold(held[channel], levels[channel], dt);
        const x = barLeft(layout, channel);

        ctx.fillStyle = colors.grid;
        ctx.fillRect(x, layout.top, layout.barWidth, layout.span);

        const y = yOfDb(layout, levels[channel]);
        if (layout.bottom - y > 0) {
          const color = barColors[channel];
          const gradient = ctx.createLinearGradient(0, layout.bottom, 0, layout.top);
          gradient.addColorStop(0, color);
          gradient.addColorStop(HOT_ZONE_START, color);
          gradient.addColorStop(HOT_ZONE_END, colors.accent);
          ctx.globalAlpha = BAR_ALPHA;
          ctx.shadowColor = color;
          ctx.shadowBlur = BAR_GLOW;
          ctx.fillStyle = gradient;
          ctx.fillRect(x, y, layout.barWidth, layout.bottom - y);
          ctx.shadowBlur = 0;
          ctx.globalAlpha = 1;
        }

        ctx.fillStyle = colors.accent;
        ctx.fillRect(x, yOfDb(layout, held[channel]) - 1, layout.barWidth, PEAK_MARK_HEIGHT);
      }

      // 下端の文字
      ctx.fillStyle = colors.textMuted;
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
