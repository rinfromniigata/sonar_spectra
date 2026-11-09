import { describe, expect, it } from "vitest";
import { createRuntimeStore } from "./runtime_store";

describe("createRuntimeStore", () => {
  it("初めは、入力源の状態なし・レイアウト編集中でない・ドロワーは閉じている・全画面でない", () => {
    const store = createRuntimeStore();
    expect(store.source.value).toBeNull();
    expect(store.layoutEditing.value).toBe(false);
    expect(store.drawer.value).toBeNull();
    expect(store.fullscreen.value).toBe(false);
  });

  it("ドロワーは1つだけ開き、別のものを開くと切り替わる。閉じると null", () => {
    const store = createRuntimeStore();
    store.openDrawer("settings");
    expect(store.drawer.value).toBe("settings");
    store.openDrawer("palettes");
    expect(store.drawer.value).toBe("palettes");
    store.closeDrawer();
    expect(store.drawer.value).toBeNull();
  });

  it("戻る先を付けて開くと、見出しのボタンでそのドロワーへ戻る。付けなければ閉じる。閉じると戻る先も消える", () => {
    const store = createRuntimeStore();
    expect(store.drawerBack.value).toBeNull();
    store.openDrawer("palettes", "settings");
    expect(store.drawerBack.value).toBe("settings");
    store.backDrawer();
    expect(store.drawer.value).toBe("settings");
    expect(store.drawerBack.value).toBeNull();

    store.openDrawer("palettes");
    store.backDrawer();
    expect(store.drawer.value).toBeNull();

    store.openDrawer("palettes", "settings");
    store.closeDrawer();
    expect(store.drawerBack.value).toBeNull();
  });

  it("構成の管理を開いたときの最初の操作は、取り出すと null に戻る", () => {
    const store = createRuntimeStore();
    expect(store.takeConfigIntent()).toBeNull();
    store.configIntent.value = { kind: "switch", id: "c-1" };
    expect(store.takeConfigIntent()).toEqual({ kind: "switch", id: "c-1" });
    expect(store.configIntent.value).toBeNull();
  });

  it("配色の管理で編集する配色は、初めはなく、選び直せる", () => {
    const store = createRuntimeStore();
    expect(store.editingPaletteId.value).toBeNull();
    store.editPalette("custom.a");
    expect(store.editingPaletteId.value).toBe("custom.a");
    store.editPalette(null);
    expect(store.editingPaletteId.value).toBeNull();
  });

  it("レイアウト編集中かどうかを切り替える", () => {
    const store = createRuntimeStore();
    store.setLayoutEditing(true);
    expect(store.layoutEditing.value).toBe(true);
    store.setLayoutEditing(false);
    expect(store.layoutEditing.value).toBe(false);
  });

  it("選んでいるインスタンスは初めはなく、編集を終えると外れる", () => {
    const store = createRuntimeStore();
    expect(store.selectedInstanceId.value).toBeNull();
    store.setLayoutEditing(true);
    store.selectInstance("a");
    expect(store.selectedInstanceId.value).toBe("a");
    store.setLayoutEditing(true);
    expect(store.selectedInstanceId.value).toBe("a");
    store.setLayoutEditing(false);
    expect(store.selectedInstanceId.value).toBeNull();
  });

  it("インスタンスの設定は初めは閉じている。開くとそのインスタンスを選び、選び直しても開いたまま。閉じる・編集を終えると閉じる", () => {
    const store = createRuntimeStore();
    expect(store.instanceSettingsOpen.value).toBe(false);
    store.setLayoutEditing(true);
    store.openInstanceSettings("a");
    expect(store.selectedInstanceId.value).toBe("a");
    expect(store.instanceSettingsOpen.value).toBe(true);
    store.selectInstance("b");
    expect(store.instanceSettingsOpen.value).toBe(true);
    store.closeInstanceSettings();
    expect(store.instanceSettingsOpen.value).toBe(false);
    // 閉じても選択は残る
    expect(store.selectedInstanceId.value).toBe("b");
    store.openInstanceSettings("b");
    store.setLayoutEditing(false);
    expect(store.instanceSettingsOpen.value).toBe(false);
  });
});
