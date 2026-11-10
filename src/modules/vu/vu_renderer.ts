// VU メーターの描画：点の弧の目盛りと 0〜+3 の強調帯、L（主色）・R（副色）の2本の針、振れた跡の残像
// （モックの drawVU に合わせる）。方向を持たない。
//
// - 針の位置：解析の VU（dB）をそのまま使う。立ち上がりと戻りは解析側でまねてあるので、ここではならさない
//   （受信が途切れて値が読めない間だけ、目盛りの下端へ戻す）
// - 残像：消さずに地の色を薄く重ねる（ShapeSink.trail。描画の層が枠の画像に残す）。目盛りと針は毎回描き直す
// - 図形は描画の層（ShapeSink）へ出し、発光は図形の発光の値で描画の層がつける（imple 4.2）。数字と見出しは文字の層に描く
//   （文字の層は残像を持たないので、毎回消して描く。毎回同じ位置に重ねていた移行前の見え方と同じく、濃さは一定）
// - 「VU」の文言は辞書から引く（ModuleFrame が渡す translate）

import { readVu, type AnalysisFrame } from "../../frame_client";
import { arcPoints } from "../shape_helpers";
import { trailAlpha } from "../stereo/stereo_math";
import type { NoOptions } from "../options";
import type { Geometry, ModuleRenderer, PaletteColors, RenderContext, ShapeSink } from "../types";
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

  const ticks = scaleTicks();
  const tickRects = new Float32Array(ticks.length * 4);
  const tickAlphas = Float32Array.from(ticks, ({ major }) => (major ? TICK_MAJOR : TICK_MINOR).alpha);

  function drawScale(shapes: ShapeSink, colors: PaletteColors): void {
    const layout = vuLayout(width, height);

    // 目盛りの点
    ticks.forEach(({ db, major }, i) => {
      const { size } = major ? TICK_MAJOR : TICK_MINOR;
      const [x, y] = pointOnArc(layout, needleAngle(db), layout.radius);
      tickRects.set([x - size / 2, y - size / 2, size, size], i * 4);
    });
    shapes.rects(tickRects, { color: colors.textMuted }, tickAlphas);

    // 0〜+3 の強調帯
    shapes.polyline(arcPoints(layout.pivotX, layout.pivotY, layout.radius * HOT_ARC.radius, needleAngle(HOT_FROM_DB), needleAngle(HOT_TO_DB)), {
      color: colors.accent,
      width: HOT_ARC.width,
      glow: HOT_ARC.glow,
    });

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

  function drawNeedles(shapes: ShapeSink, colors: PaletteColors): void {
    const layout = vuLayout(width, height);
    const needles: [number, string][] = [
      [shown[0], colors.main],
      [shown[1], colors.sub],
    ];
    for (const [db, color] of needles) {
      const [x, y] = pointOnArc(layout, needleAngle(db), layout.radius * NEEDLE.length);
      shapes.polyline([layout.pivotX, layout.pivotY, x, y], { color, width: NEEDLE.width, glow: NEEDLE.glow });
    }

    // 根元
    shapes.points([layout.pivotX, layout.pivotY], PIVOT_RADIUS, { color: colors.textMuted });
  }

  return {
    resize(geometry: Geometry) {
      width = geometry.width;
      height = geometry.height;
    },

    draw(frame: AnalysisFrame | null, _histories, _options, colors, dt, out) {
      if (width <= 0 || height <= 0) return;
      const values = frame ? readVu(frame) : null;
      shown = values
        ? [clampDb(values.left), clampDb(values.right)]
        : [fallToFloor(shown[0], dt), fallToFloor(shown[1], dt)];

      const { shapes } = out;
      // 残像：前の回の絵に、地の色を薄く重ねる
      shapes.trail(colors.bg, trailAlpha(TRAIL_ALPHA, dt));
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      drawScale(shapes, colors);
      drawNeedles(shapes, colors);
      ctx.restore();
    },

    dispose() {
      shown = [SCALE_MIN_DB, SCALE_MIN_DB];
    },
  };
}
