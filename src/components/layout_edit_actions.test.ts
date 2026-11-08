import { describe, expect, it } from "vitest";
import { createRuntimeStore } from "../app/runtime_store";
import { createConfigStore } from "../config/config_store";
import { createDefaultState } from "../config/persisted_state";
import type { Config, Instance } from "../config/types";
import { beginManual, NEW_INSTANCE_SIZES } from "../layout/manual";
import { moduleRegistry } from "../modules";
import { MODULE_KINDS } from "../modules/options";
import { addableKinds, createLayoutEditActions } from "./layout_edit_actions";

function setup(recipe?: (config: Config) => void) {
  let n = 0;
  const config = createConfigStore({
    persistence: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    // 準備の変更は既定の状態に直接入れる（「保存後に変更あり」にしない）
    createDefault: () => {
      const state = createDefaultState({ registry: moduleRegistry, defaultName: "既定", newInstanceId: () => `id${++n}` });
      recipe?.(state.current);
      return state;
    },
  });
  const runtime = createRuntimeStore();
  runtime.setLayoutEditing(true);
  let m = 0;
  const actions = createLayoutEditActions({ config, runtime, registry: moduleRegistry, newId: () => `new${++m}` });
  const instances = () => config.current.value.layout.instances;
  const find = (id: string) => instances().find((i) => i.id === id);
  const idOf = (kind: string) => instances().find((i) => i.kind === kind)!.id;
  return { config, runtime, actions, instances, find, idOf };
}

/** 既定の構成を 16:9 の自動整列で固定した手動配置（格子に空きがない） */
const pinned = (config: Config) => {
  config.layout = beginManual(config.layout, 16 / 9);
};

/** 手動配置で、レベルだけを左上に置き、ほかは無効にする（格子に空きがある） */
const roomy = (config: Config) => {
  config.layout = {
    mode: "manual",
    instances: config.layout.instances.map((i) => ({
      ...i,
      enabled: i.kind === "level",
      rect: i.kind === "level" ? { c: 1, r: 1, cs: 1, rs: 8 } : null,
    })) as Instance[],
  };
};

describe("addableKinds", () => {
  it("登録済みの種類を種類の並び順に、名前と推奨の形の説明の辞書キーで返す", () => {
    const kinds = addableKinds(moduleRegistry);
    expect(kinds.map((k) => k.kind)).toEqual(MODULE_KINDS.filter((kind) => moduleRegistry.has(kind)));
    expect(kinds.find((k) => k.kind === "spec")).toEqual({ kind: "spec", labelKey: "modules.spectrum", shapeKey: "module_shape.long" });
    expect(kinds.find((k) => k.kind === "loud")!.shapeKey).toBe("module_shape.compact");
    expect(kinds.find((k) => k.kind === "gram")!.shapeKey).toBe("module_shape.free");
  });
});

describe("追加", () => {
  it("自動配置では、末尾に有効で加え（位置は自動整列が決める）、選ぶ。「保存後に変更あり」になる", () => {
    const { config, runtime, actions, instances } = setup();
    actions.add("spec");
    const added = instances()[instances().length - 1];
    expect(added).toMatchObject({ id: "new1", kind: "spec", enabled: true, rect: null, direction: "up" });
    expect(added.options).toEqual(moduleRegistry.get("spec")!.defaultOptions);
    expect(config.current.value.layout.mode).toBe("auto");
    expect(runtime.selectedInstanceId.value).toBe("new1");
    expect(config.dirty.value).toBe(true);
    expect(actions.notice.value).toBeNull();
  });

  it("手動配置で空きがあれば、推奨の形の大きさで左上から探して置く", () => {
    const { actions, find } = setup(roomy);
    actions.add("loud");
    expect(find("new1")).toMatchObject({ enabled: true, rect: { c: 2, r: 1, ...NEW_INSTANCE_SIZES.compact } });
  });

  it("手動配置で空きがなければ、無効で加えてお知らせを出し、選ばない", () => {
    const { runtime, actions, find } = setup(pinned);
    actions.add("spec");
    expect(find("new1")).toMatchObject({ enabled: false, rect: null });
    expect(actions.notice.value).toBe("layout_edit.no_space");
    expect(runtime.selectedInstanceId.value).toBeNull();
  });
});

describe("複製", () => {
  it("自動配置では、複製元のすぐ後ろに加えて選ぶ", () => {
    const { runtime, actions, instances, idOf } = setup();
    const spec = idOf("spec");
    actions.duplicate(spec);
    const ids = instances().map((i) => i.id);
    expect(ids.indexOf("new1")).toBe(ids.indexOf(spec) + 1);
    expect(runtime.selectedInstanceId.value).toBe("new1");
  });

  it("手動配置で空きがなければ、無効で加えてお知らせを出す", () => {
    const { actions, find, idOf } = setup(pinned);
    actions.duplicate(idOf("spec"));
    expect(find("new1")).toMatchObject({ enabled: false, rect: null });
    expect(actions.notice.value).toBe("layout_edit.no_space");
  });

  it("無効なものの複製は無効のまま加え、お知らせは出さない", () => {
    const { actions, find, idOf } = setup((config) => {
      pinned(config);
      const spec = config.layout.instances.find((i) => i.kind === "spec")!;
      spec.enabled = false;
    });
    actions.duplicate(idOf("spec"));
    expect(find("new1")).toMatchObject({ enabled: false, rect: null });
    expect(actions.notice.value).toBeNull();
  });
});

describe("削除", () => {
  it("そのインスタンスだけを消し、手動配置ではほかの位置を変えない（空いたマスは残る）。選ばれていれば選択を外す", () => {
    const { config, runtime, actions, instances, idOf } = setup(pinned);
    const spec = idOf("spec");
    const before = instances().filter((i) => i.id !== spec);
    runtime.selectInstance(spec);
    actions.remove(spec);
    expect(instances()).toEqual(before);
    expect(runtime.selectedInstanceId.value).toBeNull();
    expect(config.current.value.layout.mode).toBe("manual");
  });

  it("種類の最後の1つも消せる。選ばれていないものを消しても選択は変えない", () => {
    const { runtime, actions, instances, idOf } = setup();
    runtime.selectInstance(idOf("spec"));
    actions.remove(idOf("loud"));
    expect(instances().some((i) => i.kind === "loud")).toBe(false);
    expect(runtime.selectedInstanceId.value).toBe(idOf("spec"));
  });
});

describe("有効／無効", () => {
  it("無効にしても手動配置の位置は残し、選ばれていれば選択を外す。有効に戻すと同じ位置に戻る", () => {
    const { runtime, actions, find, idOf } = setup(pinned);
    const spec = idOf("spec");
    const rect = find(spec)!.rect;
    runtime.selectInstance(spec);
    actions.setEnabled(spec, false);
    expect(find(spec)).toMatchObject({ enabled: false, rect });
    expect(runtime.selectedInstanceId.value).toBeNull();
    actions.setEnabled(spec, true);
    expect(find(spec)).toMatchObject({ enabled: true, rect });
    expect(actions.notice.value).toBeNull();
  });

  it("手動配置で空きがなく有効にできないときは、変えずにお知らせを出す", () => {
    const { actions, find, instances } = setup(pinned);
    actions.add("loud"); // 空きがないので無効で加わる
    const before = instances();
    actions.setEnabled("new1", true);
    expect(find("new1")!.enabled).toBe(false);
    expect(actions.notice.value).toBe("layout_edit.no_space");
    expect(instances()).toBe(before);
  });

  it("位置を持たない無効なものを手動配置で有効にするときは、推奨の形の大きさで置く", () => {
    const { actions, find, idOf } = setup(roomy);
    const loud = idOf("loud");
    actions.setEnabled(loud, true);
    expect(find(loud)).toMatchObject({ enabled: true, rect: { c: 2, r: 1, ...NEW_INSTANCE_SIZES.compact } });
  });

  it("自動配置では切り替えるだけ。次の操作でお知らせは消える", () => {
    const { actions, find, idOf } = setup();
    const spec = idOf("spec");
    actions.setEnabled(spec, false);
    expect(find(spec)).toMatchObject({ enabled: false, rect: null });
    actions.notice.value = "layout_edit.no_space";
    actions.setEnabled(spec, true);
    expect(find(spec)!.enabled).toBe(true);
    expect(actions.notice.value).toBeNull();
    actions.notice.value = "layout_edit.no_space";
    actions.clearNotice();
    expect(actions.notice.value).toBeNull();
  });
});
