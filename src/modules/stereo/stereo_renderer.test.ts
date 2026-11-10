import { describe, expect, it } from "vitest";
import { createDefaultInstances } from "../../config/default_instances";
import { FrameClient, LISSAJOUS_POINTS, PAN_BANDS, SectionId, STEREO_LEN } from "../../frame_client";
import { encodeTestFrame } from "../../frame_client/test_frames";
import { autoArrange } from "../../layout/auto_arrange";
import { TEMPLATES, type Band } from "../../layout/templates";
import { levelModule } from "../level";
import type { StereoOptions } from "../options";
import { ModuleRegistry } from "../registry";
import { specModule } from "../spec";
import { joinedView, recordingBuffers, recordingCanvas, type DrawnShape } from "../test_canvas";
import type { PaletteColors } from "../types";
import { waveModule } from "../wave";
import { stereoModule } from "./index";
import { correlationX, dotStyle, lissajousLayout, panLayout, trailAlpha } from "./stereo_math";
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
const DEFAULTS = stereoModule.defaultOptions;
const WIDTH = 200;
const HEIGHT = 200;
const DT = 1 / 60;

interface StereoInput {
  correlation?: number;
  x?: (i: number) => number;
  y?: (i: number) => number;
  pan?: (band: number) => number;
  level?: (band: number) => number;
}

function payload(input: StereoInput): number[] {
  const values = [input.correlation ?? 0];
  for (let i = 0; i < LISSAJOUS_POINTS; i++) values.push(input.x?.(i) ?? 0);
  for (let i = 0; i < LISSAJOUS_POINTS; i++) values.push(input.y?.(i) ?? 0);
  for (let b = 0; b < PAN_BANDS; b++) values.push(input.pan?.(b) ?? 0);
  for (let b = 0; b < PAN_BANDS; b++) values.push(input.level?.(b) ?? 0);
  expect(values).toHaveLength(STEREO_LEN);
  return values;
}

function setup(options: Partial<StereoOptions> = {}) {
  const raw = recordingCanvas();
  const buffers = recordingBuffers();
  const renderer = stereoModule.createRenderer({ ctx: raw.ctx, createBuffer: buffers.createBuffer });
  // 短い区間に分けて描いた線は、1本にまとめて調べる
  const canvas = joinedView(raw);
  renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
  const client = new FrameClient();
  let seq = 0;
  const draw = (input: StereoInput | number[] | null, dt = DT) => {
    canvas.clear();
    if (input) {
      const values = Array.isArray(input) ? input : payload(input);
      client.receive(encodeTestFrame({ seq: seq++, sections: [[SectionId.Stereo, values]] }));
    }
    renderer.draw(input ? client.latest : null, client.histories, { ...DEFAULTS, ...options }, COLORS, dt, testDrawOutput(raw.ctx));
  };
  return { canvas, draw, buffers };
}

const strokes = (shapes: DrawnShape[], style: string) => shapes.filter((s) => s.op === "stroke" && s.style === style);
const rects = (shapes: DrawnShape[], style: string) => shapes.filter((s) => s.op === "fillRect" && s.style === style);
const rectWidth = (s: DrawnShape) => s.points[1][0] - s.points[0][0];
const rectCenterX = (s: DrawnShape) => (s.points[0][0] + s.points[1][0]) / 2;
const rectCenterY = (s: DrawnShape) => (s.points[0][1] + s.points[1][1]) / 2;

/** モノラルの信号：横は 0、縦は正弦 */
const MONO: StereoInput = { correlation: 1, y: (i) => 0.6 * Math.sin(i / 10) };

describe("stereo モジュールの定義", () => {
  it("位相のセクションを読み、方向を持たない。既定値は imple 5.1 のとおり（リサージュ・点描は両方・ブラーあり）", () => {
    expect(stereoModule.kind).toBe("stereo");
    expect(stereoModule.labelKey).toBe("modules.phase");
    expect(stereoModule.sections).toEqual([SectionId.Stereo]);
    expect(stereoModule.shape).toBe("compact");
    expect(stereoModule.baseDirection).toBeNull();
    expect(stereoModule.flows).toBe(false);
    expect(stereoModule.defaultOptions).toEqual({ mode: "lissajous", dots: "both", blur: true });
  });

  it("既定の構成に、リサージュと、専用の位置（pan）の周波数別の定位の2つを置く", () => {
    expect(stereoModule.defaultInstances).toEqual([{ enabled: true }, { enabled: true, slot: "pan", options: { mode: "pan" } }]);
  });

  it.each<[Band, number]>([
    ["strip", 3],
    ["wide", 16 / 9],
    ["standard", 4 / 3],
    ["tall", 9 / 16],
  ])("自動整列（%s）：2つ目の位相は、テンプレートの専用の位置を占め、1つ目とは別の位置に置かれる", (band, aspect) => {
    const registry = new ModuleRegistry();
    registry.register(levelModule);
    registry.register(waveModule);
    registry.register(specModule);
    registry.register(stereoModule);
    let n = 0;
    const instances = createDefaultInstances(registry, () => `id${n++}`);
    const stereo = instances.filter((i) => i.kind === "stereo");
    expect(stereo).toHaveLength(2);
    expect(stereo[0].options).toEqual(DEFAULTS);
    expect(stereo[1]).toMatchObject({ slot: "pan", options: { mode: "pan", dots: "both", blur: true } });

    const layout = autoArrange(instances, aspect);
    expect(layout.band).toBe(band);
    const pan = layout.rects.get(stereo[1].id)!;
    const slot = TEMPLATES[band].pan;
    expect(pan.c).toBeLessThanOrEqual(slot.c);
    expect(pan.r).toBeLessThanOrEqual(slot.r);
    expect(pan.c + pan.cs).toBeGreaterThanOrEqual(slot.c + slot.cs);
    expect(pan.r + pan.rs).toBeGreaterThanOrEqual(slot.r + slot.rs);
    expect(layout.rects.get(stereo[0].id)).not.toEqual(pan);
  });
});

describe("stereo モジュールの描画：共通", () => {
  it("残光：毎回消さずに、地の色を経過時間に応じた濃さで重ねる（リサージュ 0.3、定位はブラーあり 0.32・なし 0.55）", () => {
    for (const [options, alpha] of [
      [{}, 0.3],
      [{ mode: "pan" }, 0.32],
      [{ mode: "pan", blur: false }, 0.55],
    ] as const) {
      const { canvas, draw } = setup(options);
      draw(MONO, 1 / 120);
      const first = canvas.shapes[0];
      expect(first.op).toBe("fillRect");
      expect(first.style).toBe("BG");
      expect(first.points).toEqual([
        [0, 0],
        [WIDTH, HEIGHT],
      ]);
      expect(first.alpha).toBeCloseTo(trailAlpha(alpha, 1 / 120), 6);
    }
  });

  it("相関の印：副色で、相関 1 は右端、届いていなければ中央", () => {
    const one = setup();
    one.draw({ correlation: 1 });
    const mark = rects(one.canvas.shapes, "SUB");
    expect(mark).toHaveLength(1);
    expect(rectCenterX(mark[0])).toBeCloseTo(correlationX(WIDTH, HEIGHT, 1), 6);

    const none = setup();
    none.draw(null);
    expect(rectCenterX(rects(none.canvas.shapes, "SUB")[0])).toBeCloseTo(WIDTH / 2, 6);
  });

  it("相関の印は急に跳ばず、時間をかけて近づく", () => {
    const { canvas, draw } = setup();
    draw({ correlation: -1 });
    draw({ correlation: 1 });
    const x = rectCenterX(rects(canvas.shapes, "SUB")[0]);
    expect(x).toBeGreaterThan(correlationX(WIDTH, HEIGHT, -1));
    expect(x).toBeLessThan(correlationX(WIDTH, HEIGHT, 0));
  });

  it("長さの合わないセクションは読まない（届いていないのと同じ）", () => {
    const { canvas, draw } = setup();
    draw(Array<number>(STEREO_LEN - 1).fill(0.5));
    expect(strokes(canvas.shapes, "ACCENT")).toHaveLength(0);
  });

  it("大きさが0のあいだは何も描かない", () => {
    const canvas = recordingCanvas();
    const renderer = stereoModule.createRenderer({ ctx: canvas.ctx, createBuffer: recordingBuffers().createBuffer });
    renderer.draw(null, new FrameClient().histories, DEFAULTS, COLORS, DT, testDrawOutput(canvas.ctx));
    expect(canvas.shapes).toHaveLength(0);
  });
});

describe("stereo モジュールの描画：リサージュ", () => {
  it("外周の円（線の色）と、L・R の軸と縦の軸（格子の色）を描く", () => {
    const { canvas, draw } = setup();
    draw(null);
    const circle = strokes(canvas.shapes, "LINE");
    expect(circle).toHaveLength(1);
    expect(circle[0].points).toHaveLength(65);
    const { cx, cy, r } = lissajousLayout(WIDTH, HEIGHT);
    for (const [x, y] of circle[0].points) expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(r, 4);
    // 軸は1本ずつ（2点の線を3本）
    const axes = strokes(canvas.shapes, "GRID");
    expect(axes).toHaveLength(3);
    expect(axes.every((a) => a.points.length === 2)).toBe(true);
  });

  it("モノラルの信号は、縦の線になる。線は強調色で、古い側ほど薄い", () => {
    const { canvas, draw } = setup({ dots: "none" });
    draw(MONO);
    const { cx } = lissajousLayout(WIDTH, HEIGHT);
    const lines = strokes(canvas.shapes, "ACCENT");
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) for (const [x] of line.points) expect(x).toBeCloseTo(cx, 6);
    for (let i = 1; i < lines.length; i++) expect(lines[i].alpha).toBeGreaterThan(lines[i - 1].alpha);
    // 全部の点を1度ずつつなぐ（組の境目の点は両方の組に入る）
    const total = lines.reduce((sum, l) => sum + l.points.length, 0);
    expect(total).toBe(LISSAJOUS_POINTS + lines.length - 1);
  });

  it("L だけの信号は、左上と右下を結ぶ斜めの線になる", () => {
    const { canvas, draw } = setup({ dots: "none" });
    draw({ x: (i) => -0.5 * Math.sin(i / 7), y: (i) => 0.5 * Math.sin(i / 7) });
    const { cx, cy } = lissajousLayout(WIDTH, HEIGHT);
    for (const line of strokes(canvas.shapes, "ACCENT"))
      for (const [x, y] of line.points) expect(x - cx).toBeCloseTo(y - cy, 4);
  });

  it.each(["size", "bright", "both"] as const)("点描（%s）：3点ごとに強調色の点。明るくでは文字色の芯を重ねる", (dots) => {
    const { canvas, draw } = setup({ dots });
    draw(MONO);
    const style = dotStyle(dots)!;
    const marks = rects(canvas.shapes, "ACCENT");
    expect(marks).toHaveLength(Math.ceil(LISSAJOUS_POINTS / 3));
    for (const m of marks) expect(rectWidth(m)).toBeCloseTo(style.size, 6);
    expect(marks[0].alpha).toBeLessThan(marks[marks.length - 1].alpha);
    expect(rects(canvas.shapes, "TEXT")).toHaveLength(style.bright ? marks.length : 0);
  });

  it("点描がなしなら点を描かない。届いていなければ線も点も描かない", () => {
    const none = setup({ dots: "none" });
    none.draw(MONO);
    expect(rects(none.canvas.shapes, "ACCENT")).toHaveLength(0);

    const empty = setup();
    empty.draw(null);
    expect(strokes(empty.canvas.shapes, "ACCENT")).toHaveLength(0);
    expect(rects(empty.canvas.shapes, "ACCENT")).toHaveLength(0);
  });
});

describe("stereo モジュールの描画：周波数別の定位", () => {
  const LEFT_LOUD: StereoInput = { pan: () => -1, level: () => 1 };
  const RIGHT_LOUD: StereoInput = { pan: () => 1, level: () => 1 };

  it("格子と L・R の記号を描く", () => {
    const { canvas, draw } = setup({ mode: "pan" });
    draw(null);
    // 中央の縦線・周波数の目安の横線3本・左右の端を、太さ1の四角で塗る（ほかに、格子の色は相関のバーの下地が1つ）
    const grid = rects(canvas.shapes, "GRID");
    expect(grid).toHaveLength(6 + 1);
    const layout = panLayout(WIDTH, HEIGHT);
    expect(grid[0].points).toEqual([
      [layout.cx, layout.top],
      [layout.cx + 1, layout.bottom],
    ]);
    expect(canvas.texts.map((t) => t.text)).toEqual(["L", "R"]);
    expect(canvas.texts[0].x).toBeLessThan(canvas.texts[1].x);
  });

  it("左に定位した強い帯域は、左端に、下（低域）から上（高域）へ並ぶ。強い点は強調色で大きい", () => {
    const { canvas, draw } = setup({ mode: "pan" });
    draw(LEFT_LOUD);
    const layout = panLayout(WIDTH, HEIGHT);
    const line = strokes(canvas.shapes, "ACCENT");
    expect(line).toHaveLength(1);
    expect(line[0].points).toHaveLength(PAN_BANDS);
    for (const [x] of line[0].points) expect(x).toBeCloseTo(layout.cx - layout.half, 6);
    expect(line[0].points[0][1]).toBeCloseTo(layout.bottom, 6);
    expect(line[0].points[PAN_BANDS - 1][1]).toBeCloseTo(layout.top, 6);

    const dots = rects(canvas.shapes, "ACCENT");
    expect(dots).toHaveLength(PAN_BANDS);
    expect(rectWidth(dots[0])).toBeCloseTo(4.2, 6);
    expect(rectCenterY(dots[0])).toBeCloseTo(layout.bottom, 6);
  });

  it("無音の帯域は、定位の値によらず中央に小さな主色の点で置く", () => {
    const { canvas, draw } = setup({ mode: "pan" });
    draw({ pan: () => -1, level: () => 0 });
    const dots = rects(canvas.shapes, "MAIN");
    expect(dots).toHaveLength(PAN_BANDS);
    for (const d of dots) {
      expect(rectCenterX(d)).toBeCloseTo(WIDTH / 2, 6);
      expect(rectWidth(d)).toBe(1);
    }
  });

  it("モーションブラー：前の回から動いた帯域に、動いた道筋の尾（前の位置から今の位置へのグラデーション）を引く", () => {
    const { canvas, draw } = setup({ mode: "pan" });
    draw(LEFT_LOUD);
    // 1回目は前の回がないので、尾を引かない
    expect(canvas.shapes.filter((s) => s.op === "stroke" && s.style === "gradient")).toHaveLength(0);

    draw(RIGHT_LOUD);
    const layout = panLayout(WIDTH, HEIGHT);
    const tails = canvas.shapes.filter((s) => s.op === "stroke" && s.style === "gradient");
    expect(tails).toHaveLength(PAN_BANDS);
    expect(tails[0].points[0][0]).toBeCloseTo(layout.cx - layout.half, 6);
    expect(tails[0].points[1][0]).toBeCloseTo(layout.cx + layout.half, 6);
    // 前の回の線を薄く残す
    const previous = strokes(canvas.shapes, "ACCENT").filter((s) => s.alpha < 0.3);
    expect(previous).toHaveLength(1);
    expect(previous[0].points[0][0]).toBeCloseTo(layout.cx - layout.half, 6);
  });

  it("動いていない帯域には尾を引かない。ブラーをオフにすると尾も前の線も描かない", () => {
    const still = setup({ mode: "pan" });
    still.draw(LEFT_LOUD);
    still.draw(LEFT_LOUD);
    expect(still.canvas.shapes.filter((s) => s.style === "gradient")).toHaveLength(0);

    const off = setup({ mode: "pan", blur: false });
    off.draw(LEFT_LOUD);
    off.draw(RIGHT_LOUD);
    expect(off.canvas.shapes.filter((s) => s.style === "gradient")).toHaveLength(0);
    expect(strokes(off.canvas.shapes, "ACCENT")).toHaveLength(1);
  });

  it("届かない回をはさむと、前の位置を忘れて尾を引かない", () => {
    const { canvas, draw } = setup({ mode: "pan" });
    draw(LEFT_LOUD);
    draw(null);
    draw(RIGHT_LOUD);
    expect(canvas.shapes.filter((s) => s.style === "gradient")).toHaveLength(0);
  });
});
