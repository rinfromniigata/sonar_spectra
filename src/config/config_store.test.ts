import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleRegistry } from "../modules/registry";
import { testDefinition } from "../modules/test_definitions";
import { SAVE_DELAY_MS, createConfigStore, type ConfigPersistence } from "./config_store";
import { createDefaultState, normalizeState } from "./persisted_state";
import type { PersistedState } from "./types";
import { configOf } from "./saved_configs";

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
  let minutes = 0;
  return {
    onError,
    store: createConfigStore({
      persistence,
      createDefault: defaultState,
      normalize: (s) => normalizeState(s, registry()),
      onError,
      newConfigId: counter("saved"),
      // 呼ばれるたびに1分進む時計
      now: () => new Date(Date.UTC(2026, 10, 9, 1, minutes++)),
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

  it("フレームレートの上限は既定60fps。変えても「保存後に変更あり」にならず構成も変わらないが、保存はする。同じ値なら何もしない", async () => {
    const p = fakePersistence(defaultState());
    const { store: s } = store(p.persistence);
    await s.restore();
    expect(s.frameLimit.value).toBe(60);
    const current = s.current.value;

    s.setFrameLimit(60);
    await vi.runAllTimersAsync();
    expect(p.saved).toHaveLength(0);

    s.setFrameLimit(30);
    expect(s.frameLimit.value).toBe(30);
    expect(s.dirty.value).toBe(false);
    expect(s.current.value).toBe(current);
    await vi.runAllTimersAsync();
    expect(p.saved.map((x) => [x.app.frameLimit, x.dirty])).toEqual([[30, false]]);
  });

  it("構成を切り替えても、上書き保存・名前を付けて保存・読み込みをしても、フレームレートの上限は変わらない", async () => {
    const p = fakePersistence(defaultState());
    const { store: s } = store(p.persistence);
    await s.restore();
    s.setFrameLimit(45);
    const second = s.saveAs("2つ目")!;
    s.updateCurrent((c) => {
      c.theme = "light";
    });
    expect(s.overwrite()).toBe(true);
    const first = s.state.value.savedConfigs[0].id;
    expect(s.switchConfig(first)).toBe("switched");
    expect(s.switchConfig(second)).toBe("switched");
    expect(s.duplicateConfig(first, "写し")).not.toBeNull();
    expect(s.removeConfig(first)).toBe(true);
    expect(s.frameLimit.value).toBe(45);
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

  it("変えてから元に戻すと、「保存後に変更あり」も消える。復元したときも中身で決め直す", async () => {
    const p = fakePersistence(defaultState());
    const { store: s } = store(p.persistence);
    await s.restore();
    s.updateCurrent((c) => {
      c.theme = "light";
    });
    expect(s.dirty.value).toBe(true);
    s.updateCurrent((c) => {
      c.theme = "dark";
    });
    expect(s.dirty.value).toBe(false);

    // 保存された dirty が true でも、中身が同じなら変更なしで起動する
    const stale = defaultState();
    stale.dirty = true;
    const q = fakePersistence(stale);
    const { store: t } = store(q.persistence);
    await t.restore();
    expect(t.dirty.value).toBe(false);
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

describe("構成の操作（T7-3）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function opened() {
    const p = fakePersistence(defaultState());
    const { store: s } = store(p.persistence);
    await s.restore();
    return { p, s };
  }

  const names = (s: ReturnType<typeof store>["store"]) => s.state.value.savedConfigs.map((c) => c.name);

  it("imple 5.2 の9〜11：名前を付けて保存 → 配色を作る → 切り替えで確認 → 破棄で「既定」の写しに戻り、作った配色は消える", async () => {
    const { p, s } = await opened();
    s.updateCurrent((c) => {
      c.theme = "light";
    });

    // 9. 「クラブ用」と付けて保存
    const club = s.saveAs("クラブ用")!;
    expect(club).toBe("saved-1");
    expect(names(s)).toEqual(["既定", "クラブ用"]);
    expect(s.activeConfig.value?.id).toBe(club);
    expect(s.activeConfig.value?.savedAt).toBe("2026-11-09T01:00:00.000Z");
    expect(s.dirty.value).toBe(false);

    // 10. 配色を作る → 変更あり
    s.updateCurrent((c) => {
      c.customPalettes.push({ id: "custom.p1", name: "マイ配色 1", main: "#b7ff3c", sub: "#8b5cff", accent: "#ffb547" });
    });
    expect(s.dirty.value).toBe(true);

    // 11. 「既定」に切り替える → 変更があるので確かめる（まだ何も変えない）
    const before = s.state.value;
    expect(s.switchConfig("c-1")).toBe("needsConfirm");
    expect(s.state.value).toBe(before);

    // 破棄を選ぶ
    expect(s.switchConfig("c-1", { action: "discard" })).toBe("switched");
    expect(s.activeConfig.value?.name).toBe("既定");
    expect(s.current.value).toEqual(configOf(s.state.value.savedConfigs[0]));
    expect(s.current.value.theme).toBe("dark");
    expect(s.current.value.customPalettes).toEqual([]);
    expect(s.dirty.value).toBe(false);
    // 「クラブ用」は配色を作る前のまま
    expect(s.state.value.savedConfigs[1].customPalettes).toEqual([]);
    expect(s.state.value.savedConfigs[1].theme).toBe("light");

    // 切り替えも自動保存する
    await vi.runAllTimersAsync();
    expect(p.saved[p.saved.length - 1]?.activeConfigId).toBe("c-1");
  });

  it("切り替えで上書きを選ぶと、使用中の構成に上書きしてから切り替える", async () => {
    const { s } = await opened();
    s.saveAs("クラブ用");
    s.updateCurrent((c) => {
      c.display.scanline = false;
    });
    expect(s.switchConfig("c-1", { action: "overwrite" })).toBe("switched");
    expect(s.activeConfig.value?.name).toBe("既定");
    expect(s.state.value.savedConfigs[1].display.scanline).toBe(false);
    expect(s.dirty.value).toBe(false);
  });

  it("切り替えで別名で保存を選ぶと、名前を付けて保存してから切り替える。名前が空なら何もしない", async () => {
    const { s } = await opened();
    s.updateCurrent((c) => {
      c.theme = "system";
    });
    const before = s.state.value;
    expect(s.switchConfig("c-1", { action: "saveAs", name: " " })).toBe("invalidName");
    expect(s.state.value).toBe(before);

    expect(s.switchConfig("c-1", { action: "saveAs", name: "昼用" })).toBe("switched");
    expect(names(s)).toEqual(["既定", "昼用"]);
    expect(s.state.value.savedConfigs[1].theme).toBe("system");
    expect(s.activeConfig.value?.name).toBe("既定");
    expect(s.current.value.theme).toBe("dark");
  });

  it("変更がなければ確かめずに切り替える。使用中で変更がなければ何もしない。ない構成は notFound", async () => {
    const { s } = await opened();
    const club = s.saveAs("クラブ用")!;
    expect(s.switchConfig("c-1")).toBe("switched");
    expect(s.activeConfig.value?.id).toBe("c-1");

    const before = s.state.value;
    expect(s.switchConfig("c-1")).toBe("unchanged");
    expect(s.switchConfig("none")).toBe("notFound");
    expect(s.switchConfig("none", { action: "discard" })).toBe("notFound");
    expect(s.state.value).toBe(before);
    expect(s.switchConfig(club)).toBe("switched");
  });

  it("使用中の構成に変更があるとき、同じ構成を選び直すと確かめ、破棄すれば保存した内容に戻る", async () => {
    const { s } = await opened();
    s.updateCurrent((c) => {
      c.theme = "light";
    });
    expect(s.switchConfig("c-1")).toBe("needsConfirm");
    expect(s.switchConfig("c-1", { action: "discard" })).toBe("switched");
    expect(s.current.value.theme).toBe("dark");
    expect(s.dirty.value).toBe(false);
  });

  it("上書き：使用中の構成を今の構成にし、変更なしにする", async () => {
    const { s } = await opened();
    s.updateCurrent((c) => {
      c.theme = "light";
    });
    expect(s.overwrite()).toBe(true);
    expect(s.activeConfig.value?.theme).toBe("light");
    expect(s.activeConfig.value?.name).toBe("既定");
    expect(s.dirty.value).toBe(false);
  });

  it("複製：元のすぐ後ろに足し、使用中は変えない。削除：使用中は消せず、それ以外は消すだけ", async () => {
    const { s } = await opened();
    s.saveAs("クラブ用");
    s.switchConfig("c-1");
    const copy = s.duplicateConfig("c-1", "既定のコピー")!;
    expect(names(s)).toEqual(["既定", "既定のコピー", "クラブ用"]);
    expect(s.activeConfig.value?.id).toBe("c-1");
    expect(s.duplicateConfig("none", "x")).toBeNull();

    expect(s.canRemoveConfig("c-1")).toBe(false);
    expect(s.removeConfig("c-1")).toBe(false);
    expect(s.canRemoveConfig(copy)).toBe(true);
    const current = s.current.value;
    expect(s.removeConfig(copy)).toBe(true);
    expect(names(s)).toEqual(["既定", "クラブ用"]);
    expect(s.current.value).toBe(current);
    expect(s.removeConfig(copy)).toBe(false);
  });

  it("名前を付けて保存は、すでにある名前なら _1・_2 を付けて足す。空の名前は何もしない", async () => {
    const { s } = await opened();
    expect(s.saveAs("既定")).toBe("saved-1");
    expect(s.saveAs("既定")).toBe("saved-2");
    expect(names(s)).toEqual(["既定", "既定_1", "既定_2"]);
    const before = s.state.value;
    expect(s.saveAs("  ")).toBeNull();
    expect(s.state.value).toBe(before);
  });
});

describe("構成の読み込み（T7-4）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("新しい ID で一覧に足し、モジュールの設定の既定値を補う。使用中・今の構成・変更ありは変えず、自動保存する", async () => {
    const p = fakePersistence(defaultState());
    const { store: s } = store(p.persistence);
    await s.restore();
    const file = structuredClone(s.state.value.savedConfigs[0]);
    file.id = "c-from-file";
    file.name = "別のPCの構成";
    const spec = file.layout.instances.find((i) => i.kind === "spec")!;
    spec.options = { mode: "bars" } as typeof spec.options;
    const current = s.current.value;
    const before = s.state.value.savedConfigs[0];

    const id = s.importConfig(file)!;
    expect(id).toBe("saved-1");
    const added = s.state.value.savedConfigs[1];
    expect(added.name).toBe("別のPCの構成");
    expect(added.layout.instances.find((i) => i.kind === "spec")!.options).toEqual({ mode: "bars", ghost: true });
    expect(s.activeConfig.value?.id).toBe("c-1");
    // 今の構成と、ほかの保存済み構成は作り直さない（同じオブジェクト）
    expect(s.current.value).toBe(current);
    expect(s.state.value.savedConfigs[0]).toBe(before);
    expect(s.dirty.value).toBe(false);

    // 同じものをもう1度読み込むと、別の ID でもう1件
    expect(s.importConfig(file)).toBe("saved-2");
    expect(s.state.value.savedConfigs).toHaveLength(3);
    expect(s.importConfig({ ...file, name: "" })).toBeNull();

    await vi.runAllTimersAsync();
    expect(p.saved[p.saved.length - 1]?.savedConfigs).toHaveLength(3);
  });
});
