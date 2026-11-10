// 描画の層（imple 4.6）：メーター全体を覆う1枚の共有の WebGL2 キャンバスに、各モジュールが自分の枠の範囲だけに図形を描く。
// 描画ループ（RenderLoop）の段として動く：
// - begin：まとめを空にし、今の枠の範囲（配置の状態から求めたもの）を受け取る
// - モジュールの描画：ModuleFrame が sink(枠, 大きさと向き) で受け口を得て、モジュールが図形を出す（その場で三角形に展開して積む）
// - end：全体を透明にし、枠ごとに、範囲を切り抜きとビューポートにして地の色で塗り、そのモジュールの図形を描く
//   （発光の値を持つ図形は、先に発光を敷いてから描く。gl_glow）
// コンテキストの喪失：webglcontextlost で preventDefault して描くのを止め（状態は lost）、webglcontextrestored で
// シェーダー・バッファ・テクスチャを作り直して再開する。流れる画像の中身は消えたところから描き直す。
// WebGL2 を作れないときは unavailable にし、描かない（Canvas 2D の描き方へは戻さない）。

import type { FrameDrawInput, Geometry, ShapeSink } from "../../modules/types";
import type { RenderLayer } from "../render_loop";
import { canvasColorFallback, createColorResolver, type Rgba } from "./color";
import type { DeviceRect } from "./frame_rects";
import { GlRenderer } from "./gl_renderer";
import { DISCARD_SINK, ShapeBatch, type BatchCommand } from "./shape_batch";
import { frameClipMatrix } from "./transform";

/** pending：まだ始めていない／ready：描ける／lost：コンテキストを失っている／unavailable：WebGL2 を作れない */
export type ShapeLayerStatus = "pending" | "ready" | "lost" | "unavailable";

export interface ShapeLayerOptions {
  canvas: HTMLCanvasElement;
  /** 今の枠の範囲（枠のインスタンスID → 共有キャンバスのデバイスピクセル）。毎回の描画の初めに呼ぶ */
  frames: () => ReadonlyMap<string, DeviceRect>;
  onStatus?: (status: ShapeLayerStatus) => void;
}

/** 共有キャンバスの作り方。地の外は透明にし（格子の線が見える）、ふちはマルチサンプルでならす */
const CONTEXT_ATTRIBUTES: WebGLContextAttributes = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: true,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
};

interface FrameRecord {
  turns: Geometry["quarterTurns"];
  width: number;
  height: number;
  commands: BatchCommand[];
}

export class ShapeLayer implements RenderLayer {
  private currentStatus: ShapeLayerStatus = "pending";
  private gl: WebGL2RenderingContext | null = null;
  private renderer: GlRenderer | null = null;
  private readonly resolveColor = createColorResolver(canvasColorFallback());
  private readonly batch = new ShapeBatch(this.resolveColor);
  private frames: ReadonlyMap<string, DeviceRect> = new Map();
  private readonly recorded = new Map<string, FrameRecord>();
  private observer: ResizeObserver | null = null;
  /** キャンバスの表示の大きさ（デバイスピクセル）。測るまでは 0 */
  private pixelWidth = 0;
  private pixelHeight = 0;

  constructor(private readonly options: ShapeLayerOptions) {}

  get status(): ShapeLayerStatus {
    return this.currentStatus;
  }

  /** コンテキストを作って始める */
  start(): void {
    const { canvas } = this.options;
    canvas.addEventListener("webglcontextlost", this.onLost);
    canvas.addEventListener("webglcontextrestored", this.onRestored);
    this.observeSize();
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext("webgl2", CONTEXT_ATTRIBUTES);
    } catch (error) {
      console.error(error);
    }
    if (!gl) {
      this.setStatus("unavailable");
      return;
    }
    this.gl = gl;
    this.setStatus(this.createRenderer() ? "ready" : "unavailable");
  }

  dispose(): void {
    const { canvas } = this.options;
    canvas.removeEventListener("webglcontextlost", this.onLost);
    canvas.removeEventListener("webglcontextrestored", this.onRestored);
    this.observer?.disconnect();
    this.renderer?.dispose();
    this.renderer = null;
    this.gl = null;
  }

  begin(): void {
    this.batch.reset();
    this.recorded.clear();
    this.frames = this.currentStatus === "ready" ? this.options.frames() : new Map();
  }

  /**
   * 枠1つ分の受け口。geometry は枠の描画の座標系（既定の向きでの大きさ・向き・DPR）。
   * 描けないとき（使えない・枠が置かれていない）は、何もしない受け口を返す
   */
  sink(id: string, geometry: Geometry): ShapeSink {
    if (this.currentStatus !== "ready" || !this.frames.has(id)) return DISCARD_SINK;
    const record: FrameRecord = { turns: geometry.quarterTurns, width: geometry.width, height: geometry.height, commands: [] };
    this.recorded.set(id, record);
    return this.batch.sink(geometry.devicePixelRatio, record.commands);
  }

  end(input: FrameDrawInput): void {
    const renderer = this.renderer;
    const gl = this.gl;
    if (this.currentStatus !== "ready" || !renderer || !gl || gl.isContextLost()) return;
    if (!this.fitCanvas()) return;
    renderer.begin(this.pixelWidth, this.pixelHeight, this.batch);
    const bg: Rgba = this.resolveColor(input.colors.bg);
    for (const [id, rect] of this.frames) {
      if (rect.width <= 0 || rect.height <= 0) continue;
      renderer.frame(rect, bg);
      const record = this.recorded.get(id);
      if (!record || record.commands.length === 0) continue;
      const matrix = frameClipMatrix(record.turns, record.width, record.height);
      for (const command of record.commands) {
        if (command.kind === "shapes") renderer.shapes(matrix, command.first, command.count, command.glow);
        else renderer.streamImage(matrix, command.stream, command.dest, command.alpha);
      }
    }
    renderer.end();
  }

  private setStatus(status: ShapeLayerStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.options.onStatus?.(status);
  }

  private createRenderer(): boolean {
    if (!this.gl) return false;
    const renderer = new GlRenderer(this.gl);
    if (!renderer.init()) {
      renderer.dispose();
      return false;
    }
    this.renderer = renderer;
    return true;
  }

  /** キャンバスの画素数を、表示の大きさ（デバイスピクセル）に合わせる。大きさが分からなければ false */
  private fitCanvas(): boolean {
    const { canvas } = this.options;
    if (this.pixelWidth <= 0 || this.pixelHeight <= 0) {
      // まだ測れていない：今の大きさから求める
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.pixelWidth = Math.round(rect.width * dpr);
      this.pixelHeight = Math.round(rect.height * dpr);
      if (this.pixelWidth <= 0 || this.pixelHeight <= 0) return false;
    }
    if (canvas.width !== this.pixelWidth) canvas.width = this.pixelWidth;
    if (canvas.height !== this.pixelHeight) canvas.height = this.pixelHeight;
    return true;
  }

  private observeSize(): void {
    const { canvas } = this.options;
    this.observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      const device = entry.devicePixelContentBoxSize?.[0];
      if (device) {
        this.pixelWidth = device.inlineSize;
        this.pixelHeight = device.blockSize;
      } else {
        const dpr = window.devicePixelRatio || 1;
        this.pixelWidth = Math.round(entry.contentRect.width * dpr);
        this.pixelHeight = Math.round(entry.contentRect.height * dpr);
      }
    });
    try {
      this.observer.observe(canvas, { box: "device-pixel-content-box" });
    } catch {
      this.observer.observe(canvas);
    }
  }

  private readonly onLost = (event: Event): void => {
    // 復元を受けるために、既定の扱い（失ったまま）を止める
    event.preventDefault();
    this.renderer?.markStreamsLost();
    this.renderer = null;
    this.setStatus("lost");
  };

  private readonly onRestored = (): void => {
    this.setStatus(this.createRenderer() ? "ready" : "unavailable");
  };
}
