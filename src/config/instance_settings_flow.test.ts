// W6-2：インスタンスの設定を変えたときの流れ（画面の操作 → 構成の更新 → 保存 → 再起動での復元 → 描画に渡す設定）。
// 画面側（MeterScreen）と同じ手順で、構成のストアに純粋関数を適用して確かめる。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moduleRegistry } from "../modules";
import { columnStep } from "../modules/gram/gram_math";
import { waveLayout } from "../modules/wave/wave_math";
import type { WaveOptions } from "../modules/options";
import { SAVE_DELAY_MS, createConfigStore, type ConfigPersistence, type ConfigStore } from "./config_store";
import { SPEED_MAX, SPEED_MIN, setInstanceOption, setPaletteId, setSpeed } from "./instance_settings";
import { createDefaultState, normalizeState } from "./persisted_state";
import type { Instance, PersistedState } from "./types";

function counter(prefix: string): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

function defaultState(): PersistedState {
  const state = createDefaultState({
    registry: moduleRegistry,
    defaultName: "既定",
    now: () => new Date("2026-11-08T07:00:00.000Z"),
    newConfigId: counter("c"),
    newInstanceId: counter("i"),
  });
  // 同じ種類のインスタンスを2つにする（片方だけ変わることを確かめるため）
  const wave = state.current.layout.instances.find((i) => i.kind === "wave")!;
  state.current.layout.instances.push({ ...structuredClone(wave), id: "wave-2" });
  return state;
}

/** ディスクの代わり。保存は JSON にして持ち、読み込みは JSON から作り直す（Rust の保存と同じ往復） */
function fakeDisk(initial: PersistedState | null = null) {
  let file: string | null = initial ? JSON.stringify(initial) : null;
  const persistence: ConfigPersistence = {
    load: () => Promise.resolve(file ? (JSON.parse(file) as PersistedState) : null),
    save: (state) => {
      file = JSON.stringify(state);
      return Promise.resolve();
    },
  };
  return { persistence, writes: () => file };
}

function openStore(persistence: ConfigPersistence): ConfigStore {
  return createConfigStore({
    persistence,
    createDefault: defaultState,
    normalize: (s) => normalizeState(s, moduleRegistry),
  });
}

function instances(store: ConfigStore): readonly Instance[] {
  return store.current.value.layout.instances;
}

function byId(store: ConfigStore, id: string): Instance {
  return instances(store).find((i) => i.id === id)!;
}

/** MeterScreen の changePalette / changeSpeed / changeOption と同じ手順 */
function apply(store: ConfigStore, change: (list: Instance[]) => Instance[] | null): void {
  if (!change(instances(store) as Instance[])) return;
  store.updateCurrent((draft) => {
    const next = change(draft.layout.instances);
    if (next) draft.layout.instances = next;
  });
}

function waveOptions(store: ConfigStore, id: string): WaveOptions {
  return byId(store, id).options as WaveOptions;
}

describe("インスタンスの設定を変えたとき（W6-2）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function start() {
    const disk = fakeDisk(defaultState());
    const store = openStore(disk.persistence);
    await store.restore();
    const waveId = instances(store).find((i) => i.kind === "wave" && i.id !== "wave-2")!.id;
    return { disk, store, waveId };
  }

  it("配色・速さ・種類ごとの項目は、そのインスタンスだけに反映され、同じ種類のほかのインスタンスと別の種類は変わらない", async () => {
    const { store, waveId } = await start();
    const before = structuredClone(instances(store)) as Instance[];

    apply(store, (list) => setPaletteId(list, waveId, "preset.c"));
    apply(store, (list) => setSpeed(list, waveId, 2));
    apply(store, (list) => setInstanceOption(list, waveId, "split", 40));
    apply(store, (list) => setInstanceOption(list, waveId, "channel", "mono"));
    apply(store, (list) => setInstanceOption(list, waveId, "showNow", false));
    apply(store, (list) => setInstanceOption(list, waveId, "histColor", "bands"));

    expect(byId(store, waveId).paletteId).toBe("preset.c");
    expect(waveOptions(store, waveId)).toEqual({ channel: "mono", showNow: false, split: 40, histColor: "bands", speed: 2 });
    // 同じ種類のもう1つと、ほかの種類は、そっくり変わらない
    expect(instances(store).filter((i) => i.id !== waveId)).toEqual(before.filter((i) => i.id !== waveId));
    expect(byId(store, "wave-2").options).toEqual({ channel: "stereo", showNow: true, split: 72, histColor: "solid", speed: 1 });
  });

  it("スペクトラム・位相の項目も、それぞれのインスタンスだけを変える。持たない項目は書かない", async () => {
    const { store } = await start();
    const spec = instances(store).find((i) => i.kind === "spec")!;
    const stereo = instances(store).find((i) => i.kind === "stereo" && !i.slot)!;
    const pan = instances(store).find((i) => i.slot === "pan")!;
    const before = structuredClone(instances(store)) as Instance[];

    apply(store, (list) => setInstanceOption(list, spec.id, "mode", "radial"));
    apply(store, (list) => setInstanceOption(list, spec.id, "ghost", false));
    apply(store, (list) => setInstanceOption(list, stereo.id, "dots", "size"));
    // 周波数別の定位のほうの「モーションブラー」は、通常の位相には及ばない
    apply(store, (list) => setInstanceOption(list, pan.id, "blur", false));
    // その種類が持たない項目は、書かない（変更なし）
    const dirtyBefore = store.state.value;
    apply(store, (list) => setInstanceOption(list, spec.id, "split", 10));
    expect(store.state.value).toBe(dirtyBefore);

    expect(byId(store, spec.id).options).toEqual({ mode: "radial", ghost: false });
    expect(byId(store, stereo.id).options).toEqual({ ...stereo.options, dots: "size" });
    expect(byId(store, pan.id).options).toEqual({ ...pan.options, blur: false });
    const touched = new Set([spec.id, stereo.id, pan.id]);
    expect(instances(store).filter((i) => !touched.has(i.id))).toEqual(before.filter((i) => !touched.has(i.id)));
  });

  it("流れる速さは ×0.25〜×3.00・0.05刻みで変わり、範囲の外は端に収まる。描画に渡す幅は速さに比例する", async () => {
    const { store, waveId } = await start();
    const gramId = instances(store).find((i) => i.kind === "gram")!.id;

    for (const [input, expected] of [
      [0.25, 0.25],
      [3, 3],
      [1.5, 1.5],
      [1.52, 1.5],
      [0.01, SPEED_MIN],
      [99, SPEED_MAX],
    ] as const) {
      apply(store, (list) => setSpeed(list, waveId, input));
      apply(store, (list) => setSpeed(list, gramId, input));
      expect(waveOptions(store, waveId).speed, `wave ${input}`).toBe(expected);
      expect((byId(store, gramId).options as { speed: number }).speed, `gram ${input}`).toBe(expected);
    }

    // 描画側が受け取る設定から出る幅（波形の履歴の1行、スペクトログラムの1列）：×0.25 で最小、×3.00 で最大
    apply(store, (list) => setSpeed(list, waveId, SPEED_MIN));
    apply(store, (list) => setSpeed(list, gramId, SPEED_MIN));
    const slow = [waveLayout(1000, waveOptions(store, waveId)).step, columnStep((byId(store, gramId).options as { speed: number }).speed)];
    apply(store, (list) => setSpeed(list, waveId, 1));
    apply(store, (list) => setSpeed(list, gramId, 1));
    const normal = [waveLayout(1000, waveOptions(store, waveId)).step, columnStep((byId(store, gramId).options as { speed: number }).speed)];
    apply(store, (list) => setSpeed(list, waveId, SPEED_MAX));
    apply(store, (list) => setSpeed(list, gramId, SPEED_MAX));
    const fast = [waveLayout(1000, waveOptions(store, waveId)).step, columnStep((byId(store, gramId).options as { speed: number }).speed)];
    expect(slow).toEqual([1, 1]);
    expect(normal).toEqual([4, 2]);
    expect(fast).toEqual([12, 6]);
    // もう1つの波形は、その間ずっと ×1.00 のまま
    expect(waveOptions(store, "wave-2").speed).toBe(1);
  });

  it("変更は間を置いて保存され、再起動（保存した内容の読み直し）でも引き継がれる", async () => {
    const { disk, store, waveId } = await start();
    apply(store, (list) => setPaletteId(list, waveId, "preset.b"));
    apply(store, (list) => setSpeed(list, waveId, 2.75));
    apply(store, (list) => setInstanceOption(list, waveId, "split", 33));
    expect(store.dirty.value).toBe(true);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY_MS);
    store.dispose();

    const reopened = openStore(disk.persistence);
    expect(await reopened.restore()).toBe("restored");
    const wave = byId(reopened, waveId);
    expect(wave.paletteId).toBe("preset.b");
    expect(wave.options).toEqual({ channel: "stereo", showNow: true, split: 33, histColor: "solid", speed: 2.75 });
    // 同じ種類のもう1つは既定のまま
    expect(byId(reopened, "wave-2").paletteId).toBe("preset.a");
    expect(byId(reopened, "wave-2").options).toEqual({ channel: "stereo", showNow: true, split: 72, histColor: "solid", speed: 1 });
    expect(reopened.dirty.value).toBe(true);
    reopened.dispose();
  });

  it("保存を待たずにウィンドウを閉じても（flush）、最後の変更が残る", async () => {
    const { disk, store, waveId } = await start();
    apply(store, (list) => setSpeed(list, waveId, 0.5));
    await store.flush();
    store.dispose();

    const reopened = openStore(disk.persistence);
    await reopened.restore();
    expect(waveOptions(reopened, waveId).speed).toBe(0.5);
    reopened.dispose();
  });

  it("すでに同じ値のとき（丸めると同じ・同じ配色）は書かず、「保存後に変更あり」にもならない", async () => {
    const { store, waveId } = await start();
    const state = store.state.value;
    apply(store, (list) => setSpeed(list, waveId, 1.01));
    apply(store, (list) => setPaletteId(list, waveId, "preset.a"));
    apply(store, (list) => setInstanceOption(list, waveId, "split", 72));
    expect(store.state.value).toBe(state);
    expect(store.dirty.value).toBe(false);
  });
});
