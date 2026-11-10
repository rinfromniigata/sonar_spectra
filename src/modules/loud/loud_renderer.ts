// LOUD の描画：中央に「LOUD」の単位・ラウドネスの数値・ピーク、下端に24本のバー（モックの drawLoud と .loud-read に合わせる）。
// 方向を持たない。モックでは数値を HTML の文字で重ねているが、実装では Canvas に描く（枠の回転と一緒に動かす必要はなく、
// 描画ループ1本で更新できるため）。
//
// - 数値：ショートターム（3秒）。0.25秒ごとにしか更新しない（読めなくならないように）。ダークでは副色（モックの neon-b）、
//   大きすぎる（−8.6 を超える）と強調色。ライトでは、小さな文字のコントラストが足りないので文字色にする（SPEC 9節）
// - バー：モーメンタリ（0.4秒）。−30〜0 dB に24本。上の2割は強調色
// - 単位とピークの文言は辞書から引く（ModuleFrame が渡す translate）
// - バーは描画の層（ShapeSink）へ出す。文字は文字の層に描き、数値の発光は描画の層に敷かせる（ShapeSink.textGlow）

import { LOUDNESS_FLOOR_DB, readLoudness, type AnalysisFrame } from "../../frame_client";
import type { NoOptions } from "../options";
import type { Geometry, ModuleRenderer, PaletteColors, RenderContext, ShapeSink } from "../types";
import { BAR_COUNT, ReadingThrottle, barHot, barLevel, barLit, formatDb, isHot, loudLayout, type LoudReading } from "./loud_math";

const BAR_ON_ALPHA = 0.9;
const VALUE_GLOW = 12;
const VALUE_GLOW_HOT = 10;
const VALUE_WEIGHT = 600;

/** 計算できない（フレームがまだない・セクションが読めない）ときの値 */
const SILENT: LoudReading = { shortTerm: LOUDNESS_FLOOR_DB, momentary: LOUDNESS_FLOOR_DB, peak: LOUDNESS_FLOOR_DB };

export function createLoudRenderer({ ctx, translate }: RenderContext): ModuleRenderer<NoOptions> {
  let width = 0;
  let height = 0;
  const throttle = new ReadingThrottle();

  const unitText = () => (translate ? translate("modules.loudness_unit") : "LOUD");
  const peakText = (value: string) => (translate ? translate("modules.loudness_peak", { value }) : value);

  // バーの四角（消えている・点いている・点いている強調の3つに分ける。バーは重ならないので、描く順は変えてよい）
  const offRects = new Float32Array(BAR_COUNT * 4);
  const onRects = new Float32Array(BAR_COUNT * 4);
  const hotRects = new Float32Array(BAR_COUNT * 4);

  function drawBars(shapes: ShapeSink, colors: PaletteColors, momentary: number): void {
    const { bars } = loudLayout(width, height);
    const level = barLevel(momentary);
    let off = 0;
    let on = 0;
    let hot = 0;
    for (let i = 0; i < BAR_COUNT; i++) {
      const rect = [i * bars.barWidth + 1, bars.top, bars.barWidth - 2, bars.height];
      if (!barLit(i, level)) offRects.set(rect, 4 * off++);
      else if (barHot(i)) hotRects.set(rect, 4 * hot++);
      else onRects.set(rect, 4 * on++);
    }
    if (off > 0) shapes.rects(offRects.subarray(0, 4 * off), { color: colors.grid });
    if (on > 0) shapes.rects(onRects.subarray(0, 4 * on), { color: colors.sub, alpha: BAR_ON_ALPHA });
    if (hot > 0) shapes.rects(hotRects.subarray(0, 4 * hot), { color: colors.accent, alpha: BAR_ON_ALPHA });
  }

  function drawReading(shapes: ShapeSink, colors: PaletteColors, reading: LoudReading): void {
    const layout = loudLayout(width, height);
    const hot = isHot(reading.shortTerm);
    const accent = hot ? colors.accent : colors.sub;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    // 単位
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${layout.unit.size}px ${colors.fontNumeric}`;
    ctx.fillText(unitText(), layout.centerX, layout.unit.y, layout.maxWidth);

    // 数値。ライトでは副色・強調色が地の色に対して 4.5:1 に届かないので、文字は文字色にして発光だけ残す
    const value = formatDb(reading.shortTerm);
    const font = `${VALUE_WEIGHT} ${layout.value.size}px ${colors.fontNumeric}`;
    shapes.textGlow(value, layout.centerX, layout.value.y, {
      font,
      align: "center",
      baseline: "middle",
      maxWidth: layout.maxWidth,
      color: accent,
      glow: hot ? VALUE_GLOW_HOT : VALUE_GLOW,
    });
    ctx.font = font;
    ctx.fillStyle = colors.theme === "light" ? colors.text : accent;
    ctx.fillText(value, layout.centerX, layout.value.y, layout.maxWidth);

    // ピーク
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${layout.sub.size}px ${colors.fontNumeric}`;
    ctx.fillText(peakText(formatDb(reading.peak)), layout.centerX, layout.sub.y, layout.maxWidth);
  }

  return {
    resize(geometry: Geometry) {
      width = geometry.width;
      height = geometry.height;
    },

    draw(frame: AnalysisFrame | null, _histories, _options, colors, dt, out) {
      if (width <= 0 || height <= 0) return;
      const values = frame ? readLoudness(frame) : null;
      const latest: LoudReading = values
        ? { shortTerm: values.shortTerm, momentary: values.momentary, peak: values.peak }
        : SILENT;
      const shown = throttle.update(latest, dt);

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      // バーは更新を間引かず、そのときのモーメンタリで動かす。数値とピークだけ間引く
      drawBars(out.shapes, colors, latest.momentary);
      drawReading(out.shapes, colors, shown);
      ctx.restore();
    },

    dispose() {
      throttle.reset();
    },
  };
}
