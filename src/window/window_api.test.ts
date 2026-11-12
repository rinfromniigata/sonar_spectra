import { describe, expect, it } from "vitest";
import { macFullscreen, type MacWindowOps } from "./window_api";

/** Tauri のウィンドウの代役。OS の全画面と simple fullscreen を別々に持つ（Tauri と同じ） */
function fakeWindow(options: { native?: boolean; failSimple?: boolean } = {}) {
  const state = { native: options.native ?? false, simple: false };
  const calls: string[] = [];
  const ops: MacWindowOps = {
    isFullscreen: () => Promise.resolve(state.native),
    setFullscreen: (fullscreen) => {
      calls.push(`setFullscreen(${fullscreen})`);
      state.native = fullscreen;
      return Promise.resolve();
    },
    setSimpleFullscreen: (fullscreen) => {
      calls.push(`setSimpleFullscreen(${fullscreen})`);
      if (options.failSimple) return Promise.reject(new Error("failed"));
      state.simple = fullscreen;
      return Promise.resolve();
    },
  };
  return { state, calls, ops };
}

describe("macFullscreen", () => {
  it("全画面は simple fullscreen で入り、終える（新しい操作スペースを作らない。S09a）", async () => {
    const win = fakeWindow();
    const api = macFullscreen(win.ops);
    expect(await api.isFullscreen()).toBe(false);
    await api.setFullscreen(true);
    expect(win.state.simple).toBe(true);
    // Tauri の isFullscreen は simple fullscreen を見ないが、全画面として返す
    expect(await api.isFullscreen()).toBe(true);
    await api.setFullscreen(false);
    expect(win.state.simple).toBe(false);
    expect(await api.isFullscreen()).toBe(false);
    expect(win.calls).toEqual(["setSimpleFullscreen(true)", "setSimpleFullscreen(false)"]);
  });

  it("同じ状態への切り替えは何もしない", async () => {
    const win = fakeWindow();
    const api = macFullscreen(win.ops);
    await api.setFullscreen(false);
    await api.setFullscreen(true);
    await api.setFullscreen(true);
    expect(win.calls).toEqual(["setSimpleFullscreen(true)"]);
  });

  it("OS の全画面（緑のボタン）のときも全画面として扱い、終えるときは OS の全画面を終える", async () => {
    const win = fakeWindow({ native: true });
    const api = macFullscreen(win.ops);
    expect(await api.isFullscreen()).toBe(true);
    await api.setFullscreen(true);
    await api.setFullscreen(false);
    expect(win.calls).toEqual(["setFullscreen(false)"]);
    expect(await api.isFullscreen()).toBe(false);
  });

  it("simple fullscreen に入れなかったときは、全画面にならなかったものとして扱う", async () => {
    const win = fakeWindow({ failSimple: true });
    const api = macFullscreen(win.ops);
    await expect(api.setFullscreen(true)).rejects.toThrow("failed");
    expect(await api.isFullscreen()).toBe(false);
  });
});
