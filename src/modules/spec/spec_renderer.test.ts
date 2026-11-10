import { describe, expect, it } from "vitest";
import { FLAG_STALE, FrameClient, SPECTRUM_BANDS, SectionId } from "../../frame_client";
import { encodeTestFrame } from "../../frame_client/test_frames";
import type { SpecOptions } from "../options";
import { recordingCanvas } from "../test_canvas";
import { pairs, recordingShapeSink, splitRects, testDrawOutput, type RecordedShape } from "../test_shapes";
import type { Gradient, PaletteColors } from "../types";
import { specModule } from "./index";
import { BAR_COUNT, PEAK_FALL_PER_FRAME, SMOOTH_DECAY_PER_FRAME, radialLayout } from "./spec_math";

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
const DEFAULTS = specModule.defaultOptions;
const WIDTH = 400;
const HEIGHT = 200;
const DT = 1 / 60;

/** 全帯域がフルスケール（表示の高さ 1）のスペクトラム */
const FULL = Array<number>(SPECTRUM_BANDS).fill(1);
const SILENT = Array<number>(SPECTRUM_BANDS).fill(0);

function setup(options: Partial<SpecOptions> = {}) {
  const canvas = recordingCanvas();
  const recording = recordingShapeSink();
  const renderer = specModule.createRenderer({ ctx: canvas.ctx });
  renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
  const client = new FrameClient();
  let seq = 0;
  const draw = (bands: number[] | null = FULL, dt = DT, flags = 0) => {
    canvas.clear();
    recording.clear();
    if (bands) client.receive(encodeTestFrame({ seq: seq++, flags, sections: [[SectionId.Spectrum, bands]] }));
    renderer.draw(bands ? client.latest : null, client.histories, { ...DEFAULTS, ...options }, COLORS, dt, testDrawOutput(canvas.ctx, recording));
  };
  return { canvas, shapes: recording.shapes, draw };
}

type Polyline = Extract<RecordedShape, { op: "polyline" }>;
type Band = Extract<RecordedShape, { op: "band" }>;
type Polygon = Extract<RecordedShape, { op: "polygon" }>;
type Rects = Extract<RecordedShape, { op: "rects" }>;

/** 色の移り変わりで塗った帯・多角形 */
const gradientFills = (shapes: RecordedShape[]) =>
  shapes.filter((s): s is Band | Polygon => (s.op === "band" || s.op === "polygon") && typeof s.style.color !== "string");
const strokes = (shapes: RecordedShape[], color: string) => shapes.filter((s): s is Polyline => s.op === "polyline" && s.style.color === color);
const rects = (shapes: RecordedShape[], color: string) =>
  shapes.filter((s): s is Rects => s.op === "rects" && s.style.color === color).flatMap((s) => splitRects(s));
const ys = (s: Polyline) => pairs(s.points).map((p) => p[1]);
const minY = (s: Polyline) => Math.min(...ys(s));
const maxY = (s: Polyline) => Math.max(...ys(s));
const gradientOf = (s: Band | Polygon) => s.style.color as Gradient;

describe("spec モジュールの定義", () => {
  it("スペクトラムのセクションを読み、強さは上へ伸びる。既定値は imple 5.1 のとおり（線＋塗り・残像あり）", () => {
    expect(specModule.kind).toBe("spec");
    expect(specModule.sections).toEqual([SectionId.Spectrum]);
    expect(specModule.baseDirection).toBe("up");
    expect(specModule.shape).toBe("long");
    expect(specModule.flows).toBe(false);
    expect(specModule.defaultOptions).toEqual({ mode: "fill", ghost: true });
    expect(specModule.defaultInstances).toEqual([{ enabled: true }]);
  });
});

describe("spec モジュールの描画：線＋塗り", () => {
  it("フルスケールで、塗りの上端が枠の高さの 90% の高さに来る。塗りは下端まで閉じる", () => {
    const { shapes, draw } = setup();
    draw();
    const fill = gradientFills(shapes);
    expect(fill).toHaveLength(1);
    const band = fill[0] as Band;
    expect(band.op).toBe("band");
    expect(Math.min(...band.top)).toBeCloseTo(HEIGHT * 0.1, 4);
    expect(band.bottom.every((y) => y === HEIGHT)).toBe(true);
    expect(band.xs[0]).toBe(0);
    expect(band.xs[SPECTRUM_BANDS - 1]).toBe(WIDTH);
    expect(band.style.alpha).toBeCloseTo(0.82, 6);
  });

  it("塗りの色：高さの 10% から 55% までは主色のまま、下端に向けて透明へ（モックのグラデーション）", () => {
    const { shapes, draw } = setup();
    draw();
    expect(gradientOf(gradientFills(shapes)[0])).toEqual({
      kind: "linear",
      x0: 0,
      y0: HEIGHT * 0.1,
      x1: 0,
      y1: HEIGHT,
      stops: [
        { offset: 0, color: "MAIN" },
        { offset: 0.55, color: "MAIN" },
        { offset: 1, color: "transparent" },
      ],
    });
  });

  it("輪郭は主色（太さ 1.6）、今のフレームそのままの細い線は副色（高さ 78%）、残像は強調色", () => {
    const { shapes, draw } = setup();
    draw();
    const main = strokes(shapes, "MAIN");
    expect(main).toHaveLength(1);
    expect(main[0].style.width).toBe(1.6);
    const points = pairs(main[0].points);
    expect(points).toHaveLength(SPECTRUM_BANDS);
    expect(points[0][0]).toBe(0);
    expect(points[SPECTRUM_BANDS - 1][0]).toBe(WIDTH);

    const sub = strokes(shapes, "SUB");
    expect(sub).toHaveLength(1);
    expect(minY(sub[0])).toBeCloseTo(HEIGHT * (1 - 0.78), 4);

    const ghost = strokes(shapes, "ACCENT");
    expect(ghost).toHaveLength(1);
    expect(ghost[0].style.alpha).toBeCloseTo(0.55, 6);
  });

  it("残像をオフにすると、強調色の線を描かない", () => {
    const { shapes, draw } = setup({ ghost: false });
    draw();
    expect(strokes(shapes, "ACCENT")).toHaveLength(0);
  });

  it("無音とフレームなしでは、輪郭は下端に張り付き、何も上に伸びない", () => {
    for (const bands of [SILENT, null]) {
      const { shapes, draw } = setup();
      draw(bands);
      expect(minY(strokes(shapes, "MAIN")[0])).toBe(HEIGHT);
      expect(minY(strokes(shapes, "SUB")[0])).toBe(HEIGHT);
    }
  });

  it("音が止まると、輪郭は1/60秒ごとに 0.88 倍で下がり、残像は 0.004 ずつ下がる", () => {
    const { shapes, draw } = setup();
    draw(FULL);
    draw(SILENT);
    expect(minY(strokes(shapes, "MAIN")[0])).toBeCloseTo(HEIGHT - SMOOTH_DECAY_PER_FRAME * HEIGHT * 0.9, 4);
    // 今のフレームそのままの線は、すぐ底に戻る
    expect(minY(strokes(shapes, "SUB")[0])).toBe(HEIGHT);
    expect(minY(strokes(shapes, "ACCENT")[0])).toBeCloseTo(HEIGHT - (1 - PEAK_FALL_PER_FRAME) * HEIGHT * 0.9, 4);
  });

  it("最後の最新のフレームが STALE でも描ける（無音の源の最後の値を出し続けない）", () => {
    const { shapes, draw } = setup();
    draw(FULL, DT, FLAG_STALE);
    expect(minY(strokes(shapes, "MAIN")[0])).toBeCloseTo(HEIGHT * 0.1, 4);
  });

  it("長さの合わないスペクトラムは読まず、無音として扱う", () => {
    const { shapes, draw } = setup();
    draw(Array<number>(SPECTRUM_BANDS - 1).fill(1));
    expect(minY(strokes(shapes, "MAIN")[0])).toBe(HEIGHT);
  });

  it("下端に周波数の目盛り（50・200・1k・5k・16k）を、文字の層に左から右へ並べる", () => {
    const { canvas, draw } = setup();
    draw();
    expect(canvas.texts.map((t) => t.text)).toEqual(["50", "200", "1k", "5k", "16k"]);
    const xs = canvas.texts.map((t) => t.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(canvas.texts.every((t) => t.y === HEIGHT - 4 && t.style === "MUTED")).toBe(true);
    // 図形は文字の層に描かない
    expect(canvas.shapes).toHaveLength(0);
  });

  it("格子線（10×6）を、太さ1の四角で描く（最初に出すので、ほかの図形の下になる）", () => {
    const { shapes, draw } = setup();
    draw();
    expect(shapes[0]).toMatchObject({ op: "rects", style: { color: "GRID" } });
    const grid = rects(shapes, "GRID");
    expect(grid).toHaveLength(10 - 1 + (6 - 1));
    const vertical = grid.filter((r) => r.width === 1);
    expect(vertical).toHaveLength(10 - 1);
    expect(vertical.map((r) => r.x)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => Math.round((WIDTH * i) / 10)));
    expect(vertical.every((r) => r.y === 0 && r.height === HEIGHT)).toBe(true);
  });

  it("発光：塗り（24）・輪郭（10）・細い線（6）に発光の値を付けて出し、残像は発光させない", () => {
    const { shapes, draw } = setup();
    draw();
    expect(gradientFills(shapes)[0].style.glow).toBe(24);
    expect(strokes(shapes, "MAIN")[0].style.glow).toBe(10);
    expect(strokes(shapes, "SUB")[0].style.glow).toBe(6);
    expect(strokes(shapes, "ACCENT")[0].style.glow ?? 0).toBe(0);
  });
});

describe("spec モジュールの描画：バー", () => {
  it("48本のバーを区切りの段で描く。フルスケールでは 26 段で、上の 30% は強調色、ほかは主色", () => {
    const { shapes, draw } = setup({ mode: "bars" });
    draw();
    const segments = [...rects(shapes, "MAIN").map((r) => ({ ...r, color: "MAIN" })), ...rects(shapes, "ACCENT").map((r) => ({ ...r, color: "ACCENT" }))];
    const firstBar = segments.filter((r) => r.x === 1).sort((a, b) => b.y - a.y);
    expect(firstBar).toHaveLength(26);
    const segmentHeight = Math.max(3, HEIGHT / 40);
    for (const s of firstBar) {
      expect(s.height).toBeCloseTo(segmentHeight, 6);
      expect(s.color).toBe(s.y < HEIGHT * 0.3 ? "ACCENT" : "MAIN");
    }
    expect(firstBar.some((s) => s.color === "ACCENT")).toBe(true);
    expect(firstBar.some((s) => s.color === "MAIN")).toBe(true);
    // 下の段ほど薄く、上の段ほど濃い
    expect(firstBar[0].alpha).toBeLessThan(firstBar[firstBar.length - 1].alpha);
    // 隣のバーとの間に隙間がある
    const barWidth = WIDTH / BAR_COUNT;
    expect(firstBar[0].width).toBeCloseTo(barWidth - 2, 4);
    // 段は発光させない
    expect(shapes.filter((s) => s.op === "rects").every((s) => !s.style.glow)).toBe(true);
  });

  it("残像の印は副色の細い線を1本ずつ。オフにすると描かない", () => {
    const on = setup({ mode: "bars" });
    on.draw();
    const marks = rects(on.shapes, "SUB");
    expect(marks).toHaveLength(BAR_COUNT);
    expect(marks[0].height).toBe(2);
    expect(marks[0].alpha).toBeCloseTo(0.9, 6);

    const off = setup({ mode: "bars", ghost: false });
    off.draw();
    expect(rects(off.shapes, "SUB")).toHaveLength(0);
  });

  it("無音では段を描かない", () => {
    const { shapes, draw } = setup({ mode: "bars", ghost: false });
    draw(SILENT);
    expect(shapes.filter((s) => s.op === "rects" && s.style.color !== "GRID")).toHaveLength(0);
  });
});

describe("spec モジュールの描画：鏡写し", () => {
  it("中央から上下対称に、枠の半分の高さの 92% まで広がる。縁は主色の線2本", () => {
    const { shapes, draw } = setup({ mode: "mirror" });
    draw();
    const mid = HEIGHT / 2;
    const fill = gradientFills(shapes);
    expect(fill).toHaveLength(1);
    const band = fill[0] as Band;
    expect(Math.min(...band.top)).toBeCloseTo(mid - mid * 0.92, 4);
    expect(Math.max(...band.bottom)).toBeCloseTo(mid + mid * 0.92, 4);
    expect(band.style).toMatchObject({ alpha: 0.8, glow: 20 });
    // 色：上端と下端で透明、中央で主色
    expect(gradientOf(band)).toEqual({
      kind: "linear",
      x0: 0,
      y0: 0,
      x1: 0,
      y1: HEIGHT,
      stops: [
        { offset: 0, color: "transparent" },
        { offset: 0.5, color: "MAIN" },
        { offset: 1, color: "transparent" },
      ],
    });

    const edges = strokes(shapes, "MAIN");
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.style.width === 1.4 && e.style.glow === 10)).toBe(true);
    expect(minY(edges[0])).toBeCloseTo(mid - mid * 0.92, 4);
    expect(maxY(edges[1])).toBeCloseTo(mid + mid * 0.92, 4);
  });

  it("残像は強調色の線2本（上下）。オフにすると描かない", () => {
    const on = setup({ mode: "mirror" });
    on.draw();
    const ghost = strokes(on.shapes, "ACCENT");
    expect(ghost).toHaveLength(2);
    expect(ghost[0].style.alpha).toBeCloseTo(0.5, 6);

    const off = setup({ mode: "mirror", ghost: false });
    off.draw();
    expect(strokes(off.shapes, "ACCENT")).toHaveLength(0);
  });
});

describe("spec モジュールの描画：円形", () => {
  it("中心から、内側の円（16%）の外へ、フルスケールで外側（48%）まで広がる。目盛りの文字と格子は出さない", () => {
    const { canvas, shapes, draw } = setup({ mode: "radial" });
    draw();
    const { cx, cy, r0, r1 } = radialLayout(WIDTH, HEIGHT);
    const ring = gradientFills(shapes)[0] as Polygon;
    expect(ring.op).toBe("polygon");
    // 中心から扇形に塗る
    expect(ring.center).toEqual([cx, cy]);
    const points = pairs(ring.points);
    expect(points).toHaveLength(SPECTRUM_BANDS * 2);
    for (const [x, y] of points) expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(r0 + r1, 3);
    // 上から始まる
    expect(points[0][0]).toBeCloseTo(cx, 4);
    expect(points[0][1]).toBeLessThan(cy);
    expect(ring.style).toMatchObject({ alpha: 0.75, glow: 20 });
    expect(canvas.texts).toHaveLength(0);
    expect(rects(shapes, "GRID")).toHaveLength(0);
  });

  it("塗りの色：内側の円の 60% で透明、外側の円で主色（中心が同じ2つの円のグラデーション）", () => {
    const { shapes, draw } = setup({ mode: "radial" });
    draw();
    const { cx, cy, r0, r1 } = radialLayout(WIDTH, HEIGHT);
    expect(gradientOf(gradientFills(shapes)[0])).toEqual({
      kind: "radial",
      x: cx,
      y: cy,
      r0: r0 * 0.6,
      r1: r0 + r1,
      stops: [
        { offset: 0, color: "transparent" },
        { offset: 1, color: "MAIN" },
      ],
    });
  });

  it("内側と外側の目安の円を、格子の色の閉じた線で描く。輪郭（主色）も閉じた線", () => {
    const { shapes, draw } = setup({ mode: "radial" });
    draw();
    const { cx, cy, r0, r1 } = radialLayout(WIDTH, HEIGHT);
    const guides = strokes(shapes, "GRID");
    expect(guides).toHaveLength(2);
    expect(guides.every((g) => g.style.closed && g.style.width === 1)).toBe(true);
    for (const [guide, radius] of [
      [guides[0], r0],
      [guides[1], r0 + r1],
    ] as const) {
      for (const [x, y] of pairs(guide.points)) expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(radius, 3);
    }
    const outline = strokes(shapes, "MAIN");
    expect(outline).toHaveLength(1);
    expect(outline[0].style).toMatchObject({ width: 1.6, glow: 10, closed: true });
  });

  it("無音では内側の円の上に収まる。左右対称", () => {
    const { shapes, draw } = setup({ mode: "radial", ghost: false });
    draw(SILENT);
    const { cx, cy, r0 } = radialLayout(WIDTH, HEIGHT);
    const ring = gradientFills(shapes)[0] as Polygon;
    for (const [x, y] of pairs(ring.points)) expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(r0, 3);

    const tilt = new Array<number>(SPECTRUM_BANDS).fill(0).map((_, i) => (i < 48 ? 1 : 0));
    const other = setup({ mode: "radial", ghost: false });
    other.draw(tilt);
    const points = pairs((gradientFills(other.shapes)[0] as Polygon).points);
    const n = SPECTRUM_BANDS * 2;
    for (let k = 1; k < SPECTRUM_BANDS; k++) {
      const [x1, y1] = points[k];
      const [x2, y2] = points[n - k];
      expect(2 * cx - x1).toBeCloseTo(x2, 3);
      expect(y1).toBeCloseTo(y2, 3);
    }
  });

  it("残像は強調色の閉じた線。オフにすると描かない", () => {
    const on = setup({ mode: "radial" });
    on.draw();
    const ghost = strokes(on.shapes, "ACCENT");
    expect(ghost).toHaveLength(1);
    expect(ghost[0].style).toMatchObject({ alpha: 0.55, closed: true });
    const off = setup({ mode: "radial", ghost: false });
    off.draw();
    expect(strokes(off.shapes, "ACCENT")).toHaveLength(0);
  });
});

describe("spec モジュールの共通", () => {
  it("大きさが0のあいだは何も描かない。dispose の後も描ける", () => {
    const canvas = recordingCanvas();
    const recording = recordingShapeSink();
    const renderer = specModule.createRenderer({ ctx: canvas.ctx });
    renderer.draw(null, new FrameClient().histories, DEFAULTS, COLORS, DT, testDrawOutput(canvas.ctx, recording));
    expect(recording.shapes).toHaveLength(0);

    renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
    renderer.dispose();
    renderer.draw(null, new FrameClient().histories, DEFAULTS, COLORS, DT, testDrawOutput(canvas.ctx, recording));
    expect(recording.shapes.length).toBeGreaterThan(0);
  });
});
