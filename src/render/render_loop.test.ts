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

function setup() {
  const scheduler = new ManualScheduler();
  const client = new FrameClient();
  const loop = new RenderLoop(client, () => COLORS, scheduler);
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
});
