import { describe, expect, it } from "vitest";
import { FrameClient, SectionId } from "../../frame_client";
import { encodeTestFrame } from "../../frame_client/test_frames";
import type { PaletteColors } from "../types";
import { levelModule } from "./index";
import { barLeft, levelLayout, yOfDb } from "./level_math";
import { recordingShapeSink, splitRects, testDrawOutput, type RecordedShape } from "../test_shapes";

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

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  style: string;
}

/** 描いた四角と文字を記録する、Canvas の代わり（文字の層） */
function fakeContext() {
  const rects: Rect[] = [];
  const texts: { text: string; x: number; y: number }[] = [];
  const state: Record<string, unknown> = { fillStyle: "", font: "", globalAlpha: 1, shadowBlur: 0, shadowColor: "" };
  const ctx = new Proxy(state, {
    get(target, prop: string) {
      switch (prop) {
        case "fillRect":
          return (x: number, y: number, w: number, h: number) =>
            rects.push({ x, y, w, h, style: typeof target.fillStyle === "string" ? target.fillStyle : "gradient" });
        case "fillText":
          return (text: string, x: number, y: number) => texts.push({ text, x, y });
        case "createLinearGradient":
          return () => ({ addColorStop() {} });
        case "clearRect":
        case "save":
        case "restore":
          return () => {};
        default:
          return target[prop];
      }
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, rects, texts };
}

function levelFrame(peakL: number, peakR: number) {
  const client = new FrameClient();
  client.receive(encodeTestFrame({ sections: [[SectionId.Level, [peakL, peakR, 0, 0]]] }));
  return client.latest!;
}

const WIDTH = 100;
const HEIGHT = 300;
const layout = levelLayout(WIDTH, HEIGHT);
const geometry = { width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 as const };

/** 描画の層に出した四角を1つずつに分ける（style は色の文字列、色の移り変わりは "gradient"） */
function recordedRects(shapes: RecordedShape[]): (Rect & { alpha: number; glow: number; glowOnly: boolean })[] {
  return shapes.flatMap((shape) =>
    shape.op === "rects"
      ? splitRects(shape).map((r) => ({
          x: r.x,
          y: r.y,
          w: r.width,
          h: r.height,
          alpha: r.alpha,
          style: typeof shape.style.color === "string" ? shape.style.color : "gradient",
          glow: shape.style.glow ?? 0,
          glowOnly: shape.style.glowOnly ?? false,
        }))
      : [],
  );
}

function setup() {
  const fake = fakeContext();
  const recording = recordingShapeSink();
  const renderer = levelModule.createRenderer({ ctx: fake.ctx });
  renderer.resize(geometry);
  const draw = (frame: ReturnType<typeof levelFrame> | null, dt = 1 / 60) => {
    recording.clear();
    renderer.draw(frame, new FrameClient().histories, {}, COLORS, dt, testDrawOutput(fake.ctx, recording));
    return recordedRects(recording.shapes);
  };
  return { ...fake, recording, renderer, draw };
}

/** 指定のバーの塗り（グラデーション）の四角 */
function barFill(rects: Rect[], channel: 0 | 1): Rect | undefined {
  return rects.find((r) => r.style === "gradient" && r.x === barLeft(layout, channel));
}

/** 指定のバーのピークの印 */
function peakMark(rects: Rect[], channel: 0 | 1): Rect | undefined {
  return rects.find((r) => r.style === "ACCENT" && r.x === barLeft(layout, channel));
}

describe("level モジュールの定義", () => {
  it("レベルのセクションを読み、細長い枠に向き、既定は上向きで設定を持たない", () => {
    expect(levelModule.sections).toEqual([SectionId.Level]);
    expect(levelModule.shape).toBe("long");
    expect(levelModule.baseDirection).toBe("up");
    expect(levelModule.flows).toBe(false);
    expect(levelModule.defaultOptions).toEqual({});
    expect(levelModule.defaultInstances).toEqual([{ enabled: true }]);
  });
});

describe("level モジュールの描画", () => {
  it("L・R のピークに応じた高さのバーを、主色・副色の系統で描く", () => {
    const { draw } = setup();
    const rects = draw(levelFrame(0.5, 0.25));

    // 0.5 は約 -6 dB、0.25 は約 -12 dB
    const left = barFill(rects, 0)!;
    const right = barFill(rects, 1)!;
    expect(left.y).toBeCloseTo(yOfDb(layout, -6.0206), 3);
    expect(left.y + left.h).toBeCloseTo(layout.bottom, 6);
    expect(right.y).toBeCloseTo(yOfDb(layout, -12.0412), 3);
    expect(left.y).toBeLessThan(right.y);
    expect(left.w).toBe(layout.barWidth);
  });

  it("バーは不透明度 0.55 で、下から上へ色が移り、上端の 10% は強調色（発光はバーの色で、値は 3）", () => {
    const { recording, draw } = setup();
    const rects = draw(levelFrame(0.5, 0.25));
    const glows = rects.filter((r) => r.glowOnly);
    expect(glows.map((r) => [r.style, r.glow, r.alpha])).toEqual([
      ["MAIN", 3, 0.55],
      ["SUB", 3, 0.55],
    ]);
    // 発光だけの四角は、バーの塗りと同じ四角
    expect(glows[0]).toMatchObject({ x: barFill(rects, 0)!.x, y: barFill(rects, 0)!.y, h: barFill(rects, 0)!.h });
    const fills = recording.shapes.filter((s): s is Extract<RecordedShape, { op: "rects" }> => s.op === "rects" && typeof s.style.color !== "string");
    expect(fills).toHaveLength(2);
    expect(fills[0].style.alpha).toBe(0.55);
    expect(fills[0].style.glow ?? 0).toBe(0);
    expect(fills[1].style.color).toEqual({
      kind: "linear",
      x0: 0,
      y0: layout.bottom,
      x1: 0,
      y1: layout.top,
      stops: [
        { offset: 0, color: "SUB" },
        { offset: 0.85, color: "SUB" },
        { offset: 0.9, color: "ACCENT" },
      ],
    });
  });

  it("目盛りの線とバーの土台は格子の色で、図形は文字の層に描かない", () => {
    const { rects: textRects, draw } = setup();
    const rects = draw(levelFrame(0.5, 0.5));
    const grid = rects.filter((r) => r.style === "GRID");
    // 目盛り 7 本 ＋ 土台 2 本
    expect(grid).toHaveLength(9);
    expect(grid.filter((r) => r.h === 1).map((r) => r.y)).toEqual([0, -6, -12, -18, -24, -36, -48].map((db) => yOfDb(layout, db)).map((y) => Math.fround(y)));
    expect(textRects).toHaveLength(0);
  });

  it("まだフレームがない・無音のときは、バーを描かず、ピークの印は下端にある", () => {
    const { draw } = setup();
    let rects = draw(null);
    expect(barFill(rects, 0)).toBeUndefined();
    expect(barFill(rects, 1)).toBeUndefined();
    expect(peakMark(rects, 0)!.y).toBeCloseTo(layout.bottom - 1, 6);

    rects = draw(levelFrame(0, 0));
    expect(barFill(rects, 0)).toBeUndefined();
  });

  it("ピークの印は、音が止んでも一定の速さで下がる", () => {
    const { draw } = setup();
    let rects = draw(levelFrame(1, 1)); // 0 dB
    expect(peakMark(rects, 0)!.y).toBeCloseTo(layout.top - 1, 6);

    rects = draw(null, 1); // 1秒後：21 dB 下がる
    expect(peakMark(rects, 0)!.y).toBeCloseTo(yOfDb(layout, -21) - 1, 6);
  });

  it("目盛りの数字と L・R の文字を描く", () => {
    const { texts, draw } = setup();
    draw(levelFrame(0.5, 0.5));
    expect(texts.map((t) => t.text)).toEqual(["0", "-6", "-12", "-18", "-24", "-36", "-48", "L", "R"]);
  });

  it("大きさが決まる前は何も描かない", () => {
    const fake = fakeContext();
    const renderer = levelModule.createRenderer({ ctx: fake.ctx });
    const recording = recordingShapeSink();
    renderer.draw(levelFrame(0.5, 0.5), new FrameClient().histories, {}, COLORS, 0.016, testDrawOutput(fake.ctx, recording));
    expect(fake.rects).toHaveLength(0);
    expect(recording.shapes).toHaveLength(0);
  });
});
