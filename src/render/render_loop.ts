// 描画ループ：requestAnimationFrame を1本だけ回し、表示中のモジュールを順に描く（画面のリフレッシュに合わせる）。
// 受信とは切り離し、毎回その時点の最新のフレームと共有の履歴を渡す（描画が重くても受信・取得は止まらない）。
// フレームレートの上限（アプリ全体の設定）を超える回は描かずに飛ばす（判定は frame_pacer。上限は毎回読むので、変えるとすぐ効く）。
// 経過時間（dt）は、描いた回どうしの差（飛ばした回は含めない）。
// 層（描画の層。render/gl）は、描くものを描く前（begin）と後（end）に呼ぶ。描くものが図形を層に積み、層が end でまとめて描く。

import type { AnalysisFrame, Histories } from "../frame_client";
import { DEFAULT_FRAME_LIMIT } from "../config/types";
import type { FrameDrawInput } from "../modules/types";
import type { CanvasColors } from "../theme/canvas_colors";
import { INITIAL_PACER_STATE, stepPacer, type PacerState } from "./frame_pacer";

/** 描くもの（ModuleFrame） */
export interface Drawable {
  draw(input: FrameDrawInput): void;
}

/** 描くものの前後に呼ぶ層（共有の WebGL2 キャンバス） */
export interface RenderLayer {
  /** 描くものを描く前 */
  begin(input: FrameDrawInput): void;
  /** 描くものを描いた後 */
  end(input: FrameDrawInput): void;
}

/** 最新のフレームと履歴の持ち主（FrameClient） */
export interface FrameSource {
  readonly latest: AnalysisFrame | null;
  readonly histories: Histories;
}

/** 次の描画の予約（ブラウザでは requestAnimationFrame。テストで差し替える） */
export interface Scheduler {
  request(callback: (time: number) => void): number;
  cancel(handle: number): void;
}

export const animationFrameScheduler: Scheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** 1回の経過時間の上限（秒）。止まっていた後に、流れるモジュールが大きく飛ばないように */
export const MAX_FRAME_DT = 0.1;

export class RenderLoop {
  private readonly drawables = new Set<Drawable>();
  private readonly layers = new Set<RenderLayer>();
  /** 一度でも失敗したもの（同じ失敗を毎フレーム記録しない） */
  private readonly failed = new WeakSet<object>();
  private started = false;
  private paused = false;
  private handle: number | null = null;
  /** 前に描いた回の時刻 */
  private lastTime: number | null = null;
  private pacer: PacerState = INITIAL_PACER_STATE;
  /** 前の回の上限（変わったら間引きの数え直しをする） */
  private lastLimit: number | null = null;

  constructor(
    private readonly source: FrameSource,
    private readonly colors: () => CanvasColors,
    private readonly scheduler: Scheduler = animationFrameScheduler,
    /** フレームレートの上限（fps）。毎回の受け取りで読む */
    private readonly frameLimit: () => number = () => DEFAULT_FRAME_LIMIT,
  ) {}

  /** 描くものを加える。返す関数で外す */
  register(drawable: Drawable): () => void {
    this.drawables.add(drawable);
    return () => {
      this.drawables.delete(drawable);
    };
  }

  /** 層を加える。返す関数で外す */
  addLayer(layer: RenderLayer): () => void {
    this.layers.add(layer);
    return () => {
      this.layers.delete(layer);
    };
  }

  /** 回っているか（始めていて、一時停止していない） */
  get running(): boolean {
    return this.started && !this.paused;
  }

  start(): void {
    this.started = true;
    this.resume();
  }

  stop(): void {
    this.started = false;
    this.cancel();
  }

  /** 一時停止する・再開する（ウィンドウの最小化） */
  setPaused(paused: boolean): void {
    this.paused = paused;
    if (paused) {
      this.cancel();
    } else {
      this.resume();
    }
  }

  private resume(): void {
    if (!this.running || this.handle !== null) return;
    // 再開した最初の回は経過時間を0にし、必ず描く（止まっていた時間を流さない）
    this.lastTime = null;
    this.pacer = INITIAL_PACER_STATE;
    this.handle = this.scheduler.request(this.tick);
  }

  private cancel(): void {
    if (this.handle !== null) {
      this.scheduler.cancel(this.handle);
      this.handle = null;
    }
  }

  private readonly tick = (time: number): void => {
    this.handle = null;
    if (!this.running) return;

    // 上限が変わったら数え直し、変えた直後の回から効かせる
    const limit = this.frameLimit();
    if (limit !== this.lastLimit) {
      this.lastLimit = limit;
      this.pacer = { ...this.pacer, due: null };
    }
    const step = stepPacer(this.pacer, time, limit);
    this.pacer = step.state;
    if (!step.draw) {
      this.handle = this.scheduler.request(this.tick);
      return;
    }

    const dt = this.lastTime === null ? 0 : Math.min(Math.max(0, (time - this.lastTime) / 1000), MAX_FRAME_DT);
    this.lastTime = time;

    const input: FrameDrawInput = {
      frame: this.source.latest,
      histories: this.source.histories,
      colors: this.colors(),
      dt,
    };
    for (const layer of this.layers) this.guard(layer, () => layer.begin(input));
    // 1つのモジュールの失敗で、ほかのモジュールの描画を止めない
    for (const drawable of this.drawables) this.guard(drawable, () => drawable.draw(input));
    for (const layer of this.layers) this.guard(layer, () => layer.end(input));
    this.handle = this.scheduler.request(this.tick);
  };

  /** 失敗しても先へ進む。同じものの失敗は1度だけ記録する */
  private guard(owner: object, run: () => void): void {
    try {
      run();
    } catch (error) {
      if (!this.failed.has(owner)) {
        this.failed.add(owner);
        console.error(error);
      }
    }
  }
}
