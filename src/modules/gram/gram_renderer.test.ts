import { describe, expect, it } from "vitest";
import { FrameClient, SPECTRUM_BANDS, SectionId } from "../../frame_client";
import { encodeTestFrame } from "../../frame_client/test_frames";
import type { SpeedOptions } from "../options";
import { bandCenterHz, tiltDb } from "../spec/spec_math";
import type { StreamColumn, StreamImage } from "../stream_image";
import { recordingCanvas } from "../test_canvas";
import { recordingShapeSink, testDrawOutput, type RecordedShape } from "../test_shapes";
import type { PaletteColors } from "../types";
import { gramModule } from "./index";
import { rowRanges } from "./gram_math";

// 列の中身（RGBA のバイト）を調べるので、色は 16 進で渡す
const COLORS: PaletteColors = {
  main: "#102030",
  sub: "#203040",
  accent: "#a0b0c0",
  bg: "#000000",
  grid: "#333333",
  line: "#444444",
  text: "#ffffff",
  textMuted: "#888888",
  danger: "#ff0000",
  fontNumeric: "NUMERIC",
  theme: "dark",
};
const MAIN_RGB = [0x10, 0x20, 0x30];
const ACCENT_RGB = [0xa0, 0xb0, 0xc0];
const WIDTH = 100;
const HEIGHT = 40;
const DT = 1 / 60;

const FULL = Array<number>(SPECTRUM_BANDS).fill(1);
const SILENT = Array<number>(SPECTRUM_BANDS).fill(0);
/** どの帯域でも表示の高さがちょうど 0.5 になる振幅（傾きの補正を打ち消す） */
const HALF = Array.from({ length: SPECTRUM_BANDS }, (_, b) => 10 ** ((-45 - tiltDb(bandCenterHz(b))) / 20));

type ImageShape = Extract<RecordedShape, { op: "image" }>;

function setup(options: Partial<SpeedOptions> = {}, dpr = 1) {
  const text = recordingCanvas();
  const recording = recordingShapeSink();
  const renderer = gramModule.createRenderer({ ctx: text.ctx });
  const geometry = (width = WIDTH, height = HEIGHT) => ({ width, height, devicePixelRatio: dpr, quarterTurns: 0 as const });
  renderer.resize(geometry());
  const client = new FrameClient();
  let seq = 0;
  const push = (bands: number[], times = 1) => {
    for (let i = 0; i < times; i++) client.receive(encodeTestFrame({ seq: seq++, sections: [[SectionId.Spectrum, bands]] }));
  };
  /** 1回描いて、描画の層に出した流れる画像（なければ undefined） */
  const draw = (colors: PaletteColors = COLORS, opts: Partial<SpeedOptions> = {}): ImageShape | undefined => {
    recording.clear();
    renderer.draw(client.latest, client.histories, { ...gramModule.defaultOptions, ...options, ...opts }, colors, DT, testDrawOutput(text.ctx, recording));
    return recording.shapes.find((s): s is ImageShape => s.op === "image");
  };
  return { text, recording, renderer, client, push, draw, geometry };
}

/** 描画の層の代わりに、まだ受け取っていない列を取り出す */
const take = (stream: StreamImage) => stream.takeUpdates();

/** 列の y ピクセル目の RGBA */
const pixel = (column: StreamColumn, y: number) => Array.from(column.data.subarray(y * 4, y * 4 + 4));

describe("gram モジュールの定義", () => {
  it("スペクトラムのセクションを読み、左へ流れる。形は選ばず、速さの設定を持つ。既定の速さは ×1.00", () => {
    expect(gramModule.kind).toBe("gram");
    expect(gramModule.labelKey).toBe("modules.spectrogram");
    expect(gramModule.sections).toEqual([SectionId.Spectrum]);
    expect(gramModule.baseDirection).toBe("left");
    expect(gramModule.flows).toBe(true);
    expect(gramModule.shape).toBe("free");
    expect(gramModule.defaultOptions).toEqual({ speed: 1 });
    expect(gramModule.defaultInstances).toEqual([{ enabled: true }]);
  });
});

describe("gram モジュールの描画", () => {
  it("最初は、見える列の数（幅 ÷ 2px）×高さの透明な画像を作り、枠いっぱいに出す。履歴がなければ列は足さない", () => {
    const { text, draw } = setup();
    const image = draw()!;
    expect(image.stream).toMatchObject({ width: WIDTH / 2, height: HEIGHT, written: 0 });
    expect(image.dest).toEqual({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
    expect(image.alpha).toBe(1);
    expect(take(image.stream)).toEqual({ reset: true, columns: [] });
    // 文字の層には何も描かない
    expect(text.shapes).toHaveLength(0);
    expect(text.images).toHaveLength(0);
  });

  it("新しい行が届くと、右端に列を1つ足す。フルスケールは全帯が強調色で濃さ 1、帯は上から下まで隙間なく並ぶ", () => {
    const { draw, push } = setup();
    const first = draw()!;
    take(first.stream);
    push(FULL);
    const image = draw()!;
    expect(image.stream).toBe(first.stream);
    expect(image.stream.written).toBe(1);
    // 読み始めは足した列の次：足した列が右端に来る
    expect(image.stream.start).toBe(1);
    const { reset, columns } = take(image.stream);
    expect(reset).toBe(false);
    expect(columns).toHaveLength(1);
    expect(columns[0].x).toBe(0);
    for (let y = 0; y < HEIGHT; y++) expect(pixel(columns[0], y)).toEqual([...ACCENT_RGB, 255]);
    expect(rowRanges(HEIGHT)[rowRanges(HEIGHT).length - 1]).toMatchObject({ y: HEIGHT - 2, height: 2 });
  });

  it("中くらいの強さは主色で、濃さが 1.4 倍の傾きで付く。小さい音は色が付かない（透明な列で古い絵を消す）", () => {
    const mid = setup();
    take(mid.draw()!.stream);
    mid.push(HALF);
    const [cell] = take(mid.draw()!.stream).columns;
    const alpha = Math.round((0.5 - 0.25) * 1.4 * 255);
    for (let y = 0; y < HEIGHT; y++) {
      const [r, g, b, a] = pixel(cell, y);
      expect([r, g, b]).toEqual(MAIN_RGB);
      expect(Math.abs(a - alpha)).toBeLessThanOrEqual(1);
    }

    const quiet = setup();
    take(quiet.draw()!.stream);
    quiet.push(SILENT);
    const { columns } = take(quiet.draw()!.stream);
    expect(columns).toHaveLength(1);
    expect(columns[0].data.every((v) => v === 0)).toBe(true);
  });

  it("新しい行が届かない回は、何も足さない。画面には毎回出す", () => {
    const { draw, push } = setup();
    draw();
    push(FULL);
    take(draw()!.stream);
    const image = draw()!;
    expect(image.stream.written).toBe(1);
    expect(take(image.stream).columns).toHaveLength(0);
  });

  it("複数の行が一度に届くと、その分だけ古い順に足す", () => {
    const { draw, push, client } = setup();
    take(draw()!.stream);
    push(FULL);
    push(HALF);
    push(FULL);
    const image = draw()!;
    const { columns } = take(image.stream);
    expect(columns.map((c) => c.x)).toEqual([0, 1, 2]);
    expect(client.histories.gram.length).toBe(3);
    // 2本目（真ん中）だけが主色
    expect(columns.map((c) => pixel(c, 0).slice(0, 3))).toEqual([ACCENT_RGB, MAIN_RGB, ACCENT_RGB]);
  });

  it("見える列より多く届いたときは、見える分だけ足す", () => {
    const { draw, push } = setup();
    take(draw()!.stream);
    push(FULL, 500);
    const image = draw()!;
    expect(image.stream.written).toBe(WIDTH / 2);
    expect(take(image.stream).columns).toHaveLength(WIDTH / 2);
  });

  it("流れる速さに比例して、1列の幅が変わる（×0.25 でも 1px 以上）。右端を枠の右端にそろえ、余りは左の枠の外へ出す", () => {
    for (const [speed, step] of [
      [2, 4],
      [3, 6],
      [0.25, 1],
    ] as const) {
      const { draw } = setup({ speed });
      const image = draw()!;
      const columns = Math.ceil(WIDTH / step);
      expect(image.stream.width).toBe(columns);
      expect(image.dest.width).toBe(columns * step);
      expect(image.dest.x + image.dest.width).toBe(WIDTH);
    }
  });

  it("流れる速さを変えると、画像を作り直し、履歴から過去の列を足し直す", () => {
    const { draw, push } = setup();
    const before = draw()!.stream;
    push(FULL, 10);
    draw();
    const image = draw(COLORS, { speed: 2 })!;
    expect(image.stream).not.toBe(before);
    expect(image.stream.width).toBe(WIDTH / 4);
    const { reset, columns } = take(image.stream);
    expect(reset).toBe(true);
    expect(columns).toHaveLength(10);
    // 読み始めは足した列の次：最新の列が右端
    expect(image.stream.start).toBe(10);
  });

  it("枠の大きさが変わると、画像を作り直し、新しい大きさで過去の列を足し直す。多すぎる分は見える列だけ", () => {
    const { renderer, draw, push, geometry } = setup();
    draw();
    push(FULL, 300);
    draw();
    renderer.resize(geometry(60, 20));
    const image = draw()!;
    expect(image.stream).toMatchObject({ width: 30, height: 20 });
    expect(image.dest).toEqual({ x: 0, y: 0, width: 60, height: 20 });
    expect(take(image.stream).columns).toHaveLength(30);
  });

  it("配色が変わる（テーマ・パレット）と、新しい色で描き直す", () => {
    const { draw, push } = setup();
    draw();
    push(FULL, 3);
    const before = draw()!.stream;
    const image = draw({ ...COLORS, accent: "#010203" })!;
    expect(image.stream).not.toBe(before);
    const { columns } = take(image.stream);
    expect(columns).toHaveLength(3);
    expect(pixel(columns[0], 0)).toEqual([1, 2, 3, 255]);
  });

  it("高解像度（DPR 2）：列の高さ・帯はデバイスピクセルで、1列は 4 デバイスピクセル。画面へは CSS ピクセルの大きさで出す", () => {
    const { draw, push } = setup({}, 2);
    const first = draw()!;
    expect(first.stream).toMatchObject({ width: (WIDTH * 2) / 4, height: HEIGHT * 2 });
    expect(first.dest).toEqual({ x: 0, y: 0, width: WIDTH, height: HEIGHT });
    take(first.stream);
    push(HALF);
    const [cell] = take(draw()!.stream).columns;
    expect(cell.data.length).toBe(HEIGHT * 2 * 4);
    // 帯は 4 デバイスピクセルずつ
    expect(rowRanges(HEIGHT * 2, 4)[0]).toMatchObject({ y: 0, height: 4 });
    expect(pixel(cell, 0)).toEqual(pixel(cell, 3));
  });

  it("スペクトラムのない・長さの合わないフレームは行にならず、何も流れない", () => {
    const { draw, client } = setup();
    take(draw()!.stream);
    client.receive(encodeTestFrame({ sections: [[SectionId.Spectrum, Array(SPECTRUM_BANDS - 1).fill(1)]] }));
    expect(take(draw()!.stream).columns).toHaveLength(0);
  });

  it("大きさが0のあいだは何も描かない。dispose の後は、画像を作り直して描ける", () => {
    const text = recordingCanvas();
    const recording = recordingShapeSink();
    const renderer = gramModule.createRenderer({ ctx: text.ctx });
    const client = new FrameClient();
    renderer.draw(null, client.histories, { speed: 1 }, COLORS, DT, testDrawOutput(text.ctx, recording));
    expect(recording.shapes).toHaveLength(0);

    renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
    renderer.draw(null, client.histories, { speed: 1 }, COLORS, DT, testDrawOutput(text.ctx, recording));
    renderer.dispose();
    renderer.draw(null, client.histories, { speed: 1 }, COLORS, DT, testDrawOutput(text.ctx, recording));
    const images = recording.shapes.filter((s): s is ImageShape => s.op === "image");
    expect(images).toHaveLength(2);
    expect(images[1].stream).not.toBe(images[0].stream);
  });
});
