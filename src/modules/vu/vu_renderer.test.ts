import { describe, expect, it } from "vitest";
import { FrameClient, SectionId, VU_FLOOR_DB } from "../../frame_client";
import { encodeTestFrame } from "../../frame_client/test_frames";
import type { Translate } from "../../i18n/use_t";
import { trailAlpha } from "../stereo/stereo_math";
import { recordingCanvas, type DrawnShape } from "../test_canvas";
import type { PaletteColors } from "../types";
import { vuModule } from "./index";
import { SCALE_MIN_DB, TRAIL_ALPHA, needleAngle, pointOnArc, scaleTicks, vuLayout } from "./vu_math";

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
  const renderer = vuModule.createRenderer({ ctx: canvas.ctx, translate: withTranslate ? translate : undefined });
  renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
  const client = new FrameClient();
  let seq = 0;
  /** values は [L, R]（VU の dB）。null なら届かない */
  const draw = (values: [number, number] | null, dt = DT) => {
    canvas.clear();
    if (values) client.receive(encodeTestFrame({ seq: seq++, sections: [[SectionId.Vu, values]] }));
    renderer.draw(values ? client.latest : null, client.histories, {}, COLORS, dt);
  };
  return { canvas, renderer, draw };
}

const layout = vuLayout(WIDTH, HEIGHT);
const NEEDLE_LENGTH = layout.radius * 0.98;
const strokes = (shapes: DrawnShape[], style: string) => shapes.filter((s) => s.op === "stroke" && s.style === style);
/** 針（根元から先へ引いた線）の先の点 */
const tip = (shape: DrawnShape) => shape.points[1];
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
    const { canvas, draw } = setup();
    draw([-3, -10]);
    const [left] = strokes(canvas.shapes, "MAIN");
    const [right] = strokes(canvas.shapes, "SUB");
    expect(left.lineWidth).toBe(1.4);
    expect(left.points[0]).toEqual([layout.pivotX, layout.pivotY]);
    expect(tip(left)[0]).toBeCloseTo(tipAt(-3)[0], 8);
    expect(tip(left)[1]).toBeCloseTo(tipAt(-3)[1], 8);
    expect(tip(right)[0]).toBeCloseTo(tipAt(-10)[0], 8);
    expect(tip(right)[1]).toBeCloseTo(tipAt(-10)[1], 8);
    // L の方が大きいので、先は右にある
    expect(tip(left)[0]).toBeGreaterThan(tip(right)[0]);
  });

  it("目盛りの範囲を超えた値は端で止まる。針が振れていない値は下端", () => {
    const { canvas, draw } = setup();
    draw([30, VU_FLOOR_DB]);
    expect(tip(strokes(canvas.shapes, "MAIN")[0])[0]).toBeCloseTo(tipAt(3)[0], 8);
    expect(tip(strokes(canvas.shapes, "SUB")[0])[0]).toBeCloseTo(tipAt(SCALE_MIN_DB)[0], 8);
  });

  it("目盛りの点を 47 個（大きい点 11 個は濃く）と、0〜+3 の強調帯を強調色で描く", () => {
    const { canvas, draw } = setup();
    draw([-20, -20]);
    const ticks = canvas.shapes.filter((s) => s.op === "fillRect" && s.style === "MUTED");
    expect(ticks).toHaveLength(scaleTicks().length);
    expect(ticks.filter((t) => t.alpha === 0.9)).toHaveLength(11);
    expect(ticks.filter((t) => t.alpha === 0.4)).toHaveLength(36);
    const [hot] = strokes(canvas.shapes, "ACCENT");
    expect(hot.lineWidth).toBe(3);
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
    const { canvas, draw } = setup();
    draw([-10, -10], 1 / 30);
    const [trail] = canvas.shapes;
    expect(trail).toMatchObject({ op: "fillRect", style: "BG" });
    expect(trail.alpha).toBeCloseTo(trailAlpha(TRAIL_ALPHA, 1 / 30), 10);
    expect(trail.points).toEqual([
      [0, 0],
      [WIDTH, HEIGHT],
    ]);
  });
});

describe("vu モジュールの描画：受信が途切れたとき", () => {
  it("届いていないときは、針が下端へ戻っていく（急には落ちない）", () => {
    const { canvas, draw } = setup();
    draw([0, 0]);
    expect(tip(strokes(canvas.shapes, "MAIN")[0])[0]).toBeCloseTo(tipAt(0)[0], 8);

    // 値が読めない回：1 回分では下端に届かないが、少しは戻る
    draw(null);
    const x1 = tip(strokes(canvas.shapes, "MAIN")[0])[0];
    expect(x1).toBeLessThan(tipAt(0)[0]);
    expect(x1).toBeGreaterThan(tipAt(SCALE_MIN_DB)[0]);

    for (let i = 0; i < 120; i++) draw(null);
    expect(tip(strokes(canvas.shapes, "MAIN")[0])[0]).toBeCloseTo(tipAt(SCALE_MIN_DB)[0], 1);
  });

  it("最初の描画は下端（針は休んだ位置）。大きさが 0 なら何も描かない", () => {
    const { canvas, draw, renderer } = setup();
    draw(null, 0);
    expect(tip(strokes(canvas.shapes, "MAIN")[0])[0]).toBeCloseTo(tipAt(SCALE_MIN_DB)[0], 8);

    renderer.resize({ width: 0, height: 0, devicePixelRatio: 1, quarterTurns: 0 });
    canvas.clear();
    renderer.draw(null, new FrameClient().histories, {}, COLORS, DT);
    expect(canvas.shapes).toHaveLength(0);
  });

  it("dispose すると針は休んだ位置に戻る", () => {
    const { canvas, draw, renderer } = setup();
    draw([0, 0]);
    renderer.dispose();
    draw(null, 0);
    expect(tip(strokes(canvas.shapes, "MAIN")[0])[0]).toBeCloseTo(tipAt(SCALE_MIN_DB)[0], 8);
  });
});
