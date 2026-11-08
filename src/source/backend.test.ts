import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, args?: unknown) => invoke(command, args) }));

import { listOutputDevices, retrySource, selectOutputDevice } from "./backend";

describe("retrySource", () => {
  // 何も返さない（beforeEach が関数を返すと、テスト後の後始末として呼ばれてしまう）
  beforeEach(() => {
    invoke.mockReset();
  });

  it("Rust の retry_source コマンドを、引数なしで呼ぶ", async () => {
    invoke.mockResolvedValue(undefined);
    await retrySource();
    expect(invoke).toHaveBeenCalledWith("retry_source", undefined);
  });

  it("コマンドが失敗したら、その失敗を呼び出し元に返す", async () => {
    invoke.mockRejectedValue(new Error("boom"));
    await expect(retrySource()).rejects.toThrow("boom");
  });
});

describe("listOutputDevices", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("Rust の list_output_devices コマンドを引数なしで呼び、一覧を返す", async () => {
    const devices = [{ id: "{dev-1}", name: "スピーカー", isDefault: true }];
    invoke.mockResolvedValue(devices);
    await expect(listOutputDevices()).resolves.toEqual(devices);
    expect(invoke).toHaveBeenCalledWith("list_output_devices", undefined);
  });
});

describe("selectOutputDevice", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("Rust の select_output_device コマンドに deviceId という名前で渡す（null は既定のデバイス）", async () => {
    invoke.mockResolvedValue(undefined);
    await selectOutputDevice("{dev-1}");
    expect(invoke).toHaveBeenCalledWith("select_output_device", { deviceId: "{dev-1}" });
    await selectOutputDevice(null);
    expect(invoke).toHaveBeenLastCalledWith("select_output_device", { deviceId: null });
  });
});
