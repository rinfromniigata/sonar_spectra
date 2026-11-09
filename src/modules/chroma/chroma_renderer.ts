// クロマの描画：12の音名ごとの強さを円環の扇に並べる。いちばん強い音ではなく、推定したコードの根音を強調色にする。
// 中央に、今のコード（主表示）と推定したキー（副表示）を2段で出す（モックの drawChroma に合わせる）。方向を持たない。
//
// - 強さ：解析のクロマ（0.15 秒で平滑化済み）をそのまま使う。ここではならさない
//   （受信が途切れて値が読めない間だけ、0 へ時定数 0.14 秒で戻す）
// - コードとキー：解析の推定をそのまま表記する。推定できない（無音など）ときは、コードを「—」にし、キーは出さない
// - キーの文言（「キー A minor」）は辞書から引く（ModuleFrame が渡す translate）。音名とコードの記法は辞書に入れない

import { CHROMA_BINS, KeyMode, readChroma, type AnalysisFrame } from "../../frame_client";
import { setGlow } from "../canvas_helpers";
import type { NoOptions } from "../options";
import type { Geometry, ModuleRenderer, PaletteColors, RenderContext } from "../types";
import {
  GLOW_GAIN,
  LABEL_BRIGHT_ABOVE,
  NOTE_LABEL_DISTANCE,
  NO_CHORD,
  chromaLayout,
  clampStrength,
  fallToZero,
  formatChord,
  keyParts,
  labelAngle,
  noteName,
  segmentAngles,
  strengthAlpha,
  strengthRadius,
  type ChromaLayout,
} from "./chroma_math";

const CHORD_WEIGHT = 600;
const CHORD_GLOW = 8;

/** 画面に出している内容 */
interface Shown {
  strengths: Float32Array;
  /** 強調する根音。コードが推定できないときは null */
  root: number | null;
  /** 中央の主表示 */
  chord: string;
  key: { tonic: number; mode: KeyMode } | null;
}

export function createChromaRenderer({ ctx, translate }: RenderContext): ModuleRenderer<NoOptions> {
  let width = 0;
  let height = 0;
  const shown: Shown = { strengths: new Float32Array(CHROMA_BINS), root: null, chord: NO_CHORD, key: null };

  const keyText = (key: { tonic: number; mode: KeyMode }): string => {
    const { mode, tonic } = keyParts(key.tonic, key.mode);
    if (!translate) return `${tonic} ${mode}`;
    const name = mode === "minor" ? translate("modules.chroma_key_minor", { tonic }) : translate("modules.chroma_key_major", { tonic });
    return translate("modules.chroma_key", { key: name });
  };

  /** 扇の形（内側の弧と外側の弧で囲む） */
  function sectorPath(layout: ChromaLayout, n: number, outerRadius: number): void {
    const { start, end } = segmentAngles(n);
    ctx.beginPath();
    ctx.arc(layout.centerX, layout.centerY, layout.inner, start, end);
    ctx.arc(layout.centerX, layout.centerY, outerRadius, end, start, true);
    ctx.closePath();
  }

  function drawRing(layout: ChromaLayout, colors: PaletteColors): void {
    for (let n = 0; n < CHROMA_BINS; n++) {
      const strength = clampStrength(shown.strengths[n]);

      // 土台
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      sectorPath(layout, n, layout.outer);
      ctx.fillStyle = colors.grid;
      ctx.fill();

      // 強さの分（根音は強調色）
      if (strength > 0) {
        sectorPath(layout, n, strengthRadius(layout, strength));
        const color = n === shown.root ? colors.accent : colors.main;
        ctx.fillStyle = color;
        ctx.globalAlpha = strengthAlpha(strength);
        setGlow(ctx, color, GLOW_GAIN * strength);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      }
    }
  }

  function drawNoteNames(layout: ChromaLayout, colors: PaletteColors): void {
    ctx.shadowBlur = 0;
    ctx.font = `${layout.noteFont}px ${colors.fontNumeric}`;
    const distance = layout.outer * NOTE_LABEL_DISTANCE;
    for (let n = 0; n < CHROMA_BINS; n++) {
      const angle = labelAngle(n);
      ctx.fillStyle = clampStrength(shown.strengths[n]) > LABEL_BRIGHT_ABOVE ? colors.text : colors.textMuted;
      ctx.fillText(noteName(n), layout.centerX + Math.cos(angle) * distance, layout.centerY + Math.sin(angle) * distance);
    }
  }

  function drawCenter(layout: ChromaLayout, colors: PaletteColors): void {
    // 主表示：今のコード。ライトでは副色が地の色に対して 4.5:1 に届かないので、文字は文字色にして発光だけ残す（LOUD と同じ）
    const known = shown.root !== null;
    ctx.font = `${CHORD_WEIGHT} ${layout.chordFont}px ${colors.fontNumeric}`;
    ctx.fillStyle = !known ? colors.textMuted : colors.theme === "light" ? colors.text : colors.sub;
    if (known) setGlow(ctx, colors.sub, CHORD_GLOW);
    ctx.fillText(shown.chord, layout.centerX, layout.chordY);
    ctx.shadowBlur = 0;

    // 副表示：推定したキー
    if (shown.key) {
      ctx.fillStyle = colors.textMuted;
      ctx.font = `${layout.keyFont}px ${colors.fontNumeric}`;
      ctx.fillText(keyText(shown.key), layout.centerX, layout.keyY);
    }
  }

  return {
    resize(geometry: Geometry) {
      width = geometry.width;
      height = geometry.height;
    },

    draw(frame: AnalysisFrame | null, _histories, _options, colors, dt) {
      if (width <= 0 || height <= 0) return;
      const values = frame ? readChroma(frame) : null;
      if (values) {
        shown.strengths.set(values.chroma);
        shown.root = values.chord ? values.chord.root : null;
        shown.chord = values.chord ? formatChord(values.chord.root, values.chord.quality) : NO_CHORD;
        shown.key = values.key;
      } else {
        for (let n = 0; n < CHROMA_BINS; n++) shown.strengths[n] = fallToZero(shown.strengths[n], dt);
        shown.root = null;
        shown.chord = NO_CHORD;
        shown.key = null;
      }

      const layout = chromaLayout(width, height);
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      drawRing(layout, colors);
      drawNoteNames(layout, colors);
      drawCenter(layout, colors);
      ctx.restore();
    },

    dispose() {
      shown.strengths.fill(0);
      shown.root = null;
      shown.chord = NO_CHORD;
      shown.key = null;
    },
  };
}
