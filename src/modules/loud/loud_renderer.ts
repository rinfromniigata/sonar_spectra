// LOUD の描画：中央に「LOUD」の単位・ラウドネスの数値・ピーク、下端に24本のバー（モックの drawLoud と .loud-read に合わせる）。
// 方向を持たない。モックでは数値を HTML の文字で重ねているが、実装では Canvas に描く（枠の回転と一緒に動かす必要はなく、
// 描画ループ1本で更新できるため）。
//
// - 数値：ショートターム（3秒）。0.25秒ごとにしか更新しない（読めなくならないように）。ダークでは副色（モックの neon-b）、
//   大きすぎる（−8.6 を超える）と強調色。ライトでは、小さな文字のコントラストが足りないので文字色にする（SPEC 9節）
// - バー：モーメンタリ（0.4秒）。−30〜0 dB に24本。上の2割は強調色
// - 単位とピークの文言は辞書から引く（ModuleFrame が渡す translate）

import { LOUDNESS_FLOOR_DB, readLoudness, type AnalysisFrame } from "../../frame_client";
import { setGlow } from "../canvas_helpers";
import type { NoOptions } from "../options";
import type { Geometry, ModuleRenderer, PaletteColors, RenderContext } from "../types";
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

  function drawBars(colors: PaletteColors, momentary: number): void {
    const { bars } = loudLayout(width, height);
    const level = barLevel(momentary);
    ctx.shadowBlur = 0;
    for (let i = 0; i < BAR_COUNT; i++) {
      const lit = barLit(i, level);
      ctx.fillStyle = !lit ? colors.grid : barHot(i) ? colors.accent : colors.sub;
      ctx.globalAlpha = lit ? BAR_ON_ALPHA : 1;
      ctx.fillRect(i * bars.barWidth + 1, bars.top, bars.barWidth - 2, bars.height);
    }
    ctx.globalAlpha = 1;
  }

  function drawReading(colors: PaletteColors, reading: LoudReading): void {
    const layout = loudLayout(width, height);
    const hot = isHot(reading.shortTerm);
    const accent = hot ? colors.accent : colors.sub;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowBlur = 0;

    // 単位
    ctx.fillStyle = colors.textMuted;
    ctx.font = `${layout.unit.size}px ${colors.fontNumeric}`;
    ctx.fillText(unitText(), layout.centerX, layout.unit.y, layout.maxWidth);

    // 数値。ライトでは副色・強調色が地の色に対して 4.5:1 に届かないので、文字は文字色にして発光だけ残す
    ctx.font = `${VALUE_WEIGHT} ${layout.value.size}px ${colors.fontNumeric}`;
    ctx.fillStyle = colors.theme === "light" ? colors.text : accent;
    setGlow(ctx, accent, hot ? VALUE_GLOW_HOT : VALUE_GLOW);
    ctx.fillText(formatDb(reading.shortTerm), layout.centerX, layout.value.y, layout.maxWidth);
    ctx.shadowBlur = 0;

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

    draw(frame: AnalysisFrame | null, _histories, _options, colors, dt) {
      if (width <= 0 || height <= 0) return;
      const values = frame ? readLoudness(frame) : null;
      const latest: LoudReading = values
        ? { shortTerm: values.shortTerm, momentary: values.momentary, peak: values.peak }
        : SILENT;
      const shown = throttle.update(latest, dt);

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      // バーは更新を間引かず、そのときのモーメンタリで動かす。数値とピークだけ間引く
      drawBars(colors, latest.momentary);
      drawReading(colors, shown);
      ctx.restore();
    },

    dispose() {
      throttle.reset();
    },
  };
}
