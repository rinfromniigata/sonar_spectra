import { computed, ref } from "vue";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { createDeviceSelection } from "./device_selection";

function fakeConfig(initial: string | null) {
  const id = ref<string | null>(initial);
  return {
    deviceId: computed(() => id.value),
    setDeviceId: vi.fn((next: string | null) => {
      id.value = next;
    }),
  };
}

describe("createDeviceSelection", () => {
  it("restore：保存されたデバイスがあれば選ぶ。なければ何もしない（既定のデバイスで始まる）", async () => {
    const select = vi.fn<(id: string | null) => Promise<void>>(() => Promise.resolve());
    await createDeviceSelection(fakeConfig("{dev-1}"), select).restore();
    expect(select).toHaveBeenCalledWith("{dev-1}");

    select.mockClear();
    await createDeviceSelection(fakeConfig(null), select).restore();
    expect(select).not.toHaveBeenCalled();
  });

  it("restore：選べなくても失敗を知らせて終わる（start_stream に進める）", async () => {
    const onError = vi.fn();
    const select = vi.fn<(id: string | null) => Promise<void>>(() => Promise.reject(new Error("no device")));
    await expect(createDeviceSelection(fakeConfig("{gone}"), select, onError).restore()).resolves.toBeUndefined();
    expect(onError).toHaveBeenCalledWith(new Error("no device"));
  });

  it("choose：保存してから切り替える。既定のデバイス（null）も同じ", () => {
    const config = fakeConfig(null);
    const select = vi.fn<(id: string | null) => Promise<void>>(() => Promise.resolve());
    const selection = createDeviceSelection(config, select);

    selection.choose("{dev-2}");
    expect(config.setDeviceId).toHaveBeenCalledWith("{dev-2}");
    expect(select).toHaveBeenLastCalledWith("{dev-2}");
    expect(config.setDeviceId.mock.invocationCallOrder[0]).toBeLessThan(select.mock.invocationCallOrder[0]);

    selection.choose(null);
    expect(config.deviceId.value).toBeNull();
    expect(select).toHaveBeenLastCalledWith(null);
  });

  it("choose：今と同じデバイスなら、保存も開き直しもしない", () => {
    const config = fakeConfig("{dev-1}");
    const select = vi.fn<(id: string | null) => Promise<void>>(() => Promise.resolve());
    createDeviceSelection(config, select).choose("{dev-1}");
    expect(config.setDeviceId).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
  });

  it("choose：切り替えの失敗は知らせる（保存した選択は残す。結果は source-status で表示される）", async () => {
    const config = fakeConfig(null);
    const onError = vi.fn();
    createDeviceSelection(config, () => Promise.reject(new Error("boom")), onError).choose("{dev-3}");
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(new Error("boom")));
    expect(config.deviceId.value).toBe("{dev-3}");
  });
});
