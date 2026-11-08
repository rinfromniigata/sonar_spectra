import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "../modules/registry";
import { testDefinition } from "../modules/test_definitions";
import { SAVE_DELAY_MS, createConfigStore, type ConfigPersistence } from "./config_store";
import { createDefaultState, normalizeState } from "./persisted_state";
import type { PersistedState } from "./types";

function registry(): ModuleRegistry {
  const r = new ModuleRegistry();
  r.register(testDefinition("level", {}, [{ enabled: true }], "up"));
  r.register(testDefinition("spec", { mode: "fill", ghost: true }, [{ enabled: true }]));
  return r;
}

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function defaultState(): PersistedState {
  return createDefaultState({
    registry: registry(),
    defaultName: "既定",
    now: () => new Date("2026-11-08T07:00:00.000Z"),
    newConfigId: counter("c"),
    newInstanceId: counter("i"),
  });
}

/** 呼ばれた順に記録し、save の完了を手で進められる保存先 */
function fakePersistence(loaded: PersistedState | null | Error = null) {
  const saved: PersistedState[] = [];
  const resolvers: (() => void)[] = [];
  let manual = false;
  const persistence: ConfigPersistence = {
    load: vi.fn(() => (loaded instanceof Error ? Promise.reject(loaded) : Promise.resolve(loaded))),
    save: vi.fn((state: PersistedState) => {
      saved.push(state);
      if (!manual) return Promise.resolve();
      return new Promise<void>((resolve) => resolvers.push(resolve));
    }),
  };
  return {
    persistence,
    saved,
    /** 以降の save を、finishSave を呼ぶまで終わらせない */
    holdSaves: () => {
      manual = true;
    },
    finishSave: () => resolvers.shift()?.(),
  };
}

function store(persistence: ConfigPersistence, onError = vi.fn()) {
  return {
    onError,
    store: createConfigStore({
      persistence,
      createDefault: defaultState,
      normalize: (s) => normalizeState(s, registry()),
      onError,
    }),
  };
}

describe("createConfigStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("初めての起動（保存された状態がない）では、既定の状態を作ってすぐに保存する", async () => {
    const p = fakePersistence(null);
    const { store: s } = store(p.persistence);
    expect(await s.restore()).toBe("created");
    expect(p.saved).toEqual([defaultState()]);
    // 保存済みの構成「既定」が使用中で、今の構成はその写し、変更なし
    expect(s.activeConfig.value?.name).toBe("既定");
    expect(s.dirty.value).toBe(false);
    expect(s.deviceId.value).toBeNull();
  });

  it("保存された状態があれば、それを復元し（設定の既定値を補う）、保存はしない", async () => {
    const restored = defaultState();
    restored.current.theme = "light";
    restored.dirty = true;
    restored.source.deviceId = "dev-1";
    const spec = restored.current.layout.instances.find((i) => i.kind === "spec")!;
    spec.options = { mode: "bars" } as typeof spec.options;
    const p = fakePersistence(restored);
    const { store: s } = store(p.persistence);

    expect(await s.restore()).toBe("restored");
    expect(s.current.value.theme).toBe("light");
    expect(s.dirty.value).toBe(true);
    expect(s.deviceId.value).toBe("dev-1");
    expect(s.current.value.layout.instances.find((i) => i.kind === "spec")!.options).toEqual({ mode: "bars", ghost: true });
    await vi.runAllTimersAsync();
    expect(p.saved).toEqual([]);
  });

  it("読み込みに失敗したら既定の状態で起動し、元のファイルを上書きしないよう、変更しても保存しない", async () => {
    const p = fakePersistence(new Error("permission denied"));
    const { store: s, onError } = store(p.persistence);
    expect(await s.restore()).toBe("unavailable");
    expect(onError).toHaveBeenCalled();
    expect(s.activeConfig.value?.name).toBe("既定");

    s.updateCurrent((c) => {
      c.theme = "light";
    });
    await vi.runAllTimersAsync();
    await s.flush();
    expect(p.persistence.save).not.toHaveBeenCalled();
  });

  it("構成を変えると「保存後に変更あり」になり、間を置いて最後の状態を1回だけ保存する", async () => {
    const p = fakePersistence(defaultState());
    const { store: s } = store(p.persistence);
    await s.restore();
    const before = s.current.value;

    s.updateCurrent((c) => {
      c.theme = "light";
    });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
    s.updateCurrent((c) => {
      c.display.scanline = false;
    });
    // 置き換えなので、前の構成は変わらない
    expect(before.theme).toBe("dark");
    expect(s.current.value).not.toBe(before);
    expect(s.dirty.value).toBe(true);

    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS - 1);
    expect(p.saved).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(p.saved).toHaveLength(1);
    expect(p.saved[0].current.theme).toBe("light");
    expect(p.saved[0].current.display.scanline).toBe(false);
    expect(p.saved[0].dirty).toBe(true);
  });

  it("入力源のデバイスを変えても「保存後に変更あり」にはならないが、保存はする。同じ値なら何もしない", async () => {
    const p = fakePersistence(defaultState());
    const { store: s } = store(p.persistence);
    await s.restore();

    s.setDeviceId(null);
    await vi.runAllTimersAsync();
    expect(p.saved).toHaveLength(0);

    s.setDeviceId("dev-2");
    expect(s.dirty.value).toBe(false);
    await vi.runAllTimersAsync();
    expect(p.saved.map((x) => [x.source.deviceId, x.dirty])).toEqual([["dev-2", false]]);
  });

  it("保存は重ねない。書いている間の変更は、書き終わってから最後の状態で書く", async () => {
    const p = fakePersistence(defaultState());
    const { store: s } = store(p.persistence);
    await s.restore();
    p.holdSaves();

    s.updateCurrent((c) => {
      c.theme = "light";
    });
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    expect(p.saved).toHaveLength(1);

    s.updateCurrent((c) => {
      c.theme = "system";
    });
    s.setDeviceId("dev-3");
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    // 1回目が終わっていないので、2回目はまだ書かない
    expect(p.saved).toHaveLength(1);

    p.finishSave();
    await vi.advanceTimersByTimeAsync(0);
    expect(p.saved).toHaveLength(2);
    expect(p.saved[1].current.theme).toBe("system");
    expect(p.saved[1].source.deviceId).toBe("dev-3");
    p.finishSave();
  });

  it("flush は間を待たずに保存し、書き終わるまで待つ", async () => {
    const p = fakePersistence(defaultState());
    const { store: s } = store(p.persistence);
    await s.restore();
    p.holdSaves();

    s.updateCurrent((c) => {
      c.display.alwaysOnTop = true;
    });
    let done = false;
    const flushing = s.flush().then(() => {
      done = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.saved).toHaveLength(1);
    expect(done).toBe(false);
    p.finishSave();
    await flushing;
    expect(done).toBe(true);

    // 間を置いていた保存は取り消され、二重に書かない
    await vi.runAllTimersAsync();
    expect(p.saved).toHaveLength(1);
  });

  it("保存に失敗したら知らせ、次の変更でまた保存する", async () => {
    const p = fakePersistence(defaultState());
    const { store: s, onError } = store(p.persistence);
    await s.restore();
    vi.mocked(p.persistence.save).mockRejectedValueOnce(new Error("disk full"));

    s.updateCurrent((c) => {
      c.theme = "light";
    });
    await vi.runAllTimersAsync();
    expect(onError).toHaveBeenCalledWith(new Error("disk full"));

    s.updateCurrent((c) => {
      c.theme = "dark";
    });
    await vi.runAllTimersAsync();
    expect(p.persistence.save).toHaveBeenCalledTimes(2);
  });

  it("dispose は間を置いている保存を取り消す", async () => {
    const p = fakePersistence(defaultState());
    const { store: s } = store(p.persistence);
    await s.restore();
    s.updateCurrent((c) => {
      c.theme = "light";
    });
    s.dispose();
    await vi.runAllTimersAsync();
    expect(p.saved).toHaveLength(0);
  });
});
