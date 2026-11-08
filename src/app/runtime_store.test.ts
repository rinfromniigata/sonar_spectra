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

  it("レイアウト編集中かどうかを切り替える", () => {
    const store = createRuntimeStore();
    store.setLayoutEditing(true);
    expect(store.layoutEditing.value).toBe(true);
    store.setLayoutEditing(false);
    expect(store.layoutEditing.value).toBe(false);
  });
});
