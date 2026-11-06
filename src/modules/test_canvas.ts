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
  texts: { text: string; x: number; y: number }[];
  clear(): void;
}

export function recordingCanvas(): RecordingCanvas {
  const shapes: DrawnShape[] = [];
  const texts: { text: string; x: number; y: number }[] = [];
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
    fillText: (text: string, x: number, y: number) => texts.push({ text, x, y }),
    setLineDash: (segments: number[]) => {
      dash = [...segments];
    },
    arc: (x: number, y: number) => path.push([x, y]),
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
    clear: () => {
      shapes.length = 0;
      texts.length = 0;
    },
  };
}
