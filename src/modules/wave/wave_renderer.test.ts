import { describe, expect, it } from "vitest";
import { FLAG_STALE, FrameClient, SectionId, WAVE_NOW_POINTS } from "../../frame_client";
import { encodeTestFrame } from "../../frame_client/test_frames";
import type { WaveOptions } from "../options";
import { recordingCanvas } from "../test_canvas";
import { pairs, recordingShapeSink, splitRects, testDrawOutput, type RecordedShape } from "../test_shapes";
import type { PaletteColors } from "../types";
import { waveModule } from "./index";

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
const DEFAULTS = waveModule.defaultOptions;
const WIDTH = 400;
const HEIGHT = 100;
const MID = HEIGHT / 2;

/** env と帯域の強さ、今の波形が全点 nowL・nowR の波形のフレームを `client` に届ける */
function receive(client: FrameClient, env: number, bands: [number, number, number], nowL: number, nowR: number, seq: number) {
  const payload = [env, env, ...bands, ...Array(WAVE_NOW_POINTS).fill(nowL), ...Array(WAVE_NOW_POINTS).fill(nowR)];
  client.receive(encodeTestFrame({ seq, sections: [[SectionId.Waveform, payload]] }));
}

function setup(options: Partial<WaveOptions> = {}) {
  const canvas = recordingCanvas();
  const recording = recordingShapeSink();
  const renderer = waveModule.createRenderer({ ctx: canvas.ctx });
  renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
  const client = new FrameClient();
  const draw = () => {
    recording.clear();
    canvas.clear();
    renderer.draw(client.latest, client.histories, { ...DEFAULTS, ...options }, COLORS, 1 / 60, testDrawOutput(canvas.ctx, recording));
  };
  return { canvas, shapes: recording.shapes, client, draw };
}

type Band = Extract<RecordedShape, { op: "band" }>;
type Polyline = Extract<RecordedShape, { op: "polyline" }>;
type Rects = Extract<RecordedShape, { op: "rects" }>;

const bands = (shapes: RecordedShape[], alpha?: number) =>
  shapes.filter((s): s is Band => s.op === "band" && (alpha === undefined || s.style.alpha === alpha));
const polylines = (shapes: RecordedShape[]) => shapes.filter((s): s is Polyline => s.op === "polyline");
const rects = (shapes: RecordedShape[], color: string) =>
  shapes.filter((s): s is Rects => s.op === "rects" && s.style.color === color).flatMap((s) => splitRects(s).map((r) => ({ ...r, glow: s.style.glow ?? 0 })));
/** 履歴の帯（不透明度 0.9） */
const history = (shapes: RecordedShape[]) => bands(shapes, 0.9);
/** 今の波形の外縁（不透明度 0.75） */
const outer = (shapes: RecordedShape[]) => polylines(shapes).filter((s) => s.style.alpha === 0.75);
const core = (shapes: RecordedShape[]) => polylines(shapes).find((s) => s.style.width === 1.8)!;

describe("wave モジュールの定義", () => {
  it("波形のセクションを読み、履歴が左へ流れ、速さの設定を持つ。既定値は imple 5.1 のとおり", () => {
    expect(waveModule.sections).toEqual([SectionId.Waveform]);
    expect(waveModule.baseDirection).toBe("left");
    expect(waveModule.flows).toBe(true);
    expect(waveModule.shape).toBe("long");
    expect(waveModule.defaultOptions).toEqual({ channel: "stereo", showNow: true, split: 72, histColor: "solid", speed: 1 });
  });
});

describe("wave モジュールの描画", () => {
  it("ステレオ：履歴は上に L（主色）・下に R（副色）、境目（72%）の左に収まる", () => {
    const { shapes, client, draw } = setup();
    for (let i = 0; i < 10; i++) receive(client, 0.5, [0.1, 0.1, 0.1], 0, 0, i);
    draw();

    const split = Math.round(WIDTH * 0.72);
    const found = history(shapes);
    expect(found.map((s) => s.style.color)).toEqual(["MAIN", "SUB"]);
    const [upper, lower] = found;
    expect(Math.max(...upper.xs)).toBe(split);
    // 上の帯は中心から上へ、下の帯は中心から下へ
    expect(upper.bottom.every((y) => y === MID)).toBe(true);
    expect(lower.top.every((y) => y === MID)).toBe(true);
    expect(Math.min(...upper.top)).toBeCloseTo(MID - 0.5 * MID * 0.92, 4);
    expect(Math.max(...lower.bottom)).toBeCloseTo(MID + 0.5 * MID * 0.92, 4);
    // 10行 × 4px：最新の行が境目、最も古い行が 9 行分左
    expect(Math.min(...upper.xs)).toBe(split - 9 * 4);
  });

  it("モノラル：履歴は混ぜた値を主色で上下対称に描き、今の波形も1本", () => {
    const { shapes, client, draw } = setup({ channel: "mono" });
    receive(client, 0.4, [0.1, 0.1, 0.1], 0.5, -0.5, 0);
    receive(client, 0.4, [0.1, 0.1, 0.1], 0.5, -0.5, 1);
    draw();
    expect(history(shapes).map((s) => s.style.color)).toEqual(["MAIN", "MAIN"]);
    // 今の波形：外縁の線は主色の1本（ステレオなら主色と副色の2本）
    expect(outer(shapes).map((s) => s.style.color)).toEqual(["MAIN"]);
    expect(polylines(shapes).some((s) => s.style.color === "SUB")).toBe(false);
  });

  it("今の波形：境目に点線を引き、外縁（2本）と芯を描き、両端は中心に戻る", () => {
    const { shapes, client, draw } = setup();
    receive(client, 0.5, [0.1, 0.1, 0.1], 0.5, -0.25, 0);
    draw();

    const split = Math.round(WIDTH * 0.72);
    // 点線：境目の位置から幅1、2ピクセル引いて3ピクセル空ける（文字の色・不透明度 0.6）
    const dashes = rects(shapes, "MUTED");
    expect(dashes).toHaveLength(Math.ceil(HEIGHT / 5));
    expect(dashes.slice(0, 2)).toEqual([
      { x: split, y: 0, width: 1, height: 2, alpha: 0.6, glow: 0 },
      { x: split, y: 5, width: 1, height: 2, alpha: 0.6, glow: 0 },
    ]);

    const lanes = outer(shapes);
    expect(lanes.map((s) => s.style.color)).toEqual(["MAIN", "SUB"]);
    const coreLine = core(shapes);
    expect(coreLine.style.color).toBe("MAIN");
    for (const line of [...lanes, coreLine]) {
      const points = pairs(line.points);
      expect(Math.min(...points.map((p) => p[0]))).toBe(split);
      expect(points[0][1]).toBeCloseTo(MID, 4);
      expect(points[points.length - 1][1]).toBeCloseTo(MID, 4);
    }
    // L（+0.5）は中心より上へ、R（-0.25）は中心より下へ振れる
    const middle = (s: Polyline) => pairs(s.points)[Math.floor(s.points.length / 4)][1];
    expect(middle(lanes[0])).toBeLessThan(MID);
    expect(middle(lanes[1])).toBeGreaterThan(MID);
    // 外縁と芯の間の半透明の塗りが2本分（上の端が外縁、下の端が芯）
    const fills = bands(shapes, 0.22);
    expect(fills.map((s) => s.style.color)).toEqual(["MAIN", "SUB"]);
    expect(fills[0].bottom).toEqual(pairs(coreLine.points).map((p) => p[1]));
    expect(fills[0].top).toEqual(pairs(lanes[0].points).map((p) => p[1]));
  });

  it("今の波形を出さないときは、履歴が右端まで流れ、点線と今の波形を描かない", () => {
    const { shapes, client, draw } = setup({ showNow: false });
    for (let i = 0; i < 5; i++) receive(client, 0.5, [0.1, 0.1, 0.1], 0.5, 0.5, i);
    draw();
    expect(rects(shapes, "MUTED")).toHaveLength(0);
    expect(polylines(shapes)).toHaveLength(0);
    expect(bands(shapes, 0.22)).toHaveLength(0);
    expect(Math.max(...history(shapes)[0].xs)).toBe(WIDTH);
  });

  it("帯域別の色：列ごとに強い帯域の色で塗る（低＝主色、高＝副色、中＝強調色）", () => {
    const { shapes, client, draw } = setup({ histColor: "bands" });
    receive(client, 0.5, [0.9, 0.05, 0.05], 0, 0, 0);
    receive(client, 0.5, [0.05, 0.1, 0.85], 0, 0, 1);
    receive(client, 0.5, [0.1, 0.8, 0.1], 0, 0, 2);
    draw();
    const columns = ["MAIN", "SUB", "ACCENT"].flatMap((color) => rects(shapes, color).map((r) => ({ ...r, color })));
    expect(columns.every((c) => c.alpha === 0.9)).toBe(true);
    // 古い列から順に（左から）主色・副色・強調色。列の幅は1行分（4px）で、中心が行の位置
    const split = Math.round(WIDTH * 0.72);
    expect([...columns].sort((a, b) => a.x - b.x).map((c) => c.color)).toEqual(["MAIN", "SUB", "ACCENT"]);
    expect([...columns].sort((a, b) => a.x - b.x).map((c) => c.x + c.width / 2)).toEqual([split - 8, split - 4, split]);
    expect(columns.every((c) => c.width === 4)).toBe(true);
    // 帯域別の色では塗りの帯を使わない
    expect(history(shapes)).toHaveLength(0);
  });

  it("流れる速さで、1行の幅が変わる", () => {
    const { shapes, client, draw } = setup({ speed: 2 });
    for (let i = 0; i < 10; i++) receive(client, 0.5, [0.1, 0.1, 0.1], 0, 0, i);
    draw();
    const upper = history(shapes)[0];
    expect(Math.max(...upper.xs) - Math.min(...upper.xs)).toBe(9 * 8);
  });

  it("届いていない（STALE）フレームは履歴に積まれないので、履歴の長さは変わらない", () => {
    const { shapes, client, draw } = setup();
    receive(client, 0.5, [0.1, 0.1, 0.1], 0, 0, 0);
    receive(client, 0.5, [0.1, 0.1, 0.1], 0, 0, 1);
    client.receive(encodeTestFrame({ seq: 2, flags: FLAG_STALE, sections: [[SectionId.Waveform, Array(5 + 2 * WAVE_NOW_POINTS).fill(0)]] }));
    draw();
    const upper = history(shapes)[0];
    // 2行だけ（1行分の幅）
    expect(Math.max(...upper.xs) - Math.min(...upper.xs)).toBe(4);
  });

  it("履歴が1行だけのあいだは、幅のない履歴を描かない", () => {
    const { shapes, client, draw } = setup();
    receive(client, 0.5, [0.1, 0.1, 0.1], 0, 0, 0);
    draw();
    expect(history(shapes)).toHaveLength(0);
  });

  it("発光：履歴（8）・外縁（8）・芯（4）は発光の値を付けて出し、点線と塗りは発光させない。文字の層には何も描かない", () => {
    const { canvas, shapes, client, draw } = setup();
    for (let i = 0; i < 10; i++) receive(client, 0.5, [0.1, 0.1, 0.1], 0.5, -0.25, i);
    draw();
    expect(history(shapes).map((s) => s.style.glow)).toEqual([8, 8]);
    expect(outer(shapes).map((s) => s.style.glow)).toEqual([8, 8]);
    expect(core(shapes).style.glow).toBe(4);
    expect(bands(shapes, 0.22).every((s) => !s.style.glow)).toBe(true);
    expect(rects(shapes, "MUTED").every((r) => r.glow === 0)).toBe(true);
    expect(canvas.shapes).toHaveLength(0);
    expect(canvas.texts).toHaveLength(0);
    expect(canvas.images).toHaveLength(0);
  });

  it("帯域別の色の履歴は、発光 6 で出す", () => {
    const { shapes, client, draw } = setup({ histColor: "bands" });
    receive(client, 0.5, [0.9, 0.05, 0.05], 0, 0, 0);
    draw();
    expect(rects(shapes, "MAIN").map((r) => r.glow)).toEqual([6]);
  });

  it("格子線（8×2）を、太さ1の四角で描く（最初に出すので、ほかの図形の下になる）", () => {
    const { shapes, draw } = setup();
    draw();
    expect(shapes[0]).toMatchObject({ op: "rects", style: { color: "GRID" } });
    const grid = rects(shapes, "GRID");
    expect(grid).toHaveLength(8 - 1 + (2 - 1));
    expect(grid.filter((r) => r.width === 1).map((r) => r.x)).toEqual([1, 2, 3, 4, 5, 6, 7].map((i) => Math.round((WIDTH * i) / 8)));
    expect(grid.find((r) => r.height === 1)).toMatchObject({ x: 0, y: MID, width: WIDTH });
  });

  it("フレームも履歴もまだないときは、格子と平らな今の波形だけを描く", () => {
    const { shapes, draw } = setup();
    draw();
    expect(history(shapes)).toHaveLength(0);
    expect(pairs(core(shapes).points).every((p) => Math.abs(p[1] - MID) < 1e-6)).toBe(true);
  });

  it("大きさが0のあいだは何も描かない", () => {
    const canvas = recordingCanvas();
    const recording = recordingShapeSink();
    const renderer = waveModule.createRenderer({ ctx: canvas.ctx });
    renderer.draw(null, new FrameClient().histories, DEFAULTS, COLORS, 1 / 60, testDrawOutput(canvas.ctx, recording));
    expect(recording.shapes).toHaveLength(0);
  });
});
