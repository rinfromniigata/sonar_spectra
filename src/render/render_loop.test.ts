import { describe, expect, it, vi } from "vitest";
import { FrameClient } from "../frame_client";
import type { FrameDrawInput } from "../modules/types";
import type { CanvasColors } from "../theme/canvas_colors";
import { MAX_FRAME_DT, RenderLoop, type Scheduler } from "./render_loop";

/** 手で進めるスケジューラ：予約は1つずつ溜まり、step で1回分を実行する */
class ManualScheduler implements Scheduler {
  private next = 1;
  readonly pending = new Map<number, (time: number) => void>();
  request(callback: (time: number) => void): number {
    const handle = this.next++;
    this.pending.set(handle, callback);
    return handle;
  }
  cancel(handle: number): void {
    this.pending.delete(handle);
  }
  step(time: number): void {
    const entries = [...this.pending.entries()];
    this.pending.clear();
    for (const [, callback] of entries) callback(time);
  }
}

const COLORS = { theme: "dark" } as CanvasColors;

function setup(frameLimit: () => number = () => 60) {
  const scheduler = new ManualScheduler();
  const client = new FrameClient();
  const loop = new RenderLoop(client, () => COLORS, scheduler, frameLimit);
  const inputs: FrameDrawInput[] = [];
  const unregister = loop.register({ draw: (input) => inputs.push(input) });
  return { scheduler, client, loop, inputs, unregister };
}

describe("RenderLoop", () => {
  it("予約は常に1本だけで、毎回最新のフレーム・履歴・色・経過時間を渡す", () => {
    const { scheduler, client, loop, inputs } = setup();
    loop.start();
    loop.start();
    expect(scheduler.pending.size).toBe(1);

    scheduler.step(1000);
    scheduler.step(1016);
    expect(scheduler.pending.size).toBe(1);
    expect(inputs).toHaveLength(2);
    expect(inputs[0].dt).toBe(0);
    expect(inputs[1].dt).toBeCloseTo(0.016, 6);
    expect(inputs[1].frame).toBe(client.latest);
    expect(inputs[1].histories).toBe(client.histories);
    expect(inputs[1].colors).toBe(COLORS);
  });

  it("一時停止中は予約しない。再開した最初の回は経過時間0", () => {
    const { scheduler, loop, inputs } = setup();
    loop.start();
    scheduler.step(0);
    loop.setPaused(true);
    expect(loop.running).toBe(false);
    expect(scheduler.pending.size).toBe(0);

    loop.setPaused(false);
    expect(scheduler.pending.size).toBe(1);
    scheduler.step(60_000);
    expect(inputs[inputs.length - 1].dt).toBe(0);
  });

  it("始める前の一時停止の解除では回らない", () => {
    const { scheduler, loop } = setup();
    loop.setPaused(false);
    expect(scheduler.pending.size).toBe(0);
    loop.setPaused(true);
    loop.start();
    expect(scheduler.pending.size).toBe(0);
    loop.setPaused(false);
    expect(scheduler.pending.size).toBe(1);
  });

  it("経過時間に上限をかける", () => {
    const { scheduler, loop, inputs } = setup();
    loop.start();
    scheduler.step(0);
    scheduler.step(5_000);
    expect(inputs[inputs.length - 1].dt).toBe(MAX_FRAME_DT);
  });

  it("stop で予約を取り消し、外したものは描かない", () => {
    const { scheduler, loop, inputs, unregister } = setup();
    loop.start();
    unregister();
    scheduler.step(0);
    expect(inputs).toHaveLength(0);
    loop.stop();
    expect(scheduler.pending.size).toBe(0);
  });

  describe("フレームレートの上限", () => {
    it("上限を超える回は描かずに飛ばし、予約は続ける。経過時間は描いた回どうしの差", () => {
      const { scheduler, loop, inputs } = setup(() => 60);
      loop.start();
      // 120 Hz の画面（8.33ms ごと）：1回おきに描く
      for (let i = 0; i < 7; i++) {
        scheduler.step(1000 + (i * 1000) / 120);
        expect(scheduler.pending.size).toBe(1);
      }
      expect(inputs).toHaveLength(4);
      expect(inputs[0].dt).toBe(0);
      for (const input of inputs.slice(1)) expect(input.dt).toBeCloseTo(1 / 60, 6);
    });

    it("上限が30fps のときは、120 Hz の画面の4回に1回描く", () => {
      const { scheduler, loop, inputs } = setup(() => 30);
      loop.start();
      for (let i = 0; i < 120; i++) scheduler.step(1000 + (i * 1000) / 120);
      expect(inputs).toHaveLength(30);
    });

    it("上限を変えると、次の回から効く（描いたばかりでも、すぐ描く。そのあとは新しい上限で間引く）", () => {
      let limit = 30;
      const { scheduler, loop, inputs } = setup(() => limit);
      loop.start();
      const display = 1000 / 120;
      scheduler.step(1000); // 描く
      scheduler.step(1000 + display); // 30fps：飛ばす
      expect(inputs).toHaveLength(1);

      limit = 60;
      scheduler.step(1000 + display * 2); // 変えた直後の回：描く
      expect(inputs).toHaveLength(2);
      scheduler.step(1000 + display * 3); // 60fps：飛ばす
      expect(inputs).toHaveLength(2);
      scheduler.step(1000 + display * 4); // 描く
      expect(inputs).toHaveLength(3);
    });

    it("画面の周期が上限より長いときは、来た回ごとに描く（上限は引き上げない）", () => {
      const { scheduler, loop, inputs } = setup(() => 60);
      loop.start();
      for (let i = 0; i < 30; i++) scheduler.step(1000 + i * 33.3);
      expect(inputs).toHaveLength(30);
    });

    it("最小化から戻した最初の回は、間引きの数え直しをして必ず描く", () => {
      const { scheduler, loop, inputs } = setup(() => 30);
      loop.start();
      scheduler.step(1000);
      loop.setPaused(true);
      loop.setPaused(false);
      scheduler.step(1005); // 30fps の周期（33ms）に満たなくても、再開の最初の回は描く
      expect(inputs).toHaveLength(2);
      expect(inputs[1].dt).toBe(0);
    });

    it("上限を渡さなければ60fps", () => {
      const scheduler = new ManualScheduler();
      const loop = new RenderLoop(new FrameClient(), () => COLORS, scheduler);
      const inputs: FrameDrawInput[] = [];
      loop.register({ draw: (input) => inputs.push(input) });
      loop.start();
      for (let i = 0; i < 120; i++) scheduler.step(1000 + (i * 1000) / 120);
      expect(inputs).toHaveLength(60);
    });
  });

  it("1つが失敗しても、ほかは描き続け、同じ失敗は1度だけ記録する", () => {
    const { scheduler, loop, inputs } = setup();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    loop.register({
      draw: () => {
        throw new Error("broken module");
      },
    });
    loop.start();
    scheduler.step(0);
    scheduler.step(16);
    expect(inputs).toHaveLength(2);
    expect(error).toHaveBeenCalledTimes(1);
    expect(scheduler.pending.size).toBe(1);
    error.mockRestore();
  });

  describe("層（描画の層）", () => {
    it("描く回ごとに、描くものの前に begin、後に end を同じ入力で呼ぶ。描かない回は呼ばない", () => {
      const { scheduler, loop } = setup();
      const calls: string[] = [];
      const seen: FrameDrawInput[] = [];
      loop.register({ draw: () => calls.push("draw") });
      const remove = loop.addLayer({
        begin: (input) => {
          calls.push("begin");
          seen.push(input);
        },
        end: (input) => {
          calls.push("end");
          seen.push(input);
        },
      });
      loop.start();
      scheduler.step(0);
      expect(calls).toEqual(["begin", "draw", "end"]);
      expect(seen[0]).toBe(seen[1]);
      // 上限60fpsで、120 Hz の次の回（8ms後）は描かない
      scheduler.step(8);
      expect(calls).toHaveLength(3);
      remove();
      scheduler.step(16.7);
      expect(calls).toEqual(["begin", "draw", "end", "draw"]);
    });

    it("層やモジュールが失敗しても、残りを呼び、同じ失敗は1度だけ記録する", () => {
      const { scheduler, loop, inputs } = setup();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const ends: number[] = [];
      loop.addLayer({
        begin: () => {
          throw new Error("broken layer");
        },
        end: () => ends.push(1),
      });
      loop.start();
      scheduler.step(0);
      scheduler.step(16.7);
      expect(inputs).toHaveLength(2);
      expect(ends).toHaveLength(2);
      expect(error).toHaveBeenCalledTimes(1);
      error.mockRestore();
    });
  });
});
