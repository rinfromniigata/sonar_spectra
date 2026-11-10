import { describe, expect, it } from "vitest";
import { FLAG_STALE, FrameClient, SectionId } from "../../frame_client";
import { encodeTestFrame } from "../../frame_client/test_frames";
import { joinedView, recordingBuffers, recordingCanvas } from "../test_canvas";
import type { PaletteColors } from "../types";
import { centroidModule } from "./index";
import { READOUT_INTERVAL, axisPosition, centroidLayout, columnStep, fluxLevel, lineY } from "./centroid_math";
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
const WIDTH = 300;
const HEIGHT = 100;
const DT = 1 / 60;
const layout = centroidLayout(HEIGHT);
const options = { speed: 1 };

function setup() {
  const raw = recordingCanvas();
  const buffers = recordingBuffers();
  const renderer = centroidModule.createRenderer({ ctx: raw.ctx, createBuffer: buffers.createBuffer });
  // 短い区間に分けて描いた線は、1本にまとめて調べる
  const canvas = joinedView(raw);
  renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
  const client = new FrameClient();
  let seq = 0;
  /** 1行（1フレーム）届けて描く */
  const push = (hz: number, flux: number, flags = 0) =>
    client.receive(encodeTestFrame({ seq: seq++, flags, sections: [[SectionId.Centroid, [hz, flux]]] }));
  const draw = (dt = DT) => {
    canvas.clear();
    renderer.draw(client.latest, client.histories, options, COLORS, dt, testDrawOutput(raw.ctx));
  };
  return { canvas, renderer, client, push, draw, buffers };
}

const lines = (canvas: ReturnType<typeof setup>["canvas"]) => canvas.shapes.filter((s) => s.op === "stroke" && s.style === "MAIN");
/** 変化量の棒（格子線も1pxの四角で描くので、格子の色は除く） */
const bars = (canvas: ReturnType<typeof setup>["canvas"]) => canvas.shapes.filter((s) => s.op === "fillRect" && s.style !== "GRID");

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
    const { canvas, draw } = setup();
    draw();
    expect(lines(canvas)).toHaveLength(0);
    expect(bars(canvas)).toHaveLength(0);
    expect(canvas.texts.map((t) => t.text)).toEqual(["—"]);
    expect(canvas.texts[0]).toMatchObject({ style: "MUTED", x: WIDTH - 6, y: layout.top + 2 });
  });

  it("最新の行が右端。重心の線は主色で、対数の軸の高さに引く（一定なら水平）", () => {
    const { canvas, push, draw } = setup();
    for (let i = 0; i < 200; i++) push(1000, 0);
    draw();
    const [line] = lines(canvas);
    expect(line.lineWidth).toBe(1.6);
    const step = columnStep(1);
    const last = line.points[line.points.length - 1];
    expect(last[0]).toBeCloseTo(WIDTH - step, 8);
    const y = lineY(layout, axisPosition(1000));
    for (const [, py] of line.points) expect(py).toBeCloseTo(y, 3);
    // 幅を埋める分だけの点（100 列）
    expect(line.points).toHaveLength(Math.ceil(WIDTH / step));
  });

  it("流れる速さを上げると、1行の幅が広がり、点の数が減る", () => {
    const { canvas, push, renderer, client } = setup();
    for (let i = 0; i < 200; i++) push(1000, 0);
    canvas.clear();
    renderer.draw(client.latest, client.histories, { speed: 2 }, COLORS, DT, testDrawOutput(canvas.raw.ctx));
    const [line] = lines(canvas);
    expect(line.points).toHaveLength(Math.ceil(WIDTH / 6));
    expect(line.points[1][0] - line.points[0][0]).toBe(6);
  });

  it("変化量の棒：高さはフラックスに比例し、下端から立つ。大きい列は強調色、小さい列は副色", () => {
    const { canvas, push, draw } = setup();
    push(1000, 0.1);
    push(1000, 0.4);
    push(1000, 0);
    draw();
    const found = bars(canvas);
    // 0 の列は描かない
    expect(found).toHaveLength(2);
    const [small, large] = found;
    expect(small.style).toBe("SUB");
    expect(large.style).toBe("ACCENT");
    const [[, top1], [, bottom1]] = small.points;
    expect(bottom1).toBe(HEIGHT);
    expect(bottom1 - top1).toBeCloseTo(fluxLevel(0.1) * layout.fluxHeight, 4);
    expect(large.alpha).toBeCloseTo(0.3 + 0.7 * fluxLevel(0.4), 5);
    // 右端が最新：最後の列（フラックス 0）は描かず、その1つ手前が large
    const step = columnStep(1);
    expect(large.points[0][0]).toBeCloseTo(WIDTH - 2 * step, 8);
    expect(small.points[0][0]).toBeCloseTo(WIDTH - 3 * step, 8);
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
    const { canvas, push, draw } = setup();
    for (let i = 0; i < 200; i++) push(0, 0);
    draw();
    expect(canvas.texts.map((t) => t.text)).toEqual(["—"]);
    const [line] = lines(canvas);
    for (const [, py] of line.points) expect(py).toBeCloseTo(lineY(layout, 0), 6);
  });

  it("dispose すると数値は次の描画で読み直す。大きさが 0 なら何も描かない", () => {
    const { canvas, push, draw, renderer, client } = setup();
    for (let i = 0; i < 20; i++) push(1000, 0);
    draw();
    renderer.dispose();
    for (let i = 0; i < 20; i++) push(2000, 0);
    draw(0);
    expect(canvas.texts[0].text).toBe("2.0 kHz");

    renderer.resize({ width: 0, height: 0, devicePixelRatio: 1, quarterTurns: 0 });
    canvas.clear();
    renderer.draw(client.latest, client.histories, options, COLORS, DT, testDrawOutput(canvas.raw.ctx));
    expect(canvas.shapes).toHaveLength(0);
  });
});
