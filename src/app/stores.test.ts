import { createApp, defineComponent, h, inject } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string, args?: unknown) => invoke(command, args) }));

import { CONFIG_STORE_KEY } from "../config/config_store";
import type { PersistedState } from "../config/types";
import { RUNTIME_STORE_KEY } from "./runtime_store";
import { setupStores } from "./stores";

function savedStates(): PersistedState[] {
  return invoke.mock.calls.filter(([command]) => command === "save_state").map(([, args]) => (args as { state: PersistedState }).state);
}

describe("setupStores", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  it("初めての起動では、辞書の名前「既定」の保存済み構成を作って保存し、復元を済ませてから provide する", async () => {
    invoke.mockImplementation((command) => Promise.resolve(command === "load_state" ? null : undefined));
    const app = createApp(defineComponent({ render: () => h("div") }));
    const { config, runtime } = await setupStores(app);

    expect(invoke).toHaveBeenNthCalledWith(1, "load_state", undefined);
    const [saved] = savedStates();
    expect(saved.savedConfigs.map((c) => c.name)).toEqual(["既定"]);
    // 登録されたモジュールの既定のインスタンス（周波数別の定位を含む。VU は初期状態では無効）
    expect(saved.current.layout.instances.map((i) => i.kind)).toEqual(["level", "wave", "spec", "stereo", "gram", "loud", "vu", "chroma", "stereo"]);
    expect(saved.current.layout.instances.filter((i) => !i.enabled).map((i) => i.kind)).toEqual(["vu", "chroma"]);
    expect(config.activeConfig.value?.name).toBe("既定");

    const provided = app.runWithContext(() => [inject(CONFIG_STORE_KEY), inject(RUNTIME_STORE_KEY)]);
    expect(provided).toEqual([config, runtime]);
  });

  it("保存された状態があれば、それを復元して保存しない", async () => {
    // 1回目の起動で作って変えた状態を、2回目の起動で読む
    invoke.mockImplementation((command) => Promise.resolve(command === "load_state" ? null : undefined));
    const first = await setupStores(createApp(defineComponent({ render: () => h("div") })));
    first.config.updateCurrent((c) => {
      c.theme = "light";
    });
    await first.config.flush();
    const states = savedStates();
    const last = states[states.length - 1];

    invoke.mockReset();
    invoke.mockImplementation((command) => Promise.resolve(command === "load_state" ? structuredClone(last) : undefined));
    const second = await setupStores(createApp(defineComponent({ render: () => h("div") })));
    expect(second.config.state.value).toEqual(last);
    expect(second.config.current.value.theme).toBe("light");
    expect(savedStates()).toEqual([]);
  });
});
