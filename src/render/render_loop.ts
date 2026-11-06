// 描画ループ：requestAnimationFrame を1本だけ回し、表示中のモジュールを順に描く（画面のリフレッシュに合わせる）。
// 受信とは切り離し、毎回その時点の最新のフレームと共有の履歴を渡す（描画が重くても受信・取得は止まらない）。

import type { AnalysisFrame, Histories } from "../frame_client";
import type { FrameDrawInput } from "../modules/types";
import type { CanvasColors } from "../theme/canvas_colors";

/** 描くもの（ModuleFrame） */
export interface Drawable {
  draw(input: FrameDrawInput): void;
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
  /** 一度でも失敗したもの（同じ失敗を毎フレーム記録しない） */
  private readonly failed = new WeakSet<Drawable>();
  private started = false;
  private paused = false;
  private handle: number | null = null;
  private lastTime: number | null = null;

  constructor(
    private readonly source: FrameSource,
    private readonly colors: () => CanvasColors,
    private readonly scheduler: Scheduler = animationFrameScheduler,
  ) {}

  /** 描くものを加える。返す関数で外す */
  register(drawable: Drawable): () => void {
    this.drawables.add(drawable);
    return () => {
      this.drawables.delete(drawable);
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
    // 再開した最初の回は経過時間を0にする（止まっていた時間を流さない）
    this.lastTime = null;
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
    const dt = this.lastTime === null ? 0 : Math.min(Math.max(0, (time - this.lastTime) / 1000), MAX_FRAME_DT);
    this.lastTime = time;

    const input: FrameDrawInput = {
      frame: this.source.latest,
      histories: this.source.histories,
      colors: this.colors(),
      dt,
    };
    for (const drawable of this.drawables) {
      try {
        drawable.draw(input);
      } catch (error) {
        // 1つのモジュールの失敗で、ほかのモジュールの描画を止めない
        if (!this.failed.has(drawable)) {
          this.failed.add(drawable);
          console.error(error);
        }
      }
    }
    this.handle = this.scheduler.request(this.tick);
  };
}
