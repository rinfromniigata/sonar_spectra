// 単体テスト用：描いたものを記録する Canvas の代わり。パスの塗り・線と四角を、そのときの色・不透明度・点線とともに残す。

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
  texts: { text: string; x: number; y: number; style: string; font: string }[];
  /** drawImage の呼び出し（画像と、続く引数） */
  images: { image: unknown; args: number[] }[];
  /** arc の呼び出し（パスの点には中心しか残らないので、半径と角度はここに残す） */
  arcs: { x: number; y: number; radius: number; start: number; end: number; counterClockwise: boolean }[];
  clear(): void;
}

export function recordingCanvas(): RecordingCanvas {
  const shapes: DrawnShape[] = [];
  const texts: { text: string; x: number; y: number; style: string; font: string }[] = [];
  const images: { image: unknown; args: number[] }[] = [];
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
    fillText: (text: string, x: number, y: number) =>
      texts.push({ text, x, y, style: styleOf(state.fillStyle), font: String(state.font) }),
    drawImage: (image: unknown, ...args: number[]) => images.push({ image, args }),
    setTransform: () => {},
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
    arcs,
    clear: () => {
      shapes.length = 0;
      texts.length = 0;
      images.length = 0;
      arcs.length = 0;
    },
  };
}
