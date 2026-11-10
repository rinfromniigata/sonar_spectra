import { describe, expect, it } from "vitest";
import { ChordQuality, CHROMA_BINS, FrameClient, KeyMode, SectionId } from "../../frame_client";
import { encodeTestFrame } from "../../frame_client/test_frames";
import type { Translate } from "../../i18n/use_t";
import { recordingCanvas } from "../test_canvas";
import type { PaletteColors } from "../types";
import { chromaModule } from "./index";
import { chromaLayout, strengthAlpha, strengthRadius } from "./chroma_math";

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
  const renderer = chromaModule.createRenderer({ ctx: canvas.ctx, translate: withTranslate ? translate : undefined });
  renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
  const client = new FrameClient();
  let seq = 0;
  const colors = { ...COLORS, theme };
  const draw = (reading: Reading | null, dt = DT) => {
    canvas.clear();
    if (reading) client.receive(encodeTestFrame({ seq: seq++, sections: [[SectionId.Chroma, payload(reading)]] }));
    renderer.draw(reading ? client.latest : null, client.histories, {}, colors, dt);
  };
  return { canvas, renderer, draw };
}

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
    const { canvas, draw } = setup();
    draw({});
    const fills = canvas.shapes.filter((s) => s.op === "fill");
    expect(fills).toHaveLength(CHROMA_BINS);
    expect(fills.every((s) => s.style === "GRID" && s.alpha === 1)).toBe(true);
    // 土台の弧は内半径と外半径
    expect(canvas.arcs.filter((a) => a.radius === layout.inner)).toHaveLength(CHROMA_BINS);
    expect(canvas.arcs.filter((a) => a.radius === layout.outer)).toHaveLength(CHROMA_BINS);
  });

  it("強さのある音名は主色で、強さに応じた半径と不透明度。コードの根音だけ強調色", () => {
    const { canvas, draw } = setup();
    draw({ strengths: strengthsOf({ 9: 1, 0: 0.6, 4: 0.5 }), chord: [9, ChordQuality.Minor] });
    const fills = canvas.shapes.filter((s) => s.op === "fill");
    expect(fills).toHaveLength(CHROMA_BINS + 3);
    // 音名の順（C・E・A）に、土台のあとに強さの分を描く
    const [c, e, a] = fills.filter((s) => s.style !== "GRID");
    expect([c.style, e.style, a.style]).toEqual(["MAIN", "MAIN", "ACCENT"]);
    expect(c.alpha).toBeCloseTo(strengthAlpha(0.6), 6); // 受信で float32 になる
    expect(a.alpha).toBeCloseTo(1, 10);
    // 強さの分の弧の外半径
    const radii = canvas.arcs.map((x) => x.radius);
    for (const strength of [0.6, 0.5, 1]) {
      expect(radii.some((r) => Math.abs(r - strengthRadius(layout, strength)) < 1e-5)).toBe(true);
    }
  });

  it("いちばん強い音ではなく、コードの根音を強調する（コードがなければ強調なし）", () => {
    const { canvas, draw } = setup();
    draw({ strengths: strengthsOf({ 9: 0.4, 7: 0.9 }), chord: [9, ChordQuality.Minor] });
    const filled = canvas.shapes.filter((s) => s.op === "fill" && s.style !== "GRID");
    // 描く順は音名順：G（いちばん強いが根音ではない）、A（根音）
    expect(filled.map((s) => s.style)).toEqual(["MAIN", "ACCENT"]);

    const none = setup();
    none.draw({ strengths: strengthsOf({ 9: 0.4, 7: 0.9 }), chord: null });
    expect(none.canvas.shapes.filter((s) => s.op === "fill" && s.style !== "GRID").map((s) => s.style)).toEqual(["MAIN", "MAIN"]);
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
    const { canvas, draw } = setup();
    draw({ strengths: strengthsOf({ 0: 1 }), chord: [0, ChordQuality.Major], key: [0, KeyMode.Major] });

    draw(null);
    const afterOne = canvas.shapes.filter((s) => s.op === "fill" && s.style !== "GRID");
    expect(afterOne).toHaveLength(1);
    expect(afterOne[0].style).toBe("MAIN"); // 根音の強調は外れる
    expect(afterOne[0].alpha).toBeLessThan(1);
    expect(afterOne[0].alpha).toBeGreaterThan(strengthAlpha(0));
    expect(canvas.texts[CHROMA_BINS].text).toBe("—");
    expect(canvas.texts).toHaveLength(CHROMA_BINS + 1);

    for (let i = 0; i < 600; i++) draw(null);
    const settled = canvas.shapes.filter((s) => s.op === "fill" && s.style !== "GRID");
    expect(settled.every((s) => Math.abs(s.alpha - strengthAlpha(0)) < 1e-6)).toBe(true);
  });

  it("dispose すると強さは 0、コードは「—」に戻る。大きさが 0 なら何も描かない", () => {
    const { canvas, draw, renderer } = setup();
    draw({ strengths: strengthsOf({ 0: 1 }), chord: [0, ChordQuality.Major] });
    renderer.dispose();
    draw(null, 0);
    expect(canvas.shapes.filter((s) => s.op === "fill")).toHaveLength(CHROMA_BINS);
    expect(canvas.texts[CHROMA_BINS].text).toBe("—");

    renderer.resize({ width: 0, height: 0, devicePixelRatio: 1, quarterTurns: 0 });
    canvas.clear();
    renderer.draw(null, new FrameClient().histories, {}, COLORS, DT);
    expect(canvas.shapes).toHaveLength(0);
  });
});
