import { afterEach, describe, expect, it, vi } from "vitest";
import indexHtml from "../../index.html?raw";
import tokensCss from "./tokens.css?raw";
import { watchCanvasColors } from "./canvas_colors";
import { createDefaultConfig } from "../config/persisted_state";
import { moduleRegistry } from "../modules";

// W4-3：テーマを「OS設定」にすると、OS の設定の切り替えに追従する。初期値はダーク。
// 追従は2段で成り立つ：(1) data-theme を外したとき、tokens.css の prefers-color-scheme が OS に合わせて値を決める
// (2) OS の切り替えを watchCanvasColors が受けて、Canvas の色を読み直す

/** ブロックの宣言（`--x: 値;`）を、プロパティ名 → 値の表にする */
function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].replace(/\s*\/\*.*$/, "").trim();
  return out;
}

/** 色とテーマに関わる宣言だけ（タイポグラフィ・寸法は除く） */
function themeDeclarations(all: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith("--color-") || k === "color-scheme"));
}

function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("unbalanced");
}

const css = tokensCss.replace(/\/\*[\s\S]*?\*\//g, (c) => (c.includes("\n") ? "" : c));

describe("tokens.css：OS設定への追従", () => {
  const dark = themeDeclarations(declarations(block(css, ":root {")));
  const explicitLight = themeDeclarations(declarations(block(css, ':root[data-theme="light"]')));
  const mediaBlock = block(css, "@media (prefers-color-scheme: light)");
  const osLight = themeDeclarations(declarations(block(mediaBlock, ':root:not([data-theme="dark"])')));

  it("ダークが既定の値（color-scheme: dark）で、ライトの値と色の宣言の組が同じ", () => {
    expect(dark["color-scheme"]).toBe("dark");
    expect(Object.keys(dark).length).toBeGreaterThan(10);
    expect(Object.keys(explicitLight).sort()).toEqual(Object.keys(dark).sort());
  });

  it("OSがライトで data-theme がないとき（OS設定）の値は、明示的なライトと全く同じ", () => {
    expect(osLight).toEqual(explicitLight);
    expect(osLight["color-scheme"]).toBe("light");
  });

  it("OSのライトは、明示的なダーク（data-theme=dark）を上書きしない。ライトの媒体指定はダークの値を定義し直さない", () => {
    expect(mediaBlock).toContain(':root:not([data-theme="dark"])');
    // 追従のための媒体指定はライト用の1つだけ（OSがダークのときは、既定の値＝ダークがそのまま使われる）
    expect(css.match(/@media \(prefers-color-scheme/g)).toHaveLength(1);
  });

  it("ライトとダークで、色の値は少なくとも背景・文字・発光色が違う（同じ値の写し間違いがない）", () => {
    for (const key of ["--color-bg", "--color-text", "--color-neon-a", "--color-neon-b", "--color-neon-c", "--color-scanline"]) {
      expect(explicitLight[key], key).not.toBe(dark[key]);
    }
  });
});

describe("初期値はダーク", () => {
  it("既定の構成のテーマはダーク", () => {
    expect(createDefaultConfig(moduleRegistry).theme).toBe("dark");
  });

  it("復元までの間に表示されうる最初の画面も、ダーク（index.html の data-theme=dark）", () => {
    expect(indexHtml).toMatch(/<html[^>]*data-theme="dark"/);
  });
});

describe("watchCanvasColors：OSの切り替えで読み直す", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 文書・スタイル・OS設定・属性の見張りの代役 */
  function stubBrowser() {
    let osLight = false;
    let dataTheme: string | undefined;
    const mediaListeners = new Set<() => void>();
    const observers: { callback: () => void; connected: boolean }[] = [];
    const observedOptions: unknown[] = [];

    /** 今のテーマの値：data-theme があればそれ、なければ OS に従う（tokens.css と同じ規則） */
    const effective = () => (dataTheme ? dataTheme : osLight ? "light" : "dark");
    const root = { tag: "html" };
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("getComputedStyle", () => ({
      getPropertyValue: (property: string) => {
        if (property === "color-scheme") return effective();
        if (property === "--color-bg") return effective() === "light" ? "#f3f1fb" : "#07060f";
        return "x";
      },
    }));
    vi.stubGlobal(
      "MutationObserver",
      class {
        private entry: { callback: () => void; connected: boolean };
        constructor(callback: () => void) {
          this.entry = { callback, connected: false };
          observers.push(this.entry);
        }
        observe(_target: unknown, options: unknown) {
          observedOptions.push(options);
          this.entry.connected = true;
        }
        disconnect() {
          this.entry.connected = false;
        }
      },
    );
    vi.stubGlobal("matchMedia", (query: string) => {
      expect(query).toBe("(prefers-color-scheme: light)");
      return {
        addEventListener: (_: string, l: () => void) => mediaListeners.add(l),
        removeEventListener: (_: string, l: () => void) => mediaListeners.delete(l),
      };
    });
    return {
      /** OS の設定を切り替える */
      setOsLight(value: boolean) {
        osLight = value;
        mediaListeners.forEach((l) => l());
      },
      /** data-theme を付け外しする（設定パネルのテーマの切り替え） */
      setDataTheme(value: string | undefined) {
        dataTheme = value;
        observers.filter((o) => o.connected).forEach((o) => o.callback());
      },
      mediaListenerCount: () => mediaListeners.size,
      connectedObservers: () => observers.filter((o) => o.connected).length,
      observedOptions,
    };
  }

  it("OS設定（data-theme なし）のとき、OSがライト／ダークに切り替わるたびに、新しい色を読み直して知らせる", () => {
    const browser = stubBrowser();
    const seen: string[] = [];
    watchCanvasColors((colors) => seen.push(`${colors.theme}:${colors.bg}`));

    browser.setOsLight(true);
    browser.setOsLight(false);
    expect(seen).toEqual(["light:#f3f1fb", "dark:#07060f"]);
  });

  it("data-theme の付け外しでも読み直す。見張るのは data-theme の属性だけ", () => {
    const browser = stubBrowser();
    const seen: string[] = [];
    watchCanvasColors((colors) => seen.push(colors.theme));

    browser.setDataTheme("light");
    browser.setDataTheme("dark");
    browser.setDataTheme(undefined); // 「OS設定」に戻す（OSはダーク）
    expect(seen).toEqual(["light", "dark", "dark"]);
    expect(browser.observedOptions).toEqual([{ attributes: true, attributeFilter: ["data-theme"] }]);
  });

  it("「ライト」から「OS設定」に戻すと、OSの今の設定（ダーク）に従う。OSがライトならライトのまま", () => {
    const browser = stubBrowser();
    const seen: string[] = [];
    watchCanvasColors((colors) => seen.push(colors.theme));

    browser.setOsLight(true);
    browser.setDataTheme("dark"); // 明示的なダークは、OSがライトでもダーク
    browser.setDataTheme(undefined); // OS設定に戻す → OS はライト
    expect(seen).toEqual(["light", "dark", "light"]);
  });

  it("返す関数で見張りをやめると、それ以降は知らせない", () => {
    const browser = stubBrowser();
    const onChange = vi.fn();
    const stop = watchCanvasColors(onChange);
    expect(browser.mediaListenerCount()).toBe(1);
    expect(browser.connectedObservers()).toBe(1);

    stop();
    expect(browser.mediaListenerCount()).toBe(0);
    expect(browser.connectedObservers()).toBe(0);
    browser.setOsLight(true);
    browser.setDataTheme("light");
    expect(onChange).not.toHaveBeenCalled();
  });
});
