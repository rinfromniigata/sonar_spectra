import { describe, expect, it } from "vitest";
import { FrameClient, LOUDNESS_FLOOR_DB, SectionId } from "../../frame_client";
import { encodeTestFrame } from "../../frame_client/test_frames";
import type { Translate } from "../../i18n/use_t";
import { recordingCanvas, type DrawnShape } from "../test_canvas";
import type { PaletteColors } from "../types";
import { loudModule } from "./index";
import { BAR_COUNT, NEGATIVE_INFINITY_TEXT, loudLayout } from "./loud_math";
import { testDrawOutput } from "../test_shapes";

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
const LIGHT: PaletteColors = { ...COLORS, theme: "light" };
const WIDTH = 240;
const HEIGHT = 120;
const DT = 1 / 60;

/** 辞書の代わり：キー（と値）をそのまま返す */
const translate = ((key: string, params?: { value: string | number }) => (params ? `${key}:${params.value}` : key)) as unknown as Translate;

const MINUS = "−";

function setup(withTranslate = true) {
  const canvas = recordingCanvas();
  const renderer = loudModule.createRenderer({ ctx: canvas.ctx, translate: withTranslate ? translate : undefined });
  renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
  const client = new FrameClient();
  let seq = 0;
  /** values は [モーメンタリ, ショートターム, ピーク]。null なら届かない */
  const draw = (values: [number, number, number] | null, colors: PaletteColors = COLORS, dt = DT) => {
    canvas.clear();
    if (values) client.receive(encodeTestFrame({ seq: seq++, sections: [[SectionId.Loudness, values]] }));
    renderer.draw(values ? client.latest : null, client.histories, {}, colors, dt, testDrawOutput(canvas.ctx));
  };
  return { canvas, renderer, draw };
}

const bars = (shapes: DrawnShape[]) => shapes.filter((s) => s.op === "fillRect");
const lit = (shapes: DrawnShape[]) => bars(shapes).filter((s) => s.style !== "GRID");

describe("loud モジュールの定義", () => {
  it("ラウドネスのセクションを読み、方向を持たない。設定項目はない", () => {
    expect(loudModule.kind).toBe("loud");
    expect(loudModule.labelKey).toBe("modules.loudness");
    expect(loudModule.sections).toEqual([SectionId.Loudness]);
    expect(loudModule.shape).toBe("compact");
    expect(loudModule.baseDirection).toBeNull();
    expect(loudModule.flows).toBe(false);
    expect(loudModule.defaultOptions).toEqual({});
    expect(loudModule.defaultInstances).toEqual([{ enabled: true }]);
  });
});

describe("loud モジュールの描画：文字", () => {
  it("単位・数値（ショートターム）・ピークを、上からこの順に中央へ描く。単位とピークは辞書を通す", () => {
    const { canvas, draw } = setup();
    draw([-20, -23.44, -1.2]);
    const layout = loudLayout(WIDTH, HEIGHT);
    expect(canvas.texts.map((t) => t.text)).toEqual(["modules.loudness_unit", `${MINUS}23.4`, `modules.loudness_peak:${MINUS}1.2`]);
    expect(canvas.texts.every((t) => t.x === layout.centerX)).toBe(true);
    expect(canvas.texts.map((t) => t.y)).toEqual([layout.unit.y, layout.value.y, layout.sub.y]);
  });

  it("数値は太く大きい（枠の幅の 26%）。単位とピークは小さく、数字の書体を使う", () => {
    const { canvas, draw } = setup();
    draw([-20, -23, -1]);
    const layout = loudLayout(WIDTH, HEIGHT);
    const [unit, value, sub] = canvas.texts;
    expect(value.font).toBe(`600 ${layout.value.size}px NUMERIC`);
    expect(unit.font).toBe(`${layout.unit.size}px NUMERIC`);
    expect(sub.font).toBe(`${layout.sub.size}px NUMERIC`);
    expect(value.font).toContain(String(WIDTH * 0.26));
  });

  it("ダーク：数値は副色、単位とピークは控えめな文字色", () => {
    const { canvas, draw } = setup();
    draw([-20, -23, -1]);
    expect(canvas.texts.map((t) => t.style)).toEqual(["MUTED", "SUB", "MUTED"]);
  });

  it("ダーク：ショートタームが −8.6 dB を超えると、数値は強調色", () => {
    const { canvas, draw } = setup();
    draw([-5, -8, -1]);
    expect(canvas.texts[1].style).toBe("ACCENT");
    draw([-5, -9, -1]);
    // 数値の表示は 0.25 秒ごとの更新なので、すぐには替わらない
    expect(canvas.texts[1].text).toBe(`${MINUS}8.0`);
  });

  it("ライト：数値は、強いときも文字色（副色・強調色は地の色に対して小さい文字のコントラストが足りない）", () => {
    for (const values of [[-20, -23, -1], [-5, -8, -1]] as [number, number, number][]) {
      const { canvas, draw } = setup();
      draw(values, LIGHT);
      expect(canvas.texts[1].style).toBe("TEXT");
      expect(canvas.texts[0].style).toBe("MUTED");
    }
  });

  it("届いていない・計算できないときは「−∞」とピークも「−∞」", () => {
    for (const values of [null, [LOUDNESS_FLOOR_DB, LOUDNESS_FLOOR_DB, LOUDNESS_FLOOR_DB]] as ([number, number, number] | null)[]) {
      const { canvas, draw } = setup();
      draw(values);
      expect(canvas.texts[1].text).toBe(NEGATIVE_INFINITY_TEXT);
      expect(canvas.texts[2].text).toBe(`modules.loudness_peak:${NEGATIVE_INFINITY_TEXT}`);
    }
  });

  it("数値とピークは 0.25 秒ごとにしか替わらない。バーは毎回動く", () => {
    const { canvas, draw } = setup();
    draw([-20, -20, -6]);
    expect(canvas.texts[1].text).toBe(`${MINUS}20.0`);
    const before = lit(canvas.shapes).length;

    draw([0, -10, -1], COLORS, 0.1);
    expect(canvas.texts[1].text).toBe(`${MINUS}20.0`);
    expect(canvas.texts[2].text).toBe(`modules.loudness_peak:${MINUS}6.0`);
    expect(lit(canvas.shapes).length).toBeGreaterThan(before);

    draw([0, -10, -1], COLORS, 0.2);
    expect(canvas.texts[1].text).toBe(`${MINUS}10.0`);
    expect(canvas.texts[2].text).toBe(`modules.loudness_peak:${MINUS}1.0`);
  });

  it("辞書が渡されなければ、単位は「LOUD」、ピークは値だけ（落ちない）", () => {
    const { canvas, draw } = setup(false);
    draw([-20, -23, -1]);
    expect(canvas.texts.map((t) => t.text)).toEqual(["LOUD", `${MINUS}23.0`, `${MINUS}1.0`]);
  });
});

describe("loud モジュールの描画：バー", () => {
  it("24本を下端に並べる。モーメンタリが −30 dB 以下なら、すべて消灯（格子の色）", () => {
    const { canvas, draw } = setup();
    draw([-30, -20, -6]);
    const all = bars(canvas.shapes);
    expect(all).toHaveLength(BAR_COUNT);
    expect(lit(canvas.shapes)).toHaveLength(0);
    const { bars: layout } = loudLayout(WIDTH, HEIGHT);
    expect(all[0].points[0]).toEqual([1, layout.top]);
    expect(all[0].points[1]).toEqual([layout.barWidth - 1, layout.top + layout.height]);
    expect(all[BAR_COUNT - 1].points[0][0]).toBeCloseTo((BAR_COUNT - 1) * layout.barWidth + 1, 6);
    expect(all.every((s) => s.alpha === 1)).toBe(true);
  });

  it("−15 dB なら左の12本が点灯（副色）。点灯は少し透かす", () => {
    const { canvas, draw } = setup();
    draw([-15, -15, -6]);
    const on = lit(canvas.shapes);
    expect(on).toHaveLength(12);
    expect(on.every((s) => s.style === "SUB" && s.alpha === 0.9)).toBe(true);
    expect(Math.max(...on.map((s) => s.points[0][0]))).toBeLessThan(WIDTH / 2);
  });

  it("0 dB なら全点灯で、右の4本（上の2割）は強調色", () => {
    const { canvas, draw } = setup();
    draw([0, -5, -1]);
    const on = lit(canvas.shapes);
    expect(on).toHaveLength(BAR_COUNT);
    expect(on.filter((s) => s.style === "ACCENT")).toHaveLength(4);
    expect(on.filter((s) => s.style === "SUB")).toHaveLength(BAR_COUNT - 4);
    expect(on.slice(-4).every((s) => s.style === "ACCENT")).toBe(true);
  });

  it("バーはモーメンタリで、数値はショートターム：別々の値で動く", () => {
    const { canvas, draw } = setup();
    draw([0, -40, -1]);
    expect(lit(canvas.shapes)).toHaveLength(BAR_COUNT);
    expect(canvas.texts[1].text).toBe(`${MINUS}40.0`);
  });

  it("フレームがなければ消灯", () => {
    const { canvas, draw } = setup();
    draw(null);
    expect(lit(canvas.shapes)).toHaveLength(0);
    expect(bars(canvas.shapes)).toHaveLength(BAR_COUNT);
  });
});

describe("loud モジュールの共通", () => {
  it("大きさが0のあいだは何も描かない。dispose の後は、次の1回で新しい値を出す", () => {
    const canvas = recordingCanvas();
    const renderer = loudModule.createRenderer({ ctx: canvas.ctx, translate });
    renderer.draw(null, new FrameClient().histories, {}, COLORS, DT, testDrawOutput(canvas.ctx));
    expect(canvas.shapes).toHaveLength(0);
    expect(canvas.texts).toHaveLength(0);

    const { canvas: c2, renderer: r2, draw } = setup();
    draw([-20, -20, -6]);
    r2.dispose();
    draw([-10, -10, -1], COLORS, 0);
    expect(c2.texts[1].text).toBe(`${MINUS}10.0`);
  });
});
