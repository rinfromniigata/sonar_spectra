import { describe, expect, it } from "vitest";
import { FrameClient, SPECTRUM_BANDS, SectionId } from "../../frame_client";
import { encodeTestFrame } from "../../frame_client/test_frames";
import type { SpeedOptions } from "../options";
import { bandCenterHz, tiltDb } from "../spec/spec_math";
import { recordingCanvas, type DrawnShape, type RecordingCanvas } from "../test_canvas";
import type { OffscreenBuffer, PaletteColors } from "../types";

/** 画面に出さない画像の代わり（大きさだけ持つ偽のキャンバス）。drawImage に渡せる型として扱う */
function fakeBuffer(width: number, height: number, ctx: CanvasRenderingContext2D): OffscreenBuffer {
  return { canvas: { width, height } as unknown as OffscreenBuffer["canvas"], ctx };
}
import { gramModule } from "./index";
import { rowRanges } from "./gram_math";

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
const WIDTH = 100;
const HEIGHT = 40;
const DT = 1 / 60;

const FULL = Array<number>(SPECTRUM_BANDS).fill(1);
const SILENT = Array<number>(SPECTRUM_BANDS).fill(0);
/** どの帯域でも表示の高さがちょうど 0.5 になる振幅（傾きの補正を打ち消す） */
const HALF = Array.from({ length: SPECTRUM_BANDS }, (_, b) => 10 ** ((-45 - tiltDb(bandCenterHz(b))) / 20));

interface Buffer {
  width: number;
  height: number;
  rc: RecordingCanvas;
}

function setup(options: Partial<SpeedOptions> = {}, dpr = 1) {
  const main = recordingCanvas();
  const buffers: Buffer[] = [];
  const renderer = gramModule.createRenderer({
    ctx: main.ctx,
    createBuffer: (width, height) => {
      const rc = recordingCanvas();
      buffers.push({ width, height, rc });
      return fakeBuffer(width, height, rc.ctx);
    },
  });
  const geometry = (width = WIDTH, height = HEIGHT) => ({ width, height, devicePixelRatio: dpr, quarterTurns: 0 as const });
  renderer.resize(geometry());
  const client = new FrameClient();
  let seq = 0;
  const push = (bands: number[], times = 1) => {
    for (let i = 0; i < times; i++) client.receive(encodeTestFrame({ seq: seq++, sections: [[SectionId.Spectrum, bands]] }));
  };
  const draw = (colors: PaletteColors = COLORS, opts: Partial<SpeedOptions> = {}) => {
    main.clear();
    renderer.draw(client.latest, client.histories, { ...gramModule.defaultOptions, ...options, ...opts }, colors, DT);
  };
  const last = () => buffers[buffers.length - 1];
  return { main, buffers, last, renderer, client, push, draw, geometry };
}

const rects = (shapes: DrawnShape[], style?: string) => shapes.filter((s) => s.op === "fillRect" && (style === undefined || s.style === style));
const left = (s: DrawnShape) => s.points[0][0];
const width = (s: DrawnShape) => s.points[1][0] - s.points[0][0];

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
  it("最初は、地の色で塗ったバッファを作り、画面に写す。履歴がなければ色は付かない", () => {
    const { main, buffers, last, draw } = setup();
    draw();
    expect(buffers).toHaveLength(1);
    expect(last()).toMatchObject({ width: WIDTH, height: HEIGHT });
    const fills = rects(last().rc.shapes);
    expect(fills).toHaveLength(1);
    expect(fills[0].style).toBe("BG");
    expect(fills[0].points).toEqual([
      [0, 0],
      [WIDTH, HEIGHT],
    ]);
    expect(main.images).toHaveLength(1);
    expect(main.images[0].image).toEqual({ width: WIDTH, height: HEIGHT });
    expect(main.images[0].args).toEqual([0, 0, WIDTH, HEIGHT]);
  });

  it("新しい行が届くと、バッファを左へ 1 列（2px）ずらして、右端に列を足す。フルスケールは全帯が強調色で濃さ 1", () => {
    const { last, draw, push } = setup();
    draw();
    push(FULL);
    draw();
    const { rc } = last();
    expect(rc.images.map((i) => i.args)).toEqual([[-2, 0]]);
    const column = rects(rc.shapes).slice(1); // 最初の1つは、作ったときの全面の塗り
    expect(column[0].style).toBe("BG");
    expect(left(column[0])).toBe(WIDTH - 2);
    expect(width(column[0])).toBe(2);
    expect(column[0].points[1][1]).toBe(HEIGHT);

    const hot = rects(column as DrawnShape[], "ACCENT");
    expect(hot).toHaveLength(rowRanges(HEIGHT).length);
    for (const r of hot) {
      expect(left(r)).toBe(WIDTH - 2);
      expect(width(r)).toBe(2);
      expect(r.alpha).toBe(1);
    }
    // 帯は上から下まで隙間なく並ぶ
    expect(hot[0].points[0][1]).toBe(0);
    expect(hot[hot.length - 1].points[1][1]).toBe(HEIGHT);
  });

  it("中くらいの強さは主色で、濃さが 1.4 倍の傾きで付く。小さい音は色が付かない", () => {
    const mid = setup();
    mid.draw();
    mid.push(HALF);
    mid.draw();
    const cells = rects(mid.last().rc.shapes, "MAIN");
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) expect(c.alpha).toBeCloseTo((0.5 - 0.25) * 1.4, 4);
    expect(rects(mid.last().rc.shapes, "ACCENT")).toHaveLength(0);

    const quiet = setup();
    quiet.draw();
    quiet.push(SILENT);
    quiet.draw();
    expect(rects(quiet.last().rc.shapes, "MAIN")).toHaveLength(0);
    expect(rects(quiet.last().rc.shapes, "ACCENT")).toHaveLength(0);
    // 列は地の色で塗られる（古い絵を消す）
    expect(rects(quiet.last().rc.shapes, "BG")).toHaveLength(2);
  });

  it("新しい行が届かない回は、ずらさず、何も足さない。画面には毎回写す", () => {
    const { main, last, draw, push } = setup();
    draw();
    push(FULL);
    draw();
    const before = last().rc.shapes.length;
    draw();
    expect(last().rc.images).toHaveLength(1);
    expect(last().rc.shapes).toHaveLength(before);
    expect(main.images).toHaveLength(1);
  });

  it("複数の行が一度に届くと、その分だけまとめてずらし、古い順に左から並べる", () => {
    const { last, draw, push, client } = setup();
    draw();
    push(FULL);
    push(HALF);
    push(FULL);
    draw();
    expect(last().rc.images.map((i) => i.args)).toEqual([[-6, 0]]);
    const columns = rects(last().rc.shapes, "BG").slice(1);
    expect(columns.map(left)).toEqual([WIDTH - 6, WIDTH - 4, WIDTH - 2]);
    expect(client.histories.gram.length).toBe(3);
    // 2本目（真ん中）だけが主色
    const main = rects(last().rc.shapes, "MAIN");
    expect(main.length).toBeGreaterThan(0);
    for (const c of main) expect(left(c)).toBe(WIDTH - 4);
  });

  it("見える列より多く届いたときは、見える分だけ描き、全体をずらす", () => {
    const { last, draw, push } = setup();
    draw();
    push(FULL, 500);
    draw();
    expect(last().rc.images.map((i) => i.args)).toEqual([[-WIDTH, 0]]);
    const columns = rects(last().rc.shapes, "BG").slice(1);
    expect(columns).toHaveLength(WIDTH / 2);
    expect(left(columns[0])).toBe(0);
  });

  it("流れる速さに比例して、1行の幅（ずらす量）が変わる。×0.25 でも 1px 以上", () => {
    for (const [speed, step] of [
      [2, 4],
      [3, 6],
      [0.25, 1],
    ] as const) {
      const { last, draw, push } = setup({ speed });
      draw();
      push(FULL);
      draw();
      expect(last().rc.images.map((i) => i.args)).toEqual([[-step, 0]]);
      expect(width(rects(last().rc.shapes, "ACCENT")[0])).toBe(step);
    }
  });

  it("流れる速さを変えると、バッファを作り直し、履歴から過去の列を新しい幅で描き直す", () => {
    const { buffers, last, draw, push } = setup();
    draw();
    push(FULL, 10);
    draw();
    expect(buffers).toHaveLength(1);
    draw(COLORS, { speed: 2 });
    expect(buffers).toHaveLength(2);
    const columns = rects(last().rc.shapes, "BG").slice(1);
    expect(columns).toHaveLength(10);
    expect(width(columns[0])).toBe(4);
    expect(left(columns[columns.length - 1])).toBe(WIDTH - 4);
    expect(left(columns[0])).toBe(WIDTH - 40);
  });

  it("枠の大きさが変わると、バッファを作り直し、新しい大きさで過去の列を描き直す。多すぎる分は見える列だけ", () => {
    const { buffers, last, renderer, draw, push, geometry } = setup();
    draw();
    push(FULL, 300);
    draw();
    renderer.resize(geometry(60, 20));
    draw();
    expect(buffers).toHaveLength(2);
    expect(last()).toMatchObject({ width: 60, height: 20 });
    const columns = rects(last().rc.shapes, "BG").slice(1);
    expect(columns).toHaveLength(30);
    expect(left(columns[columns.length - 1])).toBe(58);
  });

  it("配色が変わる（テーマ・パレット）と、新しい色で描き直す", () => {
    const { buffers, last, draw, push } = setup();
    draw();
    push(FULL, 3);
    draw();
    draw({ ...COLORS, bg: "BG2", accent: "ACCENT2" });
    expect(buffers).toHaveLength(2);
    expect(rects(last().rc.shapes, "BG2").length).toBeGreaterThan(0);
    expect(rects(last().rc.shapes, "ACCENT2").length).toBeGreaterThan(0);
    expect(rects(last().rc.shapes, "ACCENT")).toHaveLength(0);
  });

  it("高解像度（DPR 2）：バッファはデバイスピクセルで作り、列の幅・帯の高さもその倍。画面へは CSS ピクセルの大きさで写す", () => {
    const { main, last, draw, push } = setup({}, 2);
    draw();
    expect(last()).toMatchObject({ width: WIDTH * 2, height: HEIGHT * 2 });
    push(FULL);
    draw();
    expect(last().rc.images.map((i) => i.args)).toEqual([[-4, 0]]);
    const cells = rects(last().rc.shapes, "ACCENT");
    expect(width(cells[0])).toBe(4);
    expect(cells[0].points[1][1] - cells[0].points[0][1]).toBe(4);
    expect(main.images[0].args).toEqual([0, 0, WIDTH, HEIGHT]);
  });

  it("スペクトラムのない・長さの合わないフレームは行にならず、何も流れない", () => {
    const { last, draw, client } = setup();
    draw();
    client.receive(encodeTestFrame({ sections: [[SectionId.Spectrum, Array(SPECTRUM_BANDS - 1).fill(1)]] }));
    draw();
    expect(last().rc.images).toHaveLength(0);
  });

  it("大きさが0のあいだは何も描かない。dispose の後は、バッファを作り直して描ける", () => {
    const main = recordingCanvas();
    let created = 0;
    const renderer = gramModule.createRenderer({
      ctx: main.ctx,
      createBuffer: (w, h) => {
        created++;
        return fakeBuffer(w, h, recordingCanvas().ctx);
      },
    });
    const client = new FrameClient();
    renderer.draw(null, client.histories, { speed: 1 }, COLORS, DT);
    expect(created).toBe(0);
    expect(main.images).toHaveLength(0);

    renderer.resize({ width: WIDTH, height: HEIGHT, devicePixelRatio: 1, quarterTurns: 0 });
    renderer.draw(null, client.histories, { speed: 1 }, COLORS, DT);
    renderer.dispose();
    renderer.draw(null, client.histories, { speed: 1 }, COLORS, DT);
    expect(created).toBe(2);
    expect(main.images).toHaveLength(2);
  });
});
