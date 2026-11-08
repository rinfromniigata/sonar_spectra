import { describe, expect, it } from "vitest";
import { createConfigStore } from "../config/config_store";
import { createDefaultState } from "../config/persisted_state";
import type { PersistedState } from "../config/types";
import { moduleRegistry } from "../modules";
import { applyTheme, bindTheme, type ThemeRoot } from "./apply_theme";

function root(theme?: string): ThemeRoot {
  return { dataset: theme === undefined ? {} : { theme } };
}

function store(edit?: (state: PersistedState) => void) {
  return createConfigStore({
    persistence: { load: () => Promise.resolve(null), save: () => Promise.resolve() },
    createDefault: () => {
      const state = createDefaultState({ registry: moduleRegistry, defaultName: "既定" });
      edit?.(state);
      return state;
    },
  });
}

describe("applyTheme", () => {
  it("ダークとライトは data-theme にその値を付け、OS設定は外す（OS の設定に追従させる）", () => {
    const target = root("dark");
    applyTheme("light", target);
    expect(target.dataset.theme).toBe("light");
    applyTheme("system", target);
    expect("theme" in target.dataset).toBe(false);
    applyTheme("dark", target);
    expect(target.dataset.theme).toBe("dark");
  });
});

describe("bindTheme", () => {
  it("初期値はダーク。保存されたテーマは、すぐに反映する", () => {
    const fresh = root();
    bindTheme(store(), fresh);
    expect(fresh.dataset.theme).toBe("dark");

    const saved = root("dark");
    bindTheme(
      store((state) => {
        state.current.theme = "system";
      }),
      saved,
    );
    expect("theme" in saved.dataset).toBe(false);
  });

  it("構成のテーマを変えるたびに反映し直す。テーマ以外の変更では触らない", () => {
    const config = store();
    const target = root();
    const handle = bindTheme(config, target);
    config.updateCurrent((c) => {
      c.theme = "light";
    });
    expect(target.dataset.theme).toBe("light");

    target.dataset.theme = "marker";
    config.updateCurrent((c) => {
      c.display.scanline = false;
    });
    expect(target.dataset.theme).toBe("marker");

    config.updateCurrent((c) => {
      c.theme = "system";
    });
    expect("theme" in target.dataset).toBe(false);

    handle.stop();
    config.updateCurrent((c) => {
      c.theme = "dark";
    });
    expect("theme" in target.dataset).toBe(false);
  });
});
