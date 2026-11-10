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
import { recordingCanvas } from "../test_canvas";
import { pairs, recordingShapeSink, splitRects, testDrawOutput, type RecordedShape } from "../test_shapes";
import type { PaletteColors } from "../types";
import { waveModule } from "../wave";
import { stereoModule } from "./index";
import { blurAlpha, correlationX, dotAlpha, dotStyle, lissajousLayout, panLayout, trailAlpha } from "./stereo_math";

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
  const canvas = recordingCanvas();
  const recording = recordingShapeSink();
  const renderer = stereoModule.createRenderer({ ctx: canvas.ctx });
  renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
  const client = new FrameClient();
  let seq = 0;
  const draw = (input: StereoInput | number[] | null, dt = DT) => {
    canvas.clear();
    recording.clear();
    if (input) {
      const values = Array.isArray(input) ? input : payload(input);
      client.receive(encodeTestFrame({ seq: seq++, sections: [[SectionId.Stereo, values]] }));
    }
    renderer.draw(input ? client.latest : null, client.histories, { ...DEFAULTS, ...options }, COLORS, dt, testDrawOutput(canvas.ctx, recording));
  };
  return { canvas, shapes: recording.shapes, draw };
}

type Polyline = Extract<RecordedShape, { op: "polyline" }>;
type Rects = Extract<RecordedShape, { op: "rects" }>;

const strokes = (shapes: RecordedShape[], color: string) => shapes.filter((s): s is Polyline => s.op === "polyline" && s.style.color === color);
/** 尾以外の線（点ごとの濃さを持たないもの） */
const lines = (shapes: RecordedShape[], color: string) => strokes(shapes, color).filter((s) => !s.fades);
/** 尾（前の位置から今の位置へ透明から濃くなる線） */
const tails = (shapes: RecordedShape[]) => shapes.filter((s): s is Polyline => s.op === "polyline" && s.fades !== undefined);
const rects = (shapes: RecordedShape[], color: string) =>
  shapes
    .filter((s): s is Rects => s.op === "rects" && s.style.color === color)
    .flatMap((s) => splitRects(s).map((r) => ({ ...r, glow: s.style.glow ?? 0 })));
const rectCenterX = (r: { x: number; width: number }) => r.x + r.width / 2;
const rectCenterY = (r: { y: number; height: number }) => r.y + r.height / 2;

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
  it("残光：前の回の絵を残し、地の色を経過時間に応じた濃さで重ねる（リサージュ 0.3、定位はブラーあり 0.32・なし 0.55）", () => {
    for (const [options, alpha] of [
      [{}, 0.3],
      [{ mode: "pan" }, 0.32],
      [{ mode: "pan", blur: false }, 0.55],
    ] as const) {
      const { shapes, draw } = setup(options);
      draw(MONO, 1 / 120);
      // 図形より先に、1度だけ
      expect(shapes[0]).toEqual({ op: "trail", color: "BG", alpha: trailAlpha(alpha, 1 / 120) });
      expect(shapes.filter((s) => s.op === "trail")).toHaveLength(1);
    }
  });

  it("相関の印：副色で発光 6、相関 1 は右端、届いていなければ中央。下地のバーは格子の色", () => {
    const one = setup();
    one.draw({ correlation: 1 });
    const mark = rects(one.shapes, "SUB");
    expect(mark).toHaveLength(1);
    expect(rectCenterX(mark[0])).toBeCloseTo(correlationX(WIDTH, HEIGHT, 1), 6);
    expect(mark[0].glow).toBe(6);
    expect(rects(one.shapes, "GRID").some((r) => r.height === 2)).toBe(true);

    const none = setup();
    none.draw(null);
    expect(rectCenterX(rects(none.shapes, "SUB")[0])).toBeCloseTo(WIDTH / 2, 6);
  });

  it("相関の印は急に跳ばず、時間をかけて近づく", () => {
    const { shapes, draw } = setup();
    draw({ correlation: -1 });
    draw({ correlation: 1 });
    const x = rectCenterX(rects(shapes, "SUB")[0]);
    expect(x).toBeGreaterThan(correlationX(WIDTH, HEIGHT, -1));
    expect(x).toBeLessThan(correlationX(WIDTH, HEIGHT, 0));
  });

  it("長さの合わないセクションは読まない（届いていないのと同じ）", () => {
    const { shapes, draw } = setup();
    draw(Array<number>(STEREO_LEN - 1).fill(0.5));
    expect(strokes(shapes, "ACCENT")).toHaveLength(0);
  });

  it("大きさが0のあいだは何も描かない", () => {
    const canvas = recordingCanvas();
    const recording = recordingShapeSink();
    const renderer = stereoModule.createRenderer({ ctx: canvas.ctx });
    renderer.draw(null, new FrameClient().histories, DEFAULTS, COLORS, DT, testDrawOutput(canvas.ctx, recording));
    expect(recording.shapes).toHaveLength(0);
  });
});

describe("stereo モジュールの描画：リサージュ", () => {
  it("外周の円（線の色の閉じた線）と、L・R の軸と縦の軸（格子の色）を描く", () => {
    const { shapes, draw } = setup();
    draw(null);
    const circle = strokes(shapes, "LINE");
    expect(circle).toHaveLength(1);
    expect(circle[0].style.closed).toBe(true);
    expect(pairs(circle[0].points)).toHaveLength(64);
    const { cx, cy, r } = lissajousLayout(WIDTH, HEIGHT);
    for (const [x, y] of pairs(circle[0].points)) expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(r, 3);
    // 軸は1本ずつ（2点の線を3本）
    const axes = strokes(shapes, "GRID");
    expect(axes).toHaveLength(3);
    expect(axes.every((a) => a.points.length === 4)).toBe(true);
  });

  it("モノラルの信号は、縦の線になる。線は強調色で発光 6、古い側ほど薄い", () => {
    const { shapes, draw } = setup({ dots: "none" });
    draw(MONO);
    const { cx } = lissajousLayout(WIDTH, HEIGHT);
    const found = strokes(shapes, "ACCENT");
    expect(found.length).toBeGreaterThan(1);
    for (const line of found) for (const [x] of pairs(line.points)) expect(x).toBeCloseTo(cx, 4);
    for (let i = 1; i < found.length; i++) expect(found[i].style.alpha!).toBeGreaterThan(found[i - 1].style.alpha!);
    expect(found.every((l) => l.style.glow === 6 && l.style.width === 1.1)).toBe(true);
    // 全部の点を1度ずつつなぐ（組の境目の点は両方の組に入る）
    const total = found.reduce((sum, l) => sum + l.points.length / 2, 0);
    expect(total).toBe(LISSAJOUS_POINTS + found.length - 1);
  });

  it("L だけの信号は、左上と右下を結ぶ斜めの線になる", () => {
    const { shapes, draw } = setup({ dots: "none" });
    draw({ x: (i) => -0.5 * Math.sin(i / 7), y: (i) => 0.5 * Math.sin(i / 7) });
    const { cx, cy } = lissajousLayout(WIDTH, HEIGHT);
    for (const line of strokes(shapes, "ACCENT")) for (const [x, y] of pairs(line.points)) expect(x - cx).toBeCloseTo(y - cy, 3);
  });

  it.each(["size", "bright", "both"] as const)("点描（%s）：3点ごとに強調色の点（発光つき）。明るくでは文字色の芯（発光なし）を重ねる", (dots) => {
    const { shapes, draw } = setup({ dots });
    draw(MONO);
    const style = dotStyle(dots)!;
    const marks = rects(shapes, "ACCENT");
    expect(marks).toHaveLength(Math.ceil(LISSAJOUS_POINTS / 3));
    for (const m of marks) {
      expect(m.width).toBeCloseTo(style.size, 5);
      expect(m.glow).toBe(style.glow);
    }
    expect(marks[0].alpha).toBeLessThan(marks[marks.length - 1].alpha);
    expect(marks[1].alpha).toBeCloseTo(dotAlpha(3, LISSAJOUS_POINTS), 6);
    const cores = rects(shapes, "TEXT");
    expect(cores).toHaveLength(style.bright ? marks.length : 0);
    expect(cores.every((c) => c.glow === 0)).toBe(true);
  });

  it("点描がなしなら点を描かない。届いていなければ線も点も描かない", () => {
    const none = setup({ dots: "none" });
    none.draw(MONO);
    expect(rects(none.shapes, "ACCENT")).toHaveLength(0);

    const empty = setup();
    empty.draw(null);
    expect(strokes(empty.shapes, "ACCENT")).toHaveLength(0);
    expect(rects(empty.shapes, "ACCENT")).toHaveLength(0);
  });

  it("文字の層には何も描かない（毎回消す）", () => {
    const { canvas, draw } = setup();
    draw(MONO);
    expect(canvas.shapes).toHaveLength(0);
    expect(canvas.texts).toHaveLength(0);
  });
});

describe("stereo モジュールの描画：周波数別の定位", () => {
  const LEFT_LOUD: StereoInput = { pan: () => -1, level: () => 1 };
  const RIGHT_LOUD: StereoInput = { pan: () => 1, level: () => 1 };

  it("格子を描き、L・R の記号を文字の層に描く", () => {
    const { canvas, shapes, draw } = setup({ mode: "pan" });
    draw(null);
    // 中央の縦線・周波数の目安の横線3本・左右の端を、太さ1の四角で塗る（ほかに、格子の色は相関のバーの下地が1つ）
    const grid = rects(shapes, "GRID");
    expect(grid).toHaveLength(6 + 1);
    const layout = panLayout(WIDTH, HEIGHT);
    expect(grid[0]).toMatchObject({ x: layout.cx, y: layout.top, width: 1, height: layout.bottom - layout.top });
    expect(canvas.texts.map((t) => t.text)).toEqual(["L", "R"]);
    expect(canvas.texts[0].x).toBeLessThan(canvas.texts[1].x);
    expect(canvas.shapes).toHaveLength(0);
  });

  it("左に定位した強い帯域は、左端に、下（低域）から上（高域）へ並ぶ。強い点は強調色で大きい", () => {
    const { shapes, draw } = setup({ mode: "pan" });
    draw(LEFT_LOUD);
    const layout = panLayout(WIDTH, HEIGHT);
    const line = lines(shapes, "ACCENT");
    expect(line).toHaveLength(1);
    expect(line[0].style).toMatchObject({ alpha: 0.7, width: 1.1, glow: 6 });
    const points = pairs(line[0].points);
    expect(points).toHaveLength(PAN_BANDS);
    for (const [x] of points) expect(x).toBeCloseTo(layout.cx - layout.half, 4);
    expect(points[0][1]).toBeCloseTo(layout.bottom, 4);
    expect(points[PAN_BANDS - 1][1]).toBeCloseTo(layout.top, 4);

    const dots = rects(shapes, "ACCENT");
    expect(dots).toHaveLength(PAN_BANDS);
    expect(dots[0].width).toBeCloseTo(4.2, 5);
    expect(rectCenterY(dots[0])).toBeCloseTo(layout.bottom, 4);
    expect(dots[0]).toMatchObject({ alpha: 1, glow: 5 });
  });

  it("無音の帯域は、定位の値によらず中央に小さな主色の点で置く", () => {
    const { shapes, draw } = setup({ mode: "pan" });
    draw({ pan: () => -1, level: () => 0 });
    const dots = rects(shapes, "MAIN");
    expect(dots).toHaveLength(PAN_BANDS);
    for (const d of dots) {
      expect(rectCenterX(d)).toBeCloseTo(WIDTH / 2, 4);
      expect(d.width).toBe(1);
      expect(d.alpha).toBeCloseTo(0.45, 6);
    }
  });

  it("モーションブラー：前の回から動いた帯域に、動いた道筋の尾（前の位置で透明、今の位置で濃い）を引く", () => {
    const { shapes, draw } = setup({ mode: "pan" });
    draw(LEFT_LOUD);
    // 1回目は前の回がないので、尾を引かない
    expect(tails(shapes)).toHaveLength(0);

    draw(RIGHT_LOUD);
    const layout = panLayout(WIDTH, HEIGHT);
    const found = tails(shapes);
    // 発光だけの尾（強調色・発光 6）を全部出してから、尾そのもの（発光なし）を出す
    expect(found).toHaveLength(PAN_BANDS * 2);
    const glows = found.slice(0, PAN_BANDS);
    const sharp = found.slice(PAN_BANDS);
    expect(glows.every((t) => t.style.glowOnly && t.style.glow === 6 && t.style.color === "ACCENT")).toBe(true);
    expect(sharp.every((t) => !t.style.glowOnly && !t.style.glow)).toBe(true);
    for (const t of found) {
      expect(t.fades).toEqual([0, 1]);
      expect(t.points[0]).toBeCloseTo(layout.cx - layout.half, 4);
      expect(t.points[2]).toBeCloseTo(layout.cx + layout.half, 4);
      expect(t.style.alpha).toBeCloseTo(blurAlpha(2 * layout.half), 6);
      expect(t.style.width).toBeCloseTo(0.8 + 2.2, 6);
    }
    // 強い帯域の尾そのものは強調色
    expect(sharp.every((t) => t.style.color === "ACCENT")).toBe(true);
    // 前の回の線を薄く残す
    const previous = lines(shapes, "ACCENT").filter((s) => s.style.alpha! < 0.3);
    expect(previous).toHaveLength(1);
    expect(previous[0].points[0]).toBeCloseTo(layout.cx - layout.half, 4);
  });

  it("弱い帯域の尾そのものは主色で、発光は強調色のまま", () => {
    const { shapes, draw } = setup({ mode: "pan" });
    // 振幅 1e-4：高域の帯域は強さ 0.3 前後（強調色にならず、定位どおりに動く）、低域は 0（動かない）
    draw({ pan: () => -1, level: () => 1e-4 });
    draw({ pan: () => 1, level: () => 1e-4 });
    const found = tails(shapes);
    expect(found.length).toBeGreaterThan(0);
    const glows = found.filter((t) => t.style.glowOnly);
    const sharp = found.filter((t) => !t.style.glowOnly);
    expect(glows.every((t) => t.style.color === "ACCENT")).toBe(true);
    expect(sharp.every((t) => t.style.color === "MAIN")).toBe(true);
  });

  it("動いていない帯域には尾を引かない。ブラーをオフにすると尾も前の線も描かない", () => {
    const still = setup({ mode: "pan" });
    still.draw(LEFT_LOUD);
    still.draw(LEFT_LOUD);
    expect(tails(still.shapes)).toHaveLength(0);

    const off = setup({ mode: "pan", blur: false });
    off.draw(LEFT_LOUD);
    off.draw(RIGHT_LOUD);
    expect(tails(off.shapes)).toHaveLength(0);
    expect(lines(off.shapes, "ACCENT")).toHaveLength(1);
  });

  it("届かない回をはさむと、前の位置を忘れて尾を引かない", () => {
    const { shapes, draw } = setup({ mode: "pan" });
    draw(LEFT_LOUD);
    draw(null);
    draw(RIGHT_LOUD);
    expect(tails(shapes)).toHaveLength(0);
  });
});
