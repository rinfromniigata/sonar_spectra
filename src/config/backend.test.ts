import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, args?: unknown) => invoke(command, args) }));

import { loadState, saveState } from "./backend";
import type { PersistedState } from "./types";

describe("loadState・saveState", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("load_state を引数なしで呼び、結果（null を含む）をそのまま返す", async () => {
    invoke.mockResolvedValue(null);
    await expect(loadState()).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith("load_state", undefined);
  });

  it("save_state に state という名前で渡す。失敗は呼び出し元に返す", async () => {
    const state = { schema: 2 } as unknown as PersistedState;
    invoke.mockResolvedValue(undefined);
    await saveState(state);
    expect(invoke).toHaveBeenCalledWith("save_state", { state });

    invoke.mockRejectedValue("invalid state: no saved config");
    await expect(saveState(state)).rejects.toBe("invalid state: no saved config");
  });
});
