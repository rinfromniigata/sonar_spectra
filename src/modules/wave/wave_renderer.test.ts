import { describe, expect, it } from "vitest";
import { FLAG_STALE, FrameClient, SectionId, WAVE_NOW_POINTS } from "../../frame_client";
import { encodeTestFrame } from "../../frame_client/test_frames";
import type { WaveOptions } from "../options";
import { joinedView, recordingBuffers, recordingCanvas, type DrawnShape } from "../test_canvas";
import type { PaletteColors } from "../types";
import { waveModule } from "./index";
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
  const raw = recordingCanvas();
  const buffers = recordingBuffers();
  const renderer = waveModule.createRenderer({ ctx: raw.ctx, createBuffer: buffers.createBuffer });
  renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
  const client = new FrameClient();
  const draw = () => renderer.draw(client.latest, client.histories, { ...DEFAULTS, ...options }, COLORS, 1 / 60, testDrawOutput(raw.ctx));
  // 短い区間・帯に分けて描いた線と塗りは、1本・1つにまとめて調べる
  return { canvas: joinedView(raw), client, draw, buffers };
}

const fills = (shapes: DrawnShape[], style: string) => shapes.filter((s) => s.op === "fill" && s.style === style);
const strokes = (shapes: DrawnShape[], style: string) => shapes.filter((s) => s.op === "stroke" && s.style === style);
const maxX = (s: DrawnShape) => Math.max(...s.points.map((p) => p[0]));
const minX = (s: DrawnShape) => Math.min(...s.points.map((p) => p[0]));

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
    const { canvas, client, draw } = setup();
    for (let i = 0; i < 10; i++) receive(client, 0.5, [0.1, 0.1, 0.1], 0, 0, i);
    draw();

    const split = Math.round(WIDTH * 0.72);
    const history = canvas.shapes.filter((s) => s.op === "fill" && s.alpha === 0.9);
    expect(history.map((s) => s.style)).toEqual(["MAIN", "SUB"]);
    const [upper, lower] = history;
    expect(maxX(upper)).toBe(split);
    // 上の帯は中心より上、下の帯は中心より下
    expect(Math.min(...upper.points.map((p) => p[1]))).toBeCloseTo(MID - 0.5 * MID * 0.92, 6);
    expect(Math.max(...lower.points.map((p) => p[1]))).toBeCloseTo(MID + 0.5 * MID * 0.92, 6);
    // 10行 × 4px：最新の行が境目、最も古い行が 9 行分左
    expect(minX(upper)).toBe(split - 9 * 4);
  });

  it("モノラル：履歴は混ぜた値を主色で上下対称に描き、今の波形も1本", () => {
    const { canvas, client, draw } = setup({ channel: "mono" });
    receive(client, 0.4, [0.1, 0.1, 0.1], 0.5, -0.5, 0);
    receive(client, 0.4, [0.1, 0.1, 0.1], 0.5, -0.5, 1);
    draw();
    const history = canvas.shapes.filter((s) => s.op === "fill" && s.alpha === 0.9);
    expect(history.map((s) => s.style)).toEqual(["MAIN", "MAIN"]);
    // 今の波形：外縁の線は主色の1本（ステレオなら主色と副色の2本）
    expect(strokes(canvas.shapes, "SUB")).toHaveLength(0);
  });

  it("今の波形：境目に点線を引き、外縁（2本）と芯を描き、両端は中心に戻る", () => {
    const { canvas, client, draw } = setup();
    receive(client, 0.5, [0.1, 0.1, 0.1], 0.5, -0.25, 0);
    draw();

    const split = Math.round(WIDTH * 0.72);
    const dashed = canvas.shapes.filter((s) => s.dashed);
    expect(dashed).toHaveLength(1);
    expect(dashed[0].style).toBe("MUTED");
    expect(dashed[0].points[0][0]).toBe(split + 0.5);

    const outer = canvas.shapes.filter((s) => s.op === "stroke" && s.alpha === 0.75);
    expect(outer.map((s) => s.style)).toEqual(["MAIN", "SUB"]);
    const core = canvas.shapes.find((s) => s.op === "stroke" && s.lineWidth === 1.8)!;
    expect(core.style).toBe("MAIN");
    for (const line of [...outer, core]) {
      expect(minX(line)).toBe(split);
      expect(line.points[0][1]).toBeCloseTo(MID, 6);
      expect(line.points[line.points.length - 1][1]).toBeCloseTo(MID, 6);
    }
    // L（+0.5）は中心より上へ、R（-0.25）は中心より下へ振れる
    const middle = (s: DrawnShape) => s.points[Math.floor(s.points.length / 2)][1];
    expect(middle(outer[0])).toBeLessThan(MID);
    expect(middle(outer[1])).toBeGreaterThan(MID);
    // 半透明の塗りが2本分
    expect(canvas.shapes.filter((s) => s.op === "fill" && s.alpha === 0.22)).toHaveLength(2);
  });

  it("今の波形を出さないときは、履歴が右端まで流れ、点線と今の波形を描かない", () => {
    const { canvas, client, draw } = setup({ showNow: false });
    for (let i = 0; i < 5; i++) receive(client, 0.5, [0.1, 0.1, 0.1], 0.5, 0.5, i);
    draw();
    expect(canvas.shapes.some((s) => s.dashed)).toBe(false);
    expect(canvas.shapes.some((s) => s.op === "stroke" && s.alpha === 0.75)).toBe(false);
    expect(maxX(fills(canvas.shapes, "MAIN")[0])).toBe(WIDTH);
  });

  it("帯域別の色：列ごとに強い帯域の色で塗る（低＝主色、高＝副色、中＝強調色）", () => {
    const { canvas, client, draw } = setup({ histColor: "bands" });
    receive(client, 0.5, [0.9, 0.05, 0.05], 0, 0, 0);
    receive(client, 0.5, [0.05, 0.1, 0.85], 0, 0, 1);
    receive(client, 0.5, [0.1, 0.8, 0.1], 0, 0, 2);
    draw();
    const columns = canvas.shapes.filter((s) => s.op === "fillRect" && s.alpha === 0.9);
    expect(columns.map((s) => s.style)).toEqual(["MAIN", "SUB", "ACCENT"]);
  });

  it("流れる速さで、1行の幅が変わる", () => {
    const { canvas, client, draw } = setup({ speed: 2 });
    for (let i = 0; i < 10; i++) receive(client, 0.5, [0.1, 0.1, 0.1], 0, 0, i);
    draw();
    const upper = fills(canvas.shapes, "MAIN")[0];
    expect(maxX(upper) - minX(upper)).toBe(9 * 8);
  });

  it("届いていない（STALE）フレームは履歴に積まれないので、履歴の長さは変わらない", () => {
    const { canvas, client, draw } = setup();
    receive(client, 0.5, [0.1, 0.1, 0.1], 0, 0, 0);
    receive(client, 0.5, [0.1, 0.1, 0.1], 0, 0, 1);
    client.receive(encodeTestFrame({ seq: 2, flags: FLAG_STALE, sections: [[SectionId.Waveform, Array(5 + 2 * WAVE_NOW_POINTS).fill(0)]] }));
    draw();
    const upper = canvas.shapes.filter((s) => s.op === "fill" && s.alpha === 0.9 && s.style === "MAIN")[0];
    // 2行だけ（1行分の幅）
    expect(maxX(upper) - minX(upper)).toBe(4);
  });

  it("履歴が1行だけのあいだは、幅のない履歴を描かない", () => {
    const { canvas, client, draw } = setup();
    receive(client, 0.5, [0.1, 0.1, 0.1], 0, 0, 0);
    draw();
    expect(canvas.shapes.filter((s) => s.op === "fill" && s.alpha === 0.9)).toHaveLength(0);
  });

  it("発光：履歴・外縁・芯は、縮小した画像に描いてぼかしたものを先に敷く（shadowBlur は使わない）", () => {
    const { canvas, client, draw, buffers } = setup();
    for (let i = 0; i < 10; i++) receive(client, 0.5, [0.1, 0.1, 0.1], 0.5, -0.25, i);
    draw();
    // 履歴（8）・外縁（8）・芯（4）の3回。どれも 1/2 に縮小した画像（形用とぼかし用の2枚）を使い回す
    expect(buffers.created.map((b) => [b.width, b.height])).toEqual([
      [WIDTH / 2, HEIGHT / 2],
      [WIDTH / 2, HEIGHT / 2],
    ]);
    expect(canvas.raw.images.map((i) => i.args)).toEqual([
      [0, 0, WIDTH, HEIGHT],
      [0, 0, WIDTH, HEIGHT],
      [0, 0, WIDTH, HEIGHT],
    ]);
    const blurred = buffers.created[1].rc.images.map((i) => i.filter);
    expect(blurred).toEqual(["blur(2px)", "blur(2px)", "blur(1px)"]);
  });

  it("フレームも履歴もまだないときは、格子と平らな今の波形だけを描く", () => {
    const { canvas, draw } = setup();
    draw();
    expect(canvas.shapes.filter((s) => s.op === "fill" && s.alpha === 0.9)).toHaveLength(0);
    const core = canvas.shapes.find((s) => s.op === "stroke" && s.lineWidth === 1.8)!;
    expect(core.points.every((p) => Math.abs(p[1] - MID) < 1e-9)).toBe(true);
  });
});
