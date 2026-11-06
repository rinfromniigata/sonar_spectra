// 子コンポーネントの根の要素には、親のスコープ付きCSSも当たる。そのため、親子で同じクラス名を使うと、
// 親のスタイルが子の根の要素にも当たってしまう（例：UiIconButton の .is-md（ボタンの大きさ）が、
// 中の UiIcon の svg にも当たり、アイコンがボタンいっぱいに広がっていた：W2-7 で見つけた不具合）。
// UiIcon の根のsvgが取りうるクラス名が、UiIcon を使うコンポーネントのスコープ付きCSSと重ならないことを検査する。
import { describe, expect, it } from "vitest";

// この部品のフォルダにある .vue のソースを、文字列として読む（コンポーネント名 → ソース）
const raw = import.meta.glob<string>("./*.vue", { query: "?raw", import: "default", eager: true });
const sources = new Map<string, string>(
  Object.entries(raw).map(([path, source]) => [path.replace(/^\.\//, "").replace(/\.vue$/, ""), source]),
);

/** 全部の一致を、型のはっきりした配列で返す（`regex` は g フラグつき） */
function allMatches(regex: RegExp, text: string): RegExpExecArray[] {
  const found: RegExpExecArray[] = [];
  for (let m = regex.exec(text); m !== null; m = regex.exec(text)) found.push(m);
  return found;
}

/** `<style scoped>` の中で、セレクタとして使われているクラス名 */
function scopedClasses(source: string): Set<string> {
  const style = /<style scoped[^>]*>([\s\S]*?)<\/style>/.exec(source)?.[1] ?? "";
  // コメントと宣言の中身（{ … }）を除き、セレクタの部分だけから取る
  const selectors = style.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{[^{}]*\}/g, "{}");
  return new Set(allMatches(/\.(-?[_a-zA-Z][\w-]*)/g, selectors).map((m) => m[1]));
}

/** テンプレートの中で、子として使っているコンポーネント（`<UiXxx` の形） */
function childrenOf(source: string): string[] {
  const template = /<template>([\s\S]*)<\/template>/.exec(source)?.[1] ?? "";
  return [...new Set(allMatches(/<(Ui[A-Za-z]+)[\s/>]/g, template).map((m) => m[1]))];
}

/** 根の要素に固定で付くクラス名（`class="…"`） */
function staticRootClasses(source: string): string[] {
  const template = /<template>([\s\S]*?)<\/template>/.exec(source)?.[1] ?? "";
  const attrs = /<[a-z][\w-]*([^>]*)>/.exec(template)?.[1] ?? "";
  return allMatches(/(?:^|\s)class="([^"]*)"/g, attrs).flatMap((m) => m[1].split(/\s+/).filter(Boolean));
}

describe("親子のコンポーネントのスコープ付きクラス名", () => {
  // UiIcon の根のsvgが取りうるクラス名：固定のクラスと、UiIcon 自身のスコープ付きCSSが定義するクラス（大きさなど）
  const iconSource = sources.get("UiIcon")!;
  const iconClasses = new Set([...staticRootClasses(iconSource), ...scopedClasses(iconSource)]);

  it("UiIcon の根のsvgのクラス名が、UiIcon を使うコンポーネントのスコープ付きCSSと重ならない", () => {
    const collisions: string[] = [];
    for (const [name, source] of sources) {
      if (name === "UiIcon" || !childrenOf(source).includes("UiIcon")) continue;
      for (const className of scopedClasses(source)) {
        if (iconClasses.has(className)) collisions.push(`${name}.vue の .${className} が、UiIcon のsvgにも当たる`);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("検査の仕組み：UiIcon のsvgが取りうるクラス名と、UiIconButton が UiIcon を使い .is-md を持つことを読み取れる", () => {
    expect([...iconClasses].sort()).toEqual(["ui-icon", "ui-icon-md", "ui-icon-sm"]);
    expect(childrenOf(sources.get("UiIconButton")!)).toContain("UiIcon");
    expect(scopedClasses(sources.get("UiIconButton")!)).toContain("is-md");
  });
});
