import { describe, expect, it } from "vitest";
import { FrameClient, SectionId, VU_FLOOR_DB } from "../../frame_client";
import { encodeTestFrame } from "../../frame_client/test_frames";
import type { Translate } from "../../i18n/use_t";
import { trailAlpha } from "../stereo/stereo_math";
import { recordingCanvas } from "../test_canvas";
import type { PaletteColors } from "../types";
import { vuModule } from "./index";
import { SCALE_MIN_DB, TRAIL_ALPHA, needleAngle, pointOnArc, scaleTicks, vuLayout } from "./vu_math";
import { pairs, recordingShapeSink, splitRects, testDrawOutput, type RecordedShape } from "../test_shapes";

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

/** 辞書の代わり：キーをそのまま返す */
const translate = ((key: string) => key) as unknown as Translate;

function setup(withTranslate = true) {
  const canvas = recordingCanvas();
  const recording = recordingShapeSink();
  const renderer = vuModule.createRenderer({ ctx: canvas.ctx, translate: withTranslate ? translate : undefined });
  renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
  const client = new FrameClient();
  let seq = 0;
  /** values は [L, R]（VU の dB）。null なら届かない */
  const draw = (values: [number, number] | null, dt = DT) => {
    canvas.clear();
    recording.clear();
    if (values) client.receive(encodeTestFrame({ seq: seq++, sections: [[SectionId.Vu, values]] }));
    renderer.draw(values ? client.latest : null, client.histories, {}, COLORS, dt, testDrawOutput(canvas.ctx, recording));
  };
  return { canvas, recording, renderer, draw };
}

const layout = vuLayout(WIDTH, HEIGHT);
const NEEDLE_LENGTH = layout.radius * 0.98;
type Stroke = Extract<RecordedShape, { op: "polyline" }>;
const strokes = (shapes: RecordedShape[], color: string) => shapes.filter((s): s is Stroke => s.op === "polyline" && s.style.color === color);
/** 針（根元から先へ引いた線）の先の点 */
const tip = (shape: Stroke) => pairs(shape.points)[1];
/** dB を指す針の先の点 */
const tipAt = (db: number) => pointOnArc(layout, needleAngle(db), NEEDLE_LENGTH);

describe("vu モジュールの定義", () => {
  it("VU のセクションを読み、方向を持たない。設定項目はなく、初期状態は無効", () => {
    expect(vuModule.kind).toBe("vu");
    expect(vuModule.labelKey).toBe("modules.vu");
    expect(vuModule.sections).toEqual([SectionId.Vu]);
    expect(vuModule.shape).toBe("compact");
    expect(vuModule.baseDirection).toBeNull();
    expect(vuModule.flows).toBe(false);
    expect(vuModule.defaultOptions).toEqual({});
    expect(vuModule.inspectorFields).toEqual([]);
    expect(vuModule.defaultInstances).toEqual([{ enabled: false }]);
  });
});

describe("vu モジュールの描画", () => {
  it("L は主色、R は副色の針で、それぞれの dB の角度を指す", () => {
    const { recording, draw } = setup();
    draw([-3, -10]);
    const [left] = strokes(recording.shapes, "MAIN");
    const [right] = strokes(recording.shapes, "SUB");
    expect(left.style.width).toBe(1.4);
    expect(left.style.glow).toBe(8);
    expect(right.style.glow).toBe(8);
    expect(pairs(left.points)[0]).toEqual([layout.pivotX, layout.pivotY]);
    expect(tip(left)[0]).toBeCloseTo(tipAt(-3)[0], 8);
    expect(tip(left)[1]).toBeCloseTo(tipAt(-3)[1], 8);
    expect(tip(right)[0]).toBeCloseTo(tipAt(-10)[0], 8);
    expect(tip(right)[1]).toBeCloseTo(tipAt(-10)[1], 8);
    // L の方が大きいので、先は右にある
    expect(tip(left)[0]).toBeGreaterThan(tip(right)[0]);
  });

  it("目盛りの範囲を超えた値は端で止まる。針が振れていない値は下端", () => {
    const { recording, draw } = setup();
    draw([30, VU_FLOOR_DB]);
    expect(tip(strokes(recording.shapes, "MAIN")[0])[0]).toBeCloseTo(tipAt(3)[0], 8);
    expect(tip(strokes(recording.shapes, "SUB")[0])[0]).toBeCloseTo(tipAt(SCALE_MIN_DB)[0], 8);
  });

  it("目盛りの点を 47 個（大きい点 11 個は濃く）と、0〜+3 の強調帯を強調色で描く", () => {
    const { recording, draw } = setup();
    draw([-20, -20]);
    const ticks = recording.shapes.flatMap((s) => (s.op === "rects" && s.style.color === "MUTED" ? splitRects(s) : []));
    expect(ticks).toHaveLength(scaleTicks().length);
    expect(ticks.filter((t) => Math.abs(t.alpha - 0.9) < 1e-6)).toHaveLength(11);
    expect(ticks.filter((t) => Math.abs(t.alpha - 0.4) < 1e-6)).toHaveLength(36);
    // 大きい点は 3 ピクセル角で、目盛りの円の上に中心がある
    const big = ticks.filter((t) => Math.abs(t.alpha - 0.9) < 1e-6);
    expect(big.every((t) => t.width === 3 && t.height === 3)).toBe(true);
    const [x0, y0] = pointOnArc(layout, needleAngle(-20), layout.radius);
    expect(big[0].x + 1.5).toBeCloseTo(x0, 4);
    expect(big[0].y + 1.5).toBeCloseTo(y0, 4);
    const [hot] = strokes(recording.shapes, "ACCENT");
    expect(hot.style.width).toBe(3);
    expect(hot.style.glow).toBe(6);
    // 強調帯は 0 dB から +3 dB までの弧（半径は目盛りの 0.92 倍）
    const arc = pairs(hot.points);
    const start = pointOnArc(layout, needleAngle(0), layout.radius * 0.92);
    const end = pointOnArc(layout, needleAngle(3), layout.radius * 0.92);
    expect(arc[0][0]).toBeCloseTo(start[0], 3);
    expect(arc[0][1]).toBeCloseTo(start[1], 3);
    expect(arc[arc.length - 1][0]).toBeCloseTo(end[0], 3);
    expect(arc[arc.length - 1][1]).toBeCloseTo(end[1], 3);
    for (const [x, y] of arc) expect(Math.hypot(x - layout.pivotX, y - layout.pivotY)).toBeCloseTo(layout.radius * 0.92, 3);
  });

  it("根元は控えめな文字色の円い点（半径 3）。図形は文字の層に描かない", () => {
    const { canvas, recording, draw } = setup();
    draw([-20, -20]);
    const pivot = recording.shapes.find((s) => s.op === "points");
    expect(pivot).toMatchObject({ op: "points", points: [layout.pivotX, layout.pivotY], radius: 3, style: { color: "MUTED" } });
    expect(canvas.shapes).toHaveLength(0);
    expect(canvas.ctx.shadowBlur).toBe(0);
  });

  it("数字（−20・−10・−5・0・+3）と見出しを描く。見出しは辞書を通す", () => {
    const { canvas, draw } = setup();
    draw([-20, -20]);
    expect(canvas.texts.map((t) => t.text)).toEqual(["−20", "−10", "−5", "0", "+3", "modules.vu"]);
    expect(canvas.texts.every((t) => t.style === "MUTED" && t.font.endsWith("NUMERIC"))).toBe(true);
    const title = canvas.texts[canvas.texts.length - 1];
    expect([title.x, title.y]).toEqual([layout.pivotX, layout.pivotY - layout.radius * 0.35]);
  });

  it("辞書が渡されなければ、見出しは「VU」（落ちない）", () => {
    const { canvas, draw } = setup(false);
    draw([-20, -20]);
    expect(canvas.texts[canvas.texts.length - 1].text).toBe("VU");
  });

  it("残像：描くたびに地の色を薄く重ね、不透明度は経過時間に合わせる", () => {
    const { recording, draw } = setup();
    draw([-10, -10], 1 / 30);
    // 残像は図形より先に1度だけ
    const [trail] = recording.shapes;
    expect(trail).toMatchObject({ op: "trail", color: "BG" });
    expect(trail.op === "trail" && trail.alpha).toBeCloseTo(trailAlpha(TRAIL_ALPHA, 1 / 30), 10);
    expect(recording.shapes.filter((s) => s.op === "trail")).toHaveLength(1);
  });
});

describe("vu モジュールの描画：受信が途切れたとき", () => {
  it("届いていないときは、針が下端へ戻っていく（急には落ちない）", () => {
    const { recording, draw } = setup();
    draw([0, 0]);
    expect(tip(strokes(recording.shapes, "MAIN")[0])[0]).toBeCloseTo(tipAt(0)[0], 8);

    // 値が読めない回：1 回分では下端に届かないが、少しは戻る
    draw(null);
    const x1 = tip(strokes(recording.shapes, "MAIN")[0])[0];
    expect(x1).toBeLessThan(tipAt(0)[0]);
    expect(x1).toBeGreaterThan(tipAt(SCALE_MIN_DB)[0]);

    for (let i = 0; i < 120; i++) draw(null);
    expect(tip(strokes(recording.shapes, "MAIN")[0])[0]).toBeCloseTo(tipAt(SCALE_MIN_DB)[0], 1);
  });

  it("最初の描画は下端（針は休んだ位置）。大きさが 0 なら何も描かない", () => {
    const { canvas, recording, draw, renderer } = setup();
    draw(null, 0);
    expect(tip(strokes(recording.shapes, "MAIN")[0])[0]).toBeCloseTo(tipAt(SCALE_MIN_DB)[0], 8);

    renderer.resize({ width: 0, height: 0, devicePixelRatio: 1, quarterTurns: 0 });
    canvas.clear();
    recording.clear();
    renderer.draw(null, new FrameClient().histories, {}, COLORS, DT, testDrawOutput(canvas.ctx, recording));
    expect(canvas.shapes).toHaveLength(0);
    expect(recording.shapes).toHaveLength(0);
  });

  it("dispose すると針は休んだ位置に戻る", () => {
    const { recording, draw, renderer } = setup();
    draw([0, 0]);
    renderer.dispose();
    draw(null, 0);
    expect(tip(strokes(recording.shapes, "MAIN")[0])[0]).toBeCloseTo(tipAt(SCALE_MIN_DB)[0], 8);
  });
});
