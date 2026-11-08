import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const win = vi.hoisted(() => ({
  handler: null as null | (() => Promise<void>),
  fail: false,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => {
    if (win.fail) throw new TypeError("Cannot read properties of undefined (reading 'metadata')");
    return {
      onCloseRequested: (handler: () => Promise<void>) => {
        win.handler = handler;
        return Promise.resolve(() => {});
      },
    };
  },
}));

import { FLUSH_TIMEOUT_MS, beforeClose } from "./before_close";

describe("beforeClose", () => {
  beforeEach(() => {
    win.handler = null;
    win.fail = false;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Tauri の外（ウィンドウを取れない）でも、例外を同期的に投げず、失敗として返す（呼び出し側の catch に届く）", async () => {
    win.fail = true;
    let thrown: unknown = null;
    let promise: Promise<unknown> | null = null;
    try {
      promise = beforeClose(() => Promise.resolve());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeNull();
    await expect(promise).rejects.toThrow("metadata");
  });

  it("閉じる要求が来たら、後始末を待ってから進む", async () => {
    await beforeClose(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));
    let done = false;
    const closing = win.handler!().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(299);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(done).toBe(true);
  });

  it("後始末が終わらなくても、上限の時間で閉じる。後始末の失敗でも閉じる", async () => {
    await beforeClose(() => new Promise<void>(() => {}));
    let done = false;
    const closing = win.handler!().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(FLUSH_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await closing;
    expect(done).toBe(true);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await beforeClose(() => Promise.reject(new Error("flush failed")));
    await win.handler!();
    expect(error).toHaveBeenCalledWith(new Error("flush failed"));
    error.mockRestore();
  });
});
