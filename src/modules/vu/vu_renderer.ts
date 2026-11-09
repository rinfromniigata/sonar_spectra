// VU メーターの描画：点の弧の目盛りと 0〜+3 の強調帯、L（主色）・R（副色）の2本の針、振れた跡の残像
// （モックの drawVU に合わせる）。方向を持たない。
//
// - 針の位置：解析の VU（dB）をそのまま使う。立ち上がりと戻りは解析側でまねてあるので、ここではならさない
//   （受信が途切れて値が読めない間だけ、目盛りの下端へ戻す）
// - 残像：消さずに地の色を薄く重ねる。目盛りと針は毎回描き直す
// - 「VU」の文言は辞書から引く（ModuleFrame が渡す translate）

import { readVu, type AnalysisFrame } from "../../frame_client";
import { setGlow } from "../canvas_helpers";
import { trailAlpha } from "../stereo/stereo_math";
import type { NoOptions } from "../options";
import type { Geometry, ModuleRenderer, PaletteColors, RenderContext } from "../types";
import {
  HOT_FROM_DB,
  HOT_TO_DB,
  LABEL_DB,
  SCALE_MIN_DB,
  TRAIL_ALPHA,
  clampDb,
  fallToFloor,
  formatScale,
  needleAngle,
  pointOnArc,
  scaleTicks,
  vuLayout,
} from "./vu_math";

const TICK_MAJOR = { size: 3, alpha: 0.9 };
const TICK_MINOR = { size: 2, alpha: 0.4 };
const HOT_ARC = { radius: 0.92, width: 3, glow: 6 };
const LABEL_DISTANCE = 1.1;
const TITLE_OFFSET = 0.35;
const NEEDLE = { length: 0.98, width: 1.4, glow: 8 };
const PIVOT_RADIUS = 3;

export function createVuRenderer({ ctx, translate }: RenderContext): ModuleRenderer<NoOptions> {
  let width = 0;
  let height = 0;
  /** 今の針の位置（dB）。L・R */
  let shown: [number, number] = [SCALE_MIN_DB, SCALE_MIN_DB];

  const titleText = () => (translate ? translate("modules.vu") : "VU");

  function drawScale(colors: PaletteColors): void {
    const layout = vuLayout(width, height);
    ctx.shadowBlur = 0;

    // 目盛りの点
    ctx.fillStyle = colors.textMuted;
    for (const { db, major } of scaleTicks()) {
      const spec = major ? TICK_MAJOR : TICK_MINOR;
      const [x, y] = pointOnArc(layout, needleAngle(db), layout.radius);
      ctx.globalAlpha = spec.alpha;
      ctx.fillRect(x - spec.size / 2, y - spec.size / 2, spec.size, spec.size);
    }
    ctx.globalAlpha = 1;

    // 0〜+3 の強調帯
    ctx.beginPath();
    ctx.arc(layout.pivotX, layout.pivotY, layout.radius * HOT_ARC.radius, needleAngle(HOT_FROM_DB), needleAngle(HOT_TO_DB));
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = HOT_ARC.width;
    setGlow(ctx, colors.accent, HOT_ARC.glow);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // 数字と「VU」
    ctx.font = `${layout.fontSize}px ${colors.fontNumeric}`;
    ctx.fillStyle = colors.textMuted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const db of LABEL_DB) {
      const [x, y] = pointOnArc(layout, needleAngle(db), layout.radius * LABEL_DISTANCE);
      ctx.fillText(formatScale(db), x, y);
    }
    ctx.fillText(titleText(), layout.pivotX, layout.pivotY - layout.radius * TITLE_OFFSET);
  }

  function drawNeedles(colors: PaletteColors): void {
    const layout = vuLayout(width, height);
    const needles: [number, string][] = [
      [shown[0], colors.main],
      [shown[1], colors.sub],
    ];
    ctx.lineWidth = NEEDLE.width;
    for (const [db, color] of needles) {
      const [x, y] = pointOnArc(layout, needleAngle(db), layout.radius * NEEDLE.length);
      ctx.beginPath();
      ctx.moveTo(layout.pivotX, layout.pivotY);
      ctx.lineTo(x, y);
      ctx.strokeStyle = color;
      setGlow(ctx, color, NEEDLE.glow);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // 根元
    ctx.fillStyle = colors.textMuted;
    ctx.beginPath();
    ctx.arc(layout.pivotX, layout.pivotY, PIVOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  return {
    resize(geometry: Geometry) {
      width = geometry.width;
      height = geometry.height;
    },

    draw(frame: AnalysisFrame | null, _histories, _options, colors, dt) {
      if (width <= 0 || height <= 0) return;
      const values = frame ? readVu(frame) : null;
      shown = values
        ? [clampDb(values.left), clampDb(values.right)]
        : [fallToFloor(shown[0], dt), fallToFloor(shown[1], dt)];

      ctx.save();
      // 残像：消さずに地の色を薄く重ねる
      ctx.shadowBlur = 0;
      ctx.fillStyle = colors.bg;
      ctx.globalAlpha = trailAlpha(TRAIL_ALPHA, dt);
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;

      drawScale(colors);
      drawNeedles(colors);
      ctx.restore();
    },

    dispose() {
      shown = [SCALE_MIN_DB, SCALE_MIN_DB];
    },
  };
}
