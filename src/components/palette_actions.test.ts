import { describe, expect, it } from "vitest";
import { createRuntimeStore, type RuntimeStore } from "../app/runtime_store";
import { createConfigStore, type ConfigStore } from "../config/config_store";
import { DEFAULT_PALETTE_ID, PRESET_PALETTES, presetDarkColors } from "../config/palettes";
import { createDefaultState } from "../config/persisted_state";
import { moduleRegistry } from "../modules";
import { createPaletteActions, type PaletteActions } from "./palette_actions";

interface Setup {
  config: ConfigStore;
  runtime: RuntimeStore;
  actions: PaletteActions;
}

function setup(): Setup {
  const config = createConfigStore({
    persistence: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    createDefault: () => createDefaultState({ registry: moduleRegistry, defaultName: "既定" }),
  });
  const runtime = createRuntimeStore();
  let n = 0;
  const actions = createPaletteActions({
    config,
    runtime,
    names: { fresh: (k) => `マイ配色 ${k}`, copy: (name) => `${name}のコピー`, preset: (p) => p.labelKey },
    newId: () => `custom.p${++n}`,
  });
  return { config, runtime, actions };
}

const palettes = (s: Setup) => s.config.current.value.customPalettes;

describe("createPaletteActions", () => {
  it("作る：既定の配色（マゼンタ主）のダーク用の値で「マイ配色 n」を足し、編集中にする。「保存後に変更あり」になる", () => {
    const s = setup();
    s.actions.create();
    s.actions.create();
    const magenta = presetDarkColors(PRESET_PALETTES[0]);
    expect(palettes(s)).toEqual([
      { id: "custom.p1", name: "マイ配色 1", ...magenta },
      { id: "custom.p2", name: "マイ配色 2", ...magenta },
    ]);
    expect(s.runtime.editingPaletteId.value).toBe("custom.p2");
    expect(s.config.dirty.value).toBe(true);
    // どのインスタンスもまだ使っていない（imple 5.2 の10）
    expect(s.config.current.value.layout.instances.every((i) => i.paletteId === DEFAULT_PALETTE_ID)).toBe(true);
  });

  it("複製：標準の配色はトークンのダークの値、自分で作った配色はその値を写し、「{name}のコピー」として編集中にする", () => {
    const s = setup();
    s.actions.duplicate("preset.b");
    expect(palettes(s)[0]).toEqual({ id: "custom.p1", name: "palette.preset_cyanのコピー", ...presetDarkColors(PRESET_PALETTES[1]) });

    s.actions.update("custom.p1", { name: "夜明け", accent: "#ffd23d" });
    s.actions.duplicate("custom.p1");
    expect(palettes(s)[1]).toEqual({ ...palettes(s)[0], id: "custom.p2", name: "夜明けのコピー" });
    expect(s.runtime.editingPaletteId.value).toBe("custom.p2");

    // ないIDは何もしない
    s.actions.duplicate("custom.none");
    expect(palettes(s)).toHaveLength(2);
  });

  it("編集：名前と色を変える。変わらないときは書かない", () => {
    const s = setup();
    s.actions.create();
    s.actions.update("custom.p1", { main: "#B7FF3C" });
    expect(palettes(s)[0].main).toBe("#b7ff3c");

    const before = s.config.state.value;
    s.actions.update("custom.p1", { main: "#b7ff3c", name: " " });
    expect(s.config.state.value).toBe(before);
  });

  it("削除：使っていたインスタンスは既定の配色に戻し（W7-4）、編集中なら編集をやめる", () => {
    const s = setup();
    s.actions.create();
    s.actions.create();
    const target = s.config.current.value.layout.instances[1].id;
    s.config.updateCurrent((draft) => {
      draft.layout.instances[1].paletteId = "custom.p2";
      draft.layout.instances[2].paletteId = "custom.p1";
    });
    s.actions.remove("custom.p2");
    expect(palettes(s).map((p) => p.id)).toEqual(["custom.p1"]);
    const instances = s.config.current.value.layout.instances;
    expect(instances.find((i) => i.id === target)!.paletteId).toBe(DEFAULT_PALETTE_ID);
    expect(instances[2].paletteId).toBe("custom.p1");
    expect(s.runtime.editingPaletteId.value).toBeNull();

    // 編集中でない配色を消しても、編集中のものはそのまま
    s.actions.create();
    s.actions.remove("custom.p1");
    expect(s.runtime.editingPaletteId.value).toBe("custom.p3");
  });

  it("インスタンスの設定の「＋ 配色を作る」：今の配色の値を写して作り、そのインスタンスに当てる。設定を閉じて、配色の管理を編集中で開く", () => {
    const s = setup();
    const [first, second] = s.config.current.value.layout.instances;
    s.config.updateCurrent((draft) => {
      draft.layout.instances[0].paletteId = "preset.c";
    });
    s.runtime.setLayoutEditing(true);
    s.runtime.openInstanceSettings(first.id);

    s.actions.createForInstance(first.id);
    expect(palettes(s)).toEqual([{ id: "custom.p1", name: "マイ配色 1", ...presetDarkColors(PRESET_PALETTES[2]) }]);
    const instances = s.config.current.value.layout.instances;
    expect(instances[0].paletteId).toBe("custom.p1");
    expect(instances[1].paletteId).toBe(second.paletteId);
    expect(s.runtime.editingPaletteId.value).toBe("custom.p1");
    expect(s.runtime.instanceSettingsOpen.value).toBe(false);
    expect(s.runtime.drawer.value).toBe("palettes");
    // 設定パネルから開いたのではないので、見出しのボタンは「閉じる」
    expect(s.runtime.drawerBack.value).toBeNull();
    // レイアウト編集は続ける
    expect(s.runtime.layoutEditing.value).toBe(true);

    // ないインスタンスは何もしない
    s.actions.createForInstance("none");
    expect(palettes(s)).toHaveLength(1);
  });
});
