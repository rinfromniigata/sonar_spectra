import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRuntimeStore } from "../app/runtime_store";
import { createConfigStore } from "../config/config_store";
import { createDefaultState } from "../config/persisted_state";
import { moduleRegistry } from "../modules";
import type { WindowApi } from "./window_api";
import { createWindowController } from "./window_controller";

/** ウィンドウの代役。全画面かどうかを覚え、大きさの変化を手で起こせる */
function fakeWindow(initial = { fullscreen: false }) {
  const state = { ...initial };
  const calls: string[] = [];
  const listeners = new Set<() => void>();
  const api: WindowApi = {
    isFullscreen: vi.fn(() => Promise.resolve(state.fullscreen)),
    setFullscreen: vi.fn((fullscreen: boolean) => {
      calls.push(`fullscreen:${fullscreen}`);
      state.fullscreen = fullscreen;
      return Promise.resolve();
    }),
    setAlwaysOnTop: vi.fn((on: boolean) => {
      calls.push(`top:${on}`);
      return Promise.resolve();
    }),
    onResized: vi.fn((handler: () => void) => {
      listeners.add(handler);
      return Promise.resolve(() => {
        listeners.delete(handler);
      });
    }),
  };
  return {
    api,
    state,
    calls,
    listenerCount: () => listeners.size,
    /** OS 側の変化（大きさが変わった合図）を起こす */
    resize: () => listeners.forEach((l) => l()),
  };
}

function setup(edit?: (display: { alwaysOnTop: boolean; startFullscreen: boolean }) => void, win = fakeWindow()) {
  const config = createConfigStore({
    persistence: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    createDefault: () => {
      const state = createDefaultState({ registry: moduleRegistry, defaultName: "既定" });
      edit?.(state.current.display);
      return state;
    },
  });
  const runtime = createRuntimeStore();
  const onError = vi.fn();
  const controller = createWindowController({ api: win.api, config, runtime, onError, settleMs: 50 });
  return { win, config, runtime, controller, onError };
}

describe("createWindowController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("全画面の切り替え", () => {
    it("押すたびに全画面とふつうのウィンドウを切り替え、実際の状態を runtime.fullscreen に映す", async () => {
      const { win, runtime, controller } = setup();
      await controller.start();
      expect(runtime.fullscreen.value).toBe(false);

      await controller.toggleFullscreen();
      expect(win.state.fullscreen).toBe(true);
      expect(runtime.fullscreen.value).toBe(true);

      await controller.toggleFullscreen();
      expect(win.state.fullscreen).toBe(false);
      expect(runtime.fullscreen.value).toBe(false);
      expect(win.calls.filter((c) => c.startsWith("fullscreen"))).toEqual(["fullscreen:true", "fullscreen:false"]);
    });

    it("全画面にできなかったときは、失敗を知らせ、実際の状態（全画面でない）のままにする", async () => {
      const { win, runtime, controller, onError } = setup();
      await controller.start();
      vi.mocked(win.api.setFullscreen).mockRejectedValueOnce(new Error("denied"));
      await controller.toggleFullscreen();
      expect(onError).toHaveBeenCalledWith(new Error("denied"));
      expect(runtime.fullscreen.value).toBe(false);
    });

    it("OS の操作などで全画面が変わっても、大きさの変化で読み直してボタンを合わせる", async () => {
      const { win, runtime, controller } = setup();
      await controller.start();
      win.state.fullscreen = true;
      win.resize();
      await vi.advanceTimersByTimeAsync(0);
      expect(runtime.fullscreen.value).toBe(true);
    });
  });

  describe("起動", () => {
    it("起動時に既定では、全画面にしない。常に最前面は反映する（オフ）", async () => {
      const { win, runtime, controller } = setup();
      await controller.start();
      expect(win.calls).toEqual(["top:false"]);
      expect(runtime.fullscreen.value).toBe(false);
    });

    it("起動時にボーダレスフルスクリーンがオンなら、1度だけ全画面にする", async () => {
      const { win, runtime, controller } = setup((display) => {
        display.startFullscreen = true;
      });
      await controller.start();
      expect(win.calls).toEqual(["top:false", "fullscreen:true"]);
      expect(runtime.fullscreen.value).toBe(true);
    });

    it("すでに全画面なら、起動時に全画面にし直さない", async () => {
      const { win, controller } = setup(
        (display) => {
          display.startFullscreen = true;
        },
        fakeWindow({ fullscreen: true }),
      );
      await controller.start();
      expect(win.calls).toEqual(["top:false"]);
    });

    it("Tauri の外など、ウィンドウを扱えなくても start は終わる（失敗を知らせるだけ）", async () => {
      const win = fakeWindow();
      vi.mocked(win.api.isFullscreen).mockRejectedValue(new Error("no tauri"));
      vi.mocked(win.api.onResized).mockRejectedValue(new Error("no tauri"));
      vi.mocked(win.api.setAlwaysOnTop).mockRejectedValue(new Error("no tauri"));
      const { controller, onError, runtime } = setup(undefined, win);
      await expect(controller.start()).resolves.toBeUndefined();
      expect(onError).toHaveBeenCalled();
      expect(runtime.fullscreen.value).toBe(false);
    });
  });

  describe("常に最前面", () => {
    it("設定を変えるたびにウィンドウへ反映する。ほかの設定の変更では呼ばない", async () => {
      const { win, config, controller } = setup();
      await controller.start();
      win.calls.length = 0;

      config.updateCurrent((c) => {
        c.display.alwaysOnTop = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      config.updateCurrent((c) => {
        c.display.scanline = false;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(win.calls).toEqual(["top:true"]);

      config.updateCurrent((c) => {
        c.display.alwaysOnTop = false;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(win.calls).toEqual(["top:true", "top:false"]);
    });

    it("起動時にオンなら、最初からオンにする", async () => {
      const { win, controller } = setup((display) => {
        display.alwaysOnTop = true;
      });
      await controller.start();
      expect(win.calls).toEqual(["top:true"]);
    });

    it("設定の変更で全画面の切り替えは起きない（起動時の全画面は起動のときだけ）", async () => {
      const { win, config, controller } = setup();
      await controller.start();
      config.updateCurrent((c) => {
        c.display.startFullscreen = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(win.calls.filter((c) => c.startsWith("fullscreen"))).toEqual([]);
    });
  });

  describe("閉じる前", () => {
    it("全画面でなければ、何もしない", async () => {
      const { win, controller } = setup();
      await controller.start();
      win.calls.length = 0;
      await controller.leaveFullscreenForClose();
      expect(win.calls).toEqual([]);
    });

    it("全画面なら全画面を終え、大きさの変化が届いたら進む", async () => {
      const { win, runtime, controller } = setup();
      await controller.start();
      await controller.toggleFullscreen();
      expect(win.state.fullscreen).toBe(true);

      let done = false;
      const leaving = controller.leaveFullscreenForClose().then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(win.state.fullscreen).toBe(false);
      expect(done).toBe(false);

      win.resize();
      await leaving;
      expect(done).toBe(true);
      expect(runtime.fullscreen.value).toBe(false);
    });

    it("大きさの変化が来なくても、上限の時間で進む。見張りは外す", async () => {
      const { win, controller } = setup();
      await controller.start();
      await controller.toggleFullscreen();
      const before = win.listenerCount();

      const leaving = controller.leaveFullscreenForClose();
      await vi.advanceTimersByTimeAsync(50);
      await leaving;
      expect(win.state.fullscreen).toBe(false);
      expect(win.listenerCount()).toBe(before);
    });
  });

  it("dispose で大きさの見張りと設定の見張りをやめる", async () => {
    const { win, config, controller } = setup();
    await controller.start();
    expect(win.listenerCount()).toBe(1);
    controller.dispose();
    expect(win.listenerCount()).toBe(0);

    win.calls.length = 0;
    config.updateCurrent((c) => {
      c.display.alwaysOnTop = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(win.calls).toEqual([]);
  });
});
