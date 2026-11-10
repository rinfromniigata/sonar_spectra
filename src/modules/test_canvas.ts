// 単体テスト用：描いたものを記録する Canvas の代わり。パスの塗り・線と四角を、そのときの色・不透明度・点線とともに残す。

import type { OffscreenBuffer } from "./types";

export interface DrawnShape {
  op: "fill" | "stroke" | "fillRect";
  style: string;
  alpha: number;
  dashed: boolean;
  lineWidth: number;
  /** パスの点（fillRect では左上と右下） */
  points: [number, number][];
}

export interface RecordingCanvas {
  ctx: CanvasRenderingContext2D;
  shapes: DrawnShape[];
  texts: { text: string; x: number; y: number; style: string; font: string; maxWidth?: number }[];
  /** drawImage の呼び出し（画像と、続く引数と、そのときの filter） */
  images: { image: unknown; args: number[]; filter: string }[];
  /** setTransform の呼び出し（引数の6つの数） */
  transforms: number[][];
  /** arc の呼び出し（パスの点には中心しか残らないので、半径と角度はここに残す） */
  arcs: { x: number; y: number; radius: number; start: number; end: number; counterClockwise: boolean }[];
  clear(): void;
}

export function recordingCanvas(): RecordingCanvas {
  const shapes: DrawnShape[] = [];
  const texts: { text: string; x: number; y: number; style: string; font: string; maxWidth?: number }[] = [];
  const images: RecordingCanvas["images"] = [];
  const transforms: number[][] = [];
  const arcs: RecordingCanvas["arcs"] = [];
  const state: Record<string, unknown> = {
    fillStyle: "",
    strokeStyle: "",
    font: "",
    globalAlpha: 1,
    shadowBlur: 0,
    shadowColor: "",
    lineWidth: 1,
  };
  let dash: number[] = [];
  let path: [number, number][] = [];
  const styleOf = (value: unknown) => (typeof value === "string" ? value : "gradient");
  const record = (op: DrawnShape["op"], style: unknown, points: [number, number][]) =>
    shapes.push({ op, style: styleOf(style), alpha: state.globalAlpha as number, dashed: dash.length > 0, lineWidth: state.lineWidth as number, points });

  const methods: Record<string, (...args: never[]) => unknown> = {
    beginPath: () => {
      path = [];
    },
    moveTo: (x: number, y: number) => path.push([x, y]),
    lineTo: (x: number, y: number) => path.push([x, y]),
    closePath: () => {},
    fill: () => record("fill", state.fillStyle, path),
    stroke: () => record("stroke", state.strokeStyle, path),
    fillRect: (x: number, y: number, w: number, h: number) =>
      record("fillRect", state.fillStyle, [
        [x, y],
        [x + w, y + h],
      ]),
    fillText: (text: string, x: number, y: number, maxWidth?: number) =>
      texts.push({ text, x, y, style: styleOf(state.fillStyle), font: String(state.font), ...(maxWidth === undefined ? {} : { maxWidth }) }),
    drawImage: (image: unknown, ...args: number[]) => images.push({ image, args, filter: String(state.filter ?? "none") }),
    setTransform: (...args: number[]) => transforms.push(args),
    setLineDash: (segments: number[]) => {
      dash = [...segments];
    },
    arc: (x: number, y: number, radius: number, start: number, end: number, counterClockwise = false) => {
      path.push([x, y]);
      arcs.push({ x, y, radius, start, end, counterClockwise });
    },
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    clearRect: () => {},
    save: () => {},
    restore: () => {},
  };

  const ctx = new Proxy(state, {
    get: (target, prop: string) => methods[prop] ?? target[prop],
    set: (target, prop: string, value) => {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;

  return {
    ctx,
    shapes,
    texts,
    images,
    transforms,
    arcs,
    clear: () => {
      shapes.length = 0;
      texts.length = 0;
      images.length = 0;
      transforms.length = 0;
      arcs.length = 0;
    },
  };
}

/** 画面に出さない画像（OffscreenBuffer）の代わり。作られた画像ごとに、描いたものを記録する */
export function recordingBuffers(): {
  createBuffer: (width: number, height: number) => OffscreenBuffer;
  created: { width: number; height: number; rc: RecordingCanvas }[];
} {
  const created: { width: number; height: number; rc: RecordingCanvas }[] = [];
  return {
    created,
    createBuffer: (width, height) => {
      const rc = recordingCanvas();
      created.push({ width, height, rc });
      return { canvas: { width, height } as unknown as OffscreenBuffer["canvas"], ctx: rc.ctx };
    },
  };
}

const samePoint = (a: [number, number], b: [number, number]) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
const sameLook = (a: DrawnShape, b: DrawnShape) =>
  a.op === b.op && a.style === b.style && a.alpha === b.alpha && a.lineWidth === b.lineWidth && a.dashed === b.dashed;

/**
 * 短い区間に分けて描いた線（strokePolyline）と、縦の帯に分けて描いた塗り（fillBetween）を、続いているものどうしで
 * 1つにまとめる（テストで、元の1本の線・1つの塗りとして調べるため）。
 * - 線：同じ見た目で、次の線の始まりが前の線の終わりと同じ点なら、つなぐ
 * - 塗り：帯は「上の線（左→右）＋下の線（右→左）」の順の点。次の帯の始まりが前の帯の右上の点なら、上の線どうし・
 *   下の線どうしをつないで、1つの塗り（上の線＋下の線を逆向き）にする
 */
export function joinRuns(shapes: DrawnShape[]): DrawnShape[] {
  const out: DrawnShape[] = [];
  /** まとめている塗りの、上の線と下の線（左→右） */
  let band: { top: [number, number][]; bottom: [number, number][] } | null = null;
  for (const shape of shapes) {
    const prev = out[out.length - 1];
    if (prev && sameLook(prev, shape) && shape.points.length > 0) {
      if (shape.op === "stroke" && samePoint(prev.points[prev.points.length - 1], shape.points[0])) {
        prev.points = [...prev.points, ...shape.points.slice(1)];
        continue;
      }
      if (shape.op === "fill" && band && shape.points.length % 2 === 0 && samePoint(band.top[band.top.length - 1], shape.points[0])) {
        const half = shape.points.length / 2;
        band.top.push(...shape.points.slice(1, half));
        band.bottom.push(...shape.points.slice(half).reverse().slice(1));
        prev.points = [...band.top, ...[...band.bottom].reverse()];
        continue;
      }
    }
    const copy: DrawnShape = { ...shape, points: [...shape.points] };
    out.push(copy);
    if (shape.op === "fill" && shape.points.length % 2 === 0) {
      const half = shape.points.length / 2;
      band = { top: shape.points.slice(0, half), bottom: shape.points.slice(half).reverse() };
    } else {
      band = null;
    }
  }
  return out;
}

/** recordingCanvas の記録を、分けて描いた線と塗りをまとめた形（joinRuns）で見せる。元の記録は raw に残す */
export function joinedView(raw: RecordingCanvas): Omit<RecordingCanvas, "ctx" | "shapes"> & { readonly shapes: DrawnShape[]; raw: RecordingCanvas } {
  return {
    get shapes() {
      return joinRuns(raw.shapes);
    },
    texts: raw.texts,
    images: raw.images,
    transforms: raw.transforms,
    arcs: raw.arcs,
    clear: () => raw.clear(),
    raw,
  };
}
