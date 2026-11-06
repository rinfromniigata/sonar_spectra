import { describe, expect, it } from "vitest";
import { FLAG_STALE, FrameClient, SPECTRUM_BANDS, SectionId } from "../../frame_client";
import { encodeTestFrame } from "../../frame_client/test_frames";
import type { SpecOptions } from "../options";
import { recordingCanvas, type DrawnShape } from "../test_canvas";
import type { PaletteColors } from "../types";
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
  const renderer = specModule.createRenderer({ ctx: canvas.ctx });
  renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
  const client = new FrameClient();
  let seq = 0;
  const draw = (bands: number[] | null = FULL, dt = DT, flags = 0) => {
    canvas.clear();
    if (bands) client.receive(encodeTestFrame({ seq: seq++, flags, sections: [[SectionId.Spectrum, bands]] }));
    renderer.draw(bands ? client.latest : null, client.histories, { ...DEFAULTS, ...options }, COLORS, dt);
  };
  return { canvas, draw };
}

const fills = (shapes: DrawnShape[], style = "gradient") => shapes.filter((s) => s.op === "fill" && s.style === style);
const strokes = (shapes: DrawnShape[], style: string) => shapes.filter((s) => s.op === "stroke" && s.style === style);
const minY = (s: DrawnShape) => Math.min(...s.points.map((p) => p[1]));
const maxY = (s: DrawnShape) => Math.max(...s.points.map((p) => p[1]));

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
    const { canvas, draw } = setup();
    draw();
    const fill = fills(canvas.shapes);
    expect(fill).toHaveLength(1);
    expect(minY(fill[0])).toBeCloseTo(HEIGHT * 0.1, 6);
    expect(maxY(fill[0])).toBe(HEIGHT);
    expect(fill[0].points[0][0]).toBe(0);
    expect(fill[0].alpha).toBeCloseTo(0.82, 6);
  });

  it("輪郭は主色（太さ 1.6）、今のフレームそのままの細い線は副色（高さ 78%）、残像は強調色", () => {
    const { canvas, draw } = setup();
    draw();
    const main = strokes(canvas.shapes, "MAIN");
    expect(main).toHaveLength(1);
    expect(main[0].lineWidth).toBe(1.6);
    expect(main[0].points).toHaveLength(SPECTRUM_BANDS);
    expect(main[0].points[0][0]).toBe(0);
    expect(main[0].points[SPECTRUM_BANDS - 1][0]).toBe(WIDTH);

    const sub = strokes(canvas.shapes, "SUB");
    expect(sub).toHaveLength(1);
    expect(minY(sub[0])).toBeCloseTo(HEIGHT * (1 - 0.78), 6);

    const ghost = strokes(canvas.shapes, "ACCENT");
    expect(ghost).toHaveLength(1);
    expect(ghost[0].alpha).toBeCloseTo(0.55, 6);
  });

  it("残像をオフにすると、強調色の線を描かない", () => {
    const { canvas, draw } = setup({ ghost: false });
    draw();
    expect(strokes(canvas.shapes, "ACCENT")).toHaveLength(0);
  });

  it("無音とフレームなしでは、輪郭は下端に張り付き、何も上に伸びない", () => {
    for (const bands of [SILENT, null]) {
      const { canvas, draw } = setup();
      draw(bands);
      expect(minY(strokes(canvas.shapes, "MAIN")[0])).toBe(HEIGHT);
      expect(minY(strokes(canvas.shapes, "SUB")[0])).toBe(HEIGHT);
    }
  });

  it("音が止まると、輪郭は1/60秒ごとに 0.88 倍で下がり、残像は 0.004 ずつ下がる", () => {
    const { canvas, draw } = setup();
    draw(FULL);
    draw(SILENT);
    expect(minY(strokes(canvas.shapes, "MAIN")[0])).toBeCloseTo(HEIGHT - SMOOTH_DECAY_PER_FRAME * HEIGHT * 0.9, 4);
    // 今のフレームそのままの線は、すぐ底に戻る
    expect(minY(strokes(canvas.shapes, "SUB")[0])).toBe(HEIGHT);
    expect(minY(strokes(canvas.shapes, "ACCENT")[0])).toBeCloseTo(HEIGHT - (1 - PEAK_FALL_PER_FRAME) * HEIGHT * 0.9, 4);
  });

  it("最後の最新のフレームが STALE でも描ける（無音の源の最後の値を出し続けない）", () => {
    const { canvas, draw } = setup();
    draw(FULL, DT, FLAG_STALE);
    expect(minY(strokes(canvas.shapes, "MAIN")[0])).toBeCloseTo(HEIGHT * 0.1, 6);
  });

  it("長さの合わないスペクトラムは読まず、無音として扱う", () => {
    const { canvas, draw } = setup();
    draw(Array<number>(SPECTRUM_BANDS - 1).fill(1));
    expect(minY(strokes(canvas.shapes, "MAIN")[0])).toBe(HEIGHT);
  });

  it("下端に周波数の目盛り（50・200・1k・5k・16k）を左から右へ並べる", () => {
    const { canvas, draw } = setup();
    draw();
    expect(canvas.texts.map((t) => t.text)).toEqual(["50", "200", "1k", "5k", "16k"]);
    const xs = canvas.texts.map((t) => t.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(canvas.texts.every((t) => t.y === HEIGHT - 4)).toBe(true);
  });

  it("格子線（10×6）を描く", () => {
    const { canvas, draw } = setup();
    draw();
    const grid = strokes(canvas.shapes, "GRID");
    expect(grid).toHaveLength(1);
    expect(grid[0].points).toHaveLength((10 - 1 + (6 - 1)) * 2);
  });
});

describe("spec モジュールの描画：バー", () => {
  it("48本のバーを区切りの段で描く。フルスケールでは 26 段で、上の 30% は強調色、ほかは主色", () => {
    const { canvas, draw } = setup({ mode: "bars" });
    draw();
    const firstBar = canvas.shapes.filter((s) => s.op === "fillRect" && s.points[0][0] === 1 && s.style !== "SUB");
    expect(firstBar).toHaveLength(26);
    const segmentHeight = Math.max(3, HEIGHT / 40);
    for (const s of firstBar) {
      expect(s.points[1][1] - s.points[0][1]).toBeCloseTo(segmentHeight, 6);
      expect(s.style).toBe(s.points[0][1] < HEIGHT * 0.3 ? "ACCENT" : "MAIN");
    }
    expect(firstBar.some((s) => s.style === "ACCENT")).toBe(true);
    expect(firstBar.some((s) => s.style === "MAIN")).toBe(true);
    // 下の段ほど薄く、上の段ほど濃い
    expect(firstBar[0].alpha).toBeLessThan(firstBar[firstBar.length - 1].alpha);
    // 隣のバーとの間に隙間がある
    const barWidth = WIDTH / BAR_COUNT;
    expect(firstBar[0].points[1][0] - firstBar[0].points[0][0]).toBeCloseTo(barWidth - 2, 6);
  });

  it("残像の印は副色の細い線を1本ずつ。オフにすると描かない", () => {
    const on = setup({ mode: "bars" });
    on.draw();
    const marks = on.canvas.shapes.filter((s) => s.op === "fillRect" && s.style === "SUB");
    expect(marks).toHaveLength(BAR_COUNT);
    expect(marks[0].points[1][1] - marks[0].points[0][1]).toBe(2);
    expect(marks[0].alpha).toBeCloseTo(0.9, 6);

    const off = setup({ mode: "bars", ghost: false });
    off.draw();
    expect(off.canvas.shapes.filter((s) => s.style === "SUB")).toHaveLength(0);
  });

  it("無音では段を描かない", () => {
    const { canvas, draw } = setup({ mode: "bars", ghost: false });
    draw(SILENT);
    expect(canvas.shapes.filter((s) => s.op === "fillRect")).toHaveLength(0);
  });
});

describe("spec モジュールの描画：鏡写し", () => {
  it("中央から上下対称に、枠の半分の高さの 92% まで広がる。縁は主色の線2本", () => {
    const { canvas, draw } = setup({ mode: "mirror" });
    draw();
    const mid = HEIGHT / 2;
    const fill = fills(canvas.shapes);
    expect(fill).toHaveLength(1);
    expect(minY(fill[0])).toBeCloseTo(mid - mid * 0.92, 6);
    expect(maxY(fill[0])).toBeCloseTo(mid + mid * 0.92, 6);

    const edges = strokes(canvas.shapes, "MAIN");
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.lineWidth === 1.4)).toBe(true);
    expect(minY(edges[0])).toBeCloseTo(mid - mid * 0.92, 6);
    expect(maxY(edges[1])).toBeCloseTo(mid + mid * 0.92, 6);
  });

  it("残像は強調色の線2本（上下）。オフにすると描かない", () => {
    const on = setup({ mode: "mirror" });
    on.draw();
    const ghost = strokes(on.canvas.shapes, "ACCENT");
    expect(ghost).toHaveLength(2);
    expect(ghost[0].alpha).toBeCloseTo(0.5, 6);

    const off = setup({ mode: "mirror", ghost: false });
    off.draw();
    expect(strokes(off.canvas.shapes, "ACCENT")).toHaveLength(0);
  });
});

describe("spec モジュールの描画：円形", () => {
  it("中心から、内側の円（16%）の外へ、フルスケールで外側（48%）まで広がる。目盛りの文字は出さない", () => {
    const { canvas, draw } = setup({ mode: "radial" });
    draw();
    const { cx, cy, r0, r1 } = radialLayout(WIDTH, HEIGHT);
    const ring = fills(canvas.shapes)[0];
    expect(ring.points).toHaveLength(SPECTRUM_BANDS * 2 + 1);
    for (const [x, y] of ring.points) expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(r0 + r1, 4);
    // 上から始まる
    expect(ring.points[0][0]).toBeCloseTo(cx, 4);
    expect(ring.points[0][1]).toBeLessThan(cy);
    expect(canvas.texts).toHaveLength(0);
  });

  it("無音では内側の円の上に収まる。左右対称", () => {
    const { canvas, draw } = setup({ mode: "radial", ghost: false });
    draw(SILENT);
    const { cx, cy, r0 } = radialLayout(WIDTH, HEIGHT);
    const ring = fills(canvas.shapes)[0];
    for (const [x, y] of ring.points) expect(Math.hypot(x - cx, y - cy)).toBeCloseTo(r0, 4);

    const tilt = new Array<number>(SPECTRUM_BANDS).fill(0).map((_, i) => (i < 48 ? 1 : 0));
    const other = setup({ mode: "radial", ghost: false });
    other.draw(tilt);
    const points = fills(other.canvas.shapes)[0].points;
    const n = SPECTRUM_BANDS * 2;
    for (let k = 1; k < SPECTRUM_BANDS; k++) {
      const [x1, y1] = points[k];
      const [x2, y2] = points[n - k];
      expect(2 * cx - x1).toBeCloseTo(x2, 4);
      expect(y1).toBeCloseTo(y2, 4);
    }
  });

  it("残像は強調色の線。オフにすると描かない", () => {
    const on = setup({ mode: "radial" });
    on.draw();
    expect(strokes(on.canvas.shapes, "ACCENT")).toHaveLength(1);
    const off = setup({ mode: "radial", ghost: false });
    off.draw();
    expect(strokes(off.canvas.shapes, "ACCENT")).toHaveLength(0);
  });
});

describe("spec モジュールの共通", () => {
  it("大きさが0のあいだは何も描かない。dispose の後も描ける", () => {
    const canvas = recordingCanvas();
    const renderer = specModule.createRenderer({ ctx: canvas.ctx });
    renderer.draw(null, new FrameClient().histories, DEFAULTS, COLORS, DT);
    expect(canvas.shapes).toHaveLength(0);

    renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
    renderer.dispose();
    renderer.draw(null, new FrameClient().histories, DEFAULTS, COLORS, DT);
    expect(canvas.shapes.length).toBeGreaterThan(0);
  });
});
