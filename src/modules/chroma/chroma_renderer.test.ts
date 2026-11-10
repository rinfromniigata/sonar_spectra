import { describe, expect, it } from "vitest";
import { ChordQuality, CHROMA_BINS, FrameClient, KeyMode, SectionId } from "../../frame_client";
import { encodeTestFrame } from "../../frame_client/test_frames";
import type { Translate } from "../../i18n/use_t";
import { recordingCanvas } from "../test_canvas";
import type { PaletteColors } from "../types";
import { chromaModule } from "./index";
import { GLOW_GAIN, chromaLayout, segmentAngles, strengthAlpha, strengthRadius } from "./chroma_math";
import { pairs, recordingShapeSink, testDrawOutput, type RecordedShape } from "../test_shapes";

const COLORS: PaletteColors = {
  main: "MAIN",
  sub: "SUB",
  accent: "ACCENT",
  bg: "BG",
  grid: "GRID",
  line: "LINE",
  text: "TEXT",
  textMuted: "MUTED",
  danger: "DANGER",
  fontNumeric: "NUMERIC",
  theme: "dark",
};
const WIDTH = 200;
const HEIGHT = 200;
const DT = 1 / 60;
const layout = chromaLayout(WIDTH, HEIGHT);

/** 辞書の代わり：キーと引数をそのまま文字列にする */
const translate = ((key: string, params?: Record<string, string>) =>
  params ? `${key}(${Object.values(params).join(",")})` : key) as unknown as Translate;

interface Reading {
  strengths?: number[];
  /** [根音, 種類]。null なら推定できない（−1） */
  chord?: [number, ChordQuality] | null;
  key?: [number, KeyMode] | null;
}

function payload({ strengths = Array(CHROMA_BINS).fill(0), chord = null, key = null }: Reading): number[] {
  return [...strengths, ...(chord ?? [-1, -1]), ...(key ?? [-1, -1])];
}

function setup(theme: "dark" | "light" = "dark", withTranslate = true) {
  const canvas = recordingCanvas();
  const recording = recordingShapeSink();
  const renderer = chromaModule.createRenderer({ ctx: canvas.ctx, translate: withTranslate ? translate : undefined });
  renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
  const client = new FrameClient();
  let seq = 0;
  const colors = { ...COLORS, theme };
  const draw = (reading: Reading | null, dt = DT) => {
    canvas.clear();
    recording.clear();
    if (reading) client.receive(encodeTestFrame({ seq: seq++, sections: [[SectionId.Chroma, payload(reading)]] }));
    renderer.draw(reading ? client.latest : null, client.histories, {}, colors, dt, testDrawOutput(canvas.ctx, recording));
  };
  return { canvas, recording, renderer, draw };
}

interface Sector {
  style: string;
  alpha: number;
  glow: number;
  inner: number;
  outer: number;
  /** 弧の始点と終点の角度 */
  start: number;
  end: number;
}

/** 描画の層に出した扇（真ん中の半径の弧を、太さ＝外半径−内半径で引いた線）を、描いた順に読む */
function sectors(shapes: RecordedShape[]): Sector[] {
  return shapes.flatMap((shape) => {
    if (shape.op !== "polyline") return [];
    const points = pairs(shape.points);
    const [x0, y0] = points[0];
    const [x1, y1] = points[points.length - 1];
    const mid = Math.hypot(x0 - layout.centerX, y0 - layout.centerY);
    return [
      {
        style: String(shape.style.color),
        alpha: shape.style.alpha ?? 1,
        glow: shape.style.glow ?? 0,
        inner: mid - shape.style.width / 2,
        outer: mid + shape.style.width / 2,
        start: Math.atan2(y0 - layout.centerY, x0 - layout.centerX),
        end: Math.atan2(y1 - layout.centerY, x1 - layout.centerX),
      },
    ];
  });
}
const filled = (shapes: RecordedShape[]) => sectors(shapes).filter((s) => s.style !== "GRID");

const strengthsOf = (hot: Record<number, number>) => Array.from({ length: CHROMA_BINS }, (_, n) => hot[n] ?? 0);

describe("chroma モジュールの定義", () => {
  it("クロマのセクションを読み、方向を持たない。設定項目はなく、初期状態は無効", () => {
    expect(chromaModule.kind).toBe("chroma");
    expect(chromaModule.labelKey).toBe("modules.chroma");
    expect(chromaModule.sections).toEqual([SectionId.Chroma]);
    expect(chromaModule.shape).toBe("compact");
    expect(chromaModule.baseDirection).toBeNull();
    expect(chromaModule.flows).toBe(false);
    expect(chromaModule.defaultOptions).toEqual({});
    expect(chromaModule.inspectorFields).toEqual([]);
    expect(chromaModule.defaultInstances).toEqual([{ enabled: false }]);
  });
});

describe("chroma モジュールの描画：円環", () => {
  it("12個の土台（グリッド色）を描く。強さが 0 の音名には強さの分を描かない", () => {
    const { canvas, recording, draw } = setup();
    draw({});
    const fills = sectors(recording.shapes);
    expect(fills).toHaveLength(CHROMA_BINS);
    expect(fills.every((s) => s.style === "GRID" && s.alpha === 1 && s.glow === 0)).toBe(true);
    // 土台は内半径から外半径まで、音名の扇の角度（C が真上）
    for (const [n, s] of fills.entries()) {
      expect(s.inner).toBeCloseTo(layout.inner, 3);
      expect(s.outer).toBeCloseTo(layout.outer, 3);
      const { start, end } = segmentAngles(n);
      expect(Math.cos(s.start)).toBeCloseTo(Math.cos(start), 4);
      expect(Math.sin(s.start)).toBeCloseTo(Math.sin(start), 4);
      expect(Math.cos(s.end)).toBeCloseTo(Math.cos(end), 4);
      expect(Math.sin(s.end)).toBeCloseTo(Math.sin(end), 4);
    }
    // 図形は文字の層に描かない
    expect(canvas.shapes).toHaveLength(0);
    expect(canvas.ctx.shadowBlur).toBe(0);
  });

  it("強さのある音名は主色で、強さに応じた半径と不透明度。コードの根音だけ強調色", () => {
    const { recording, draw } = setup();
    draw({ strengths: strengthsOf({ 9: 1, 0: 0.6, 4: 0.5 }), chord: [9, ChordQuality.Minor] });
    const fills = sectors(recording.shapes);
    expect(fills).toHaveLength(CHROMA_BINS + 3);
    // 音名の順（C・E・A）に、それぞれの土台のすぐあとに強さの分を描く
    expect(fills.map((s) => s.style).slice(0, 2)).toEqual(["GRID", "MAIN"]);
    const [c, e, a] = filled(recording.shapes);
    expect([c.style, e.style, a.style]).toEqual(["MAIN", "MAIN", "ACCENT"]);
    expect(c.alpha).toBeCloseTo(strengthAlpha(0.6), 6); // 受信で float32 になる
    expect(a.alpha).toBeCloseTo(1, 10);
    // 発光は強さに比例し、色は扇の色
    expect(c.glow).toBeCloseTo(GLOW_GAIN * 0.6, 5);
    expect(a.glow).toBeCloseTo(GLOW_GAIN, 5);
    // 強さの分は内半径から、強さに応じた外半径まで
    for (const [sector, strength] of [
      [c, 0.6],
      [e, 0.5],
      [a, 1],
    ] as const) {
      expect(sector.inner).toBeCloseTo(layout.inner, 3);
      expect(sector.outer).toBeCloseTo(strengthRadius(layout, strength), 3);
    }
  });

  it("いちばん強い音ではなく、コードの根音を強調する（コードがなければ強調なし）", () => {
    const { recording, draw } = setup();
    draw({ strengths: strengthsOf({ 9: 0.4, 7: 0.9 }), chord: [9, ChordQuality.Minor] });
    // 描く順は音名順：G（いちばん強いが根音ではない）、A（根音）
    expect(filled(recording.shapes).map((s) => s.style)).toEqual(["MAIN", "ACCENT"]);

    const none = setup();
    none.draw({ strengths: strengthsOf({ 9: 0.4, 7: 0.9 }), chord: null });
    expect(filled(none.recording.shapes).map((s) => s.style)).toEqual(["MAIN", "MAIN"]);
  });

  it("音名の文字：強さが 0.5 を超えたら文字色、それ以外は控えめな色", () => {
    const { canvas, draw } = setup();
    draw({ strengths: strengthsOf({ 9: 0.8, 0: 0.5 }) });
    const names = canvas.texts.slice(0, CHROMA_BINS);
    expect(names.map((t) => t.text)).toEqual(["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"]);
    expect(names.find((t) => t.text === "A")?.style).toBe("TEXT");
    expect(names.find((t) => t.text === "C")?.style).toBe("MUTED"); // ちょうど 0.5 は超えていない
    // 真上の C は中心の真上、外半径の 1.14 倍
    const c = names[0];
    expect(c.x).toBeCloseTo(layout.centerX, 8);
    expect(c.y).toBeCloseTo(layout.centerY - layout.outer * 1.14, 8);
  });
});

describe("chroma モジュールの描画：中央のコードとキー", () => {
  it("コードの発光は描画の層に敷かせる（副色・値 8。文字と同じ書体・位置・揃え方）。ライトでも発光は副色", () => {
    for (const theme of ["dark", "light"] as const) {
      const { recording, draw } = setup(theme);
      draw({ chord: [9, ChordQuality.Minor], key: [9, KeyMode.Minor] });
      expect(recording.shapes.filter((s) => s.op === "textGlow")).toEqual([
        {
          op: "textGlow",
          text: "Am",
          x: layout.centerX,
          y: layout.chordY,
          style: { font: `600 ${layout.chordFont}px NUMERIC`, align: "center", baseline: "middle", color: "SUB", glow: 8 },
        },
      ]);
    }
  });

  it("コードが推定できないときは、発光を敷かない", () => {
    const { recording, draw } = setup();
    draw({ chord: null, key: [2, KeyMode.Major] });
    expect(recording.shapes.filter((s) => s.op === "textGlow")).toHaveLength(0);
  });

  it("今のコードを副色で大きく、キーを控えめな色で小さく、辞書を通して出す", () => {
    const { canvas, draw } = setup();
    draw({ chord: [9, ChordQuality.Minor], key: [9, KeyMode.Minor] });
    const [chord, key] = canvas.texts.slice(CHROMA_BINS);
    expect(chord).toMatchObject({ text: "Am", style: "SUB", x: layout.centerX, y: layout.chordY });
    expect(chord.font).toBe(`600 ${layout.chordFont}px NUMERIC`);
    expect(key).toMatchObject({ text: "modules.chroma_key(modules.chroma_key_minor(A))", style: "MUTED", x: layout.centerX, y: layout.keyY });
    expect(key.font).toBe(`${layout.keyFont}px NUMERIC`);
    // 文言が伸びても円環にかからないよう、幅の上限を付けて描く（疑似ロケールの確認で見つかった崩れ）
    expect(key.maxWidth).toBeCloseTo(layout.keyMaxWidth, 10);
  });

  it("長調のキーは長調の文言を引く", () => {
    const { canvas, draw } = setup();
    draw({ chord: [0, ChordQuality.Major], key: [0, KeyMode.Major] });
    const [chord, key] = canvas.texts.slice(CHROMA_BINS);
    expect(chord.text).toBe("C");
    expect(key.text).toBe("modules.chroma_key(modules.chroma_key_major(C))");
  });

  it("ライトでは、コードの文字は副色ではなく文字色（コントラストのため）", () => {
    const { canvas, draw } = setup("light");
    draw({ chord: [9, ChordQuality.Minor], key: null });
    expect(canvas.texts[CHROMA_BINS].style).toBe("TEXT");
  });

  it("コードが推定できないときは「—」を控えめな色で出し、キーが推定できなければ出さない", () => {
    const { canvas, draw } = setup();
    draw({ chord: null, key: null });
    const rest = canvas.texts.slice(CHROMA_BINS);
    expect(rest).toHaveLength(1);
    expect(rest[0]).toMatchObject({ text: "—", style: "MUTED" });
  });

  it("キーだけ推定できているときは、コードは「—」でキーは出す", () => {
    const { canvas, draw } = setup();
    draw({ chord: null, key: [2, KeyMode.Major] });
    const rest = canvas.texts.slice(CHROMA_BINS);
    expect(rest.map((t) => t.text)).toEqual(["—", "modules.chroma_key(modules.chroma_key_major(D))"]);
  });

  it("辞書が渡されなければ、キーは「A minor」の形（落ちない）", () => {
    const { canvas, draw } = setup("dark", false);
    draw({ chord: [9, ChordQuality.Minor], key: [9, KeyMode.Minor] });
    expect(canvas.texts[CHROMA_BINS + 1].text).toBe("A minor");
  });
});

describe("chroma モジュールの描画：受信が途切れたとき", () => {
  it("届いていないときは、強さが 0 へ戻っていき（急には消えない）、コードは「—」になる", () => {
    const { canvas, recording, draw } = setup();
    draw({ strengths: strengthsOf({ 0: 1 }), chord: [0, ChordQuality.Major], key: [0, KeyMode.Major] });

    draw(null);
    const afterOne = filled(recording.shapes);
    expect(afterOne).toHaveLength(1);
    expect(afterOne[0].style).toBe("MAIN"); // 根音の強調は外れる
    expect(afterOne[0].alpha).toBeLessThan(1);
    expect(afterOne[0].alpha).toBeGreaterThan(strengthAlpha(0));
    expect(canvas.texts[CHROMA_BINS].text).toBe("—");
    expect(canvas.texts).toHaveLength(CHROMA_BINS + 1);

    for (let i = 0; i < 600; i++) draw(null);
    const settled = filled(recording.shapes);
    expect(settled.every((s) => Math.abs(s.alpha - strengthAlpha(0)) < 1e-6)).toBe(true);
  });

  it("dispose すると強さは 0、コードは「—」に戻る。大きさが 0 なら何も描かない", () => {
    const { canvas, recording, draw, renderer } = setup();
    draw({ strengths: strengthsOf({ 0: 1 }), chord: [0, ChordQuality.Major] });
    renderer.dispose();
    draw(null, 0);
    expect(sectors(recording.shapes)).toHaveLength(CHROMA_BINS);
    expect(canvas.texts[CHROMA_BINS].text).toBe("—");

    renderer.resize({ width: 0, height: 0, devicePixelRatio: 1, quarterTurns: 0 });
    canvas.clear();
    recording.clear();
    renderer.draw(null, new FrameClient().histories, {}, COLORS, DT, testDrawOutput(canvas.ctx, recording));
    expect(canvas.shapes).toHaveLength(0);
    expect(recording.shapes).toHaveLength(0);
  });
});
