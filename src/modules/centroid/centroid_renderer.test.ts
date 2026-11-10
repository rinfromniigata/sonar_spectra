import { describe, expect, it } from "vitest";
import { FLAG_STALE, FrameClient, SectionId } from "../../frame_client";
import { encodeTestFrame } from "../../frame_client/test_frames";
import { recordingCanvas } from "../test_canvas";
import { pairs, recordingShapeSink, splitRects, testDrawOutput, type RecordedShape } from "../test_shapes";
import type { PaletteColors } from "../types";
import { centroidModule } from "./index";
import { READOUT_INTERVAL, axisPosition, centroidLayout, columnStep, fluxLevel, lineY } from "./centroid_math";

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
const WIDTH = 300;
const HEIGHT = 100;
const DT = 1 / 60;
const layout = centroidLayout(HEIGHT);
const options = { speed: 1 };

function setup() {
  const canvas = recordingCanvas();
  const recording = recordingShapeSink();
  const renderer = centroidModule.createRenderer({ ctx: canvas.ctx });
  renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
  const client = new FrameClient();
  let seq = 0;
  /** 1行（1フレーム）届けて描く */
  const push = (hz: number, flux: number, flags = 0) =>
    client.receive(encodeTestFrame({ seq: seq++, flags, sections: [[SectionId.Centroid, [hz, flux]]] }));
  const draw = (dt = DT, drawOptions = options) => {
    canvas.clear();
    recording.clear();
    renderer.draw(client.latest, client.histories, drawOptions, COLORS, dt, testDrawOutput(canvas.ctx, recording));
  };
  return { canvas, shapes: recording.shapes, renderer, client, push, draw };
}

type Polyline = Extract<RecordedShape, { op: "polyline" }>;
type Rects = Extract<RecordedShape, { op: "rects" }>;

const lines = (shapes: RecordedShape[]) => shapes.filter((s): s is Polyline => s.op === "polyline" && s.style.color === "MAIN");
/** 変化量の棒（格子線も1pxの四角で描くので、格子の色は除く） */
const bars = (shapes: RecordedShape[]) =>
  shapes
    .filter((s): s is Rects => s.op === "rects" && s.style.color !== "GRID")
    .flatMap((s) => splitRects(s).map((r) => ({ ...r, color: s.style.color, glow: s.style.glow ?? 0 })))
    .sort((a, b) => a.x - b.x);

describe("centroid モジュールの定義", () => {
  it("重心のセクションを読み、細長い枠で、左へ流れる。初期状態は無効", () => {
    expect(centroidModule.kind).toBe("centroid");
    expect(centroidModule.labelKey).toBe("modules.centroid");
    expect(centroidModule.sections).toEqual([SectionId.Centroid]);
    expect(centroidModule.shape).toBe("long");
    expect(centroidModule.baseDirection).toBe("left");
    expect(centroidModule.flows).toBe(true);
    expect(centroidModule.defaultOptions).toEqual({ speed: 1 });
    expect(centroidModule.inspectorFields).toEqual([]);
    expect(centroidModule.defaultInstances).toEqual([{ enabled: false }]);
  });
});

describe("受信側の履歴（重心）", () => {
  it("新しいサンプルのあるフレームだけ [重心, フラックス] を積む。セクションのないフレームは積まない", () => {
    const { client, push } = setup();
    push(1000, 0.1);
    push(2000, 0.2);
    push(3000, 0.3, FLAG_STALE);
    client.receive(encodeTestFrame({ seq: 99, sections: [] }));
    const history = client.histories.centroid;
    expect(history.width).toBe(2);
    expect(history.length).toBe(2);
    expect(Array.from(history.row(1))).toEqual([2000, expect.closeTo(0.2, 6)]);
    client.reset();
    expect(history.length).toBe(0);
  });
});

describe("centroid モジュールの描画", () => {
  it("履歴がなくても落ちず、格子と「—」だけを描く", () => {
    const { canvas, shapes, draw } = setup();
    draw();
    expect(lines(shapes)).toHaveLength(0);
    expect(bars(shapes)).toHaveLength(0);
    // 格子線（8×4）を、太さ1の四角で
    expect(shapes).toHaveLength(1);
    expect(splitRects(shapes[0] as Rects)).toHaveLength(8 - 1 + (4 - 1));
    expect(canvas.texts.map((t) => t.text)).toEqual(["—"]);
    expect(canvas.texts[0]).toMatchObject({ style: "MUTED", x: WIDTH - 6, y: layout.top + 2 });
    // 図形は文字の層に描かない
    expect(canvas.shapes).toHaveLength(0);
  });

  it("最新の行が右端。重心の線は主色（太さ 1.6・発光 10）で、対数の軸の高さに引く（一定なら水平）", () => {
    const { shapes, push, draw } = setup();
    for (let i = 0; i < 200; i++) push(1000, 0);
    draw();
    const [line] = lines(shapes);
    expect(line.style).toMatchObject({ width: 1.6, glow: 10 });
    const points = pairs(line.points);
    const step = columnStep(1);
    const last = points[points.length - 1];
    expect(last[0]).toBeCloseTo(WIDTH - step, 4);
    const y = lineY(layout, axisPosition(1000));
    for (const [, py] of points) expect(py).toBeCloseTo(y, 3);
    // 幅を埋める分だけの点（100 列）
    expect(points).toHaveLength(Math.ceil(WIDTH / step));
  });

  it("流れる速さを上げると、1行の幅が広がり、点の数が減る", () => {
    const { shapes, push, draw } = setup();
    for (let i = 0; i < 200; i++) push(1000, 0);
    draw(DT, { speed: 2 });
    const points = pairs(lines(shapes)[0].points);
    expect(points).toHaveLength(Math.ceil(WIDTH / 6));
    expect(points[1][0] - points[0][0]).toBe(6);
  });

  it("変化量の棒：高さはフラックスに比例し、下端から立つ。大きい列は強調色、小さい列は副色。発光させない", () => {
    const { shapes, push, draw } = setup();
    push(1000, 0.1);
    push(1000, 0.4);
    push(1000, 0);
    draw();
    const found = bars(shapes);
    // 0 の列は描かない
    expect(found).toHaveLength(2);
    const [small, large] = found;
    expect(small.color).toBe("SUB");
    expect(large.color).toBe("ACCENT");
    expect(small.y + small.height).toBeCloseTo(HEIGHT, 6);
    expect(small.height).toBeCloseTo(fluxLevel(0.1) * layout.fluxHeight, 4);
    expect(large.alpha).toBeCloseTo(0.3 + 0.7 * fluxLevel(0.4), 5);
    expect(found.every((b) => b.glow === 0)).toBe(true);
    // 右端が最新：最後の列（フラックス 0）は描かず、その1つ手前が large
    const step = columnStep(1);
    expect(large.x).toBeCloseTo(WIDTH - 2 * step, 8);
    expect(small.x).toBeCloseTo(WIDTH - 3 * step, 8);
    // 棒の幅は1列から1ピクセル引いたもの
    expect(small.width).toBe(step - 1);
  });

  it("数値：重心と変化量を右寄せで出す", () => {
    const { canvas, push, draw } = setup();
    for (let i = 0; i < 20; i++) push(1500, 0.25);
    draw();
    expect(canvas.texts.map((t) => t.text)).toEqual(["1.5 kHz", "Δ 0.50"]);
    expect(canvas.texts[1].y).toBeCloseTo(HEIGHT - layout.fluxHeight - 4, 8);
    expect(canvas.texts.every((t) => t.style === "MUTED" && t.font.endsWith("NUMERIC"))).toBe(true);
  });

  it("数値は 0.25 秒ごとにしか書き換えない", () => {
    const { canvas, push, draw } = setup();
    for (let i = 0; i < 20; i++) push(1000, 0);
    draw();
    expect(canvas.texts[0].text).toBe("1.0 kHz");
    for (let i = 0; i < 20; i++) push(2000, 0);
    draw(READOUT_INTERVAL / 2);
    expect(canvas.texts[0].text).toBe("1.0 kHz");
    draw(READOUT_INTERVAL / 2);
    expect(canvas.texts[0].text).toBe("2.0 kHz");
  });

  it("無音のときは「—」を出し、変化量は出さない。線は下端へ戻る", () => {
    const { canvas, shapes, push, draw } = setup();
    for (let i = 0; i < 200; i++) push(0, 0);
    draw();
    expect(canvas.texts.map((t) => t.text)).toEqual(["—"]);
    const [line] = lines(shapes);
    for (const [, py] of pairs(line.points)) expect(py).toBeCloseTo(lineY(layout, 0), 4);
  });

  it("dispose すると数値は次の描画で読み直す。大きさが 0 なら何も描かない", () => {
    const { canvas, shapes, push, draw, renderer } = setup();
    for (let i = 0; i < 20; i++) push(1000, 0);
    draw();
    renderer.dispose();
    for (let i = 0; i < 20; i++) push(2000, 0);
    draw(0);
    expect(canvas.texts[0].text).toBe("2.0 kHz");

    renderer.resize({ width: 0, height: 0, devicePixelRatio: 1, quarterTurns: 0 });
    draw();
    expect(shapes).toHaveLength(0);
    expect(canvas.texts).toHaveLength(0);
  });
});
