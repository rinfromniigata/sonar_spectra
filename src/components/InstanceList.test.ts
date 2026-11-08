import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import { createDefaultInstances } from "../config/default_instances";
import type { Instance } from "../config/types";
import { i18n } from "../i18n";
import type { MessageKey } from "../i18n/use_t";
import ja from "../i18n/locales/ja";
import { moduleRegistry } from "../modules";
import InstanceList from "./InstanceList.vue";

// DOM のテスト環境がないため、SSR で組み立てた結果を確かめる（操作の中身は layout_edit_actions のテスト）
let n = 0;
const defaults = (): Instance[] => createDefaultInstances(moduleRegistry, () => `i${++n}`);

async function render(instances: readonly Instance[], selectedId: string | null = null, notice: MessageKey | null = null): Promise<string> {
  const app = createSSRApp({ render: () => h(InstanceList, { instances, registry: moduleRegistry, selectedId, notice }) });
  app.use(i18n);
  return renderToString(app);
}

/** 行ごとの、開きタグ（li）と中身 */
function rows(html: string): { tag: string; body: string }[] {
  return [...html.matchAll(/(<li[^>]*class="[^"]*mod-row[^"]*"[^>]*>)([\s\S]*?)<\/li>/g)].map((m) => ({ tag: m[1], body: m[2] }));
}

/** 行の名前のボタンの文言 */
const nameOf = (body: string) => /class="row-name[^"]*"[^>]*>\s*([^<]*?)\s*<\/button>/.exec(body)?.[1];

describe("InstanceList", () => {
  it("見出しの下に、置いたモジュールを構成の順に、名前と番号で並べる（無効なものも出す）", async () => {
    const instances = defaults();
    const html = await render(instances);
    expect(html).toContain(`>${ja.layout_edit.instances}</h3>`);
    const listed = rows(html).map((row) => nameOf(row.body));
    expect(listed).toHaveLength(instances.length);
    expect(listed).toContain(`${ja.modules.phase} 1`);
    expect(listed).toContain(`${ja.modules.phase} 2`);
    expect(listed[0]).toBe(`${ja.modules.level} 1`);
  });

  it("行ごとに複製・削除のボタンと、有効／無効のスイッチ（読み上げの名前は行の名前）を置く", async () => {
    const [level] = defaults();
    const [row] = rows(await render([level]));
    expect(row.body).toContain(`aria-label="${ja.common.duplicate}"`);
    expect(row.body).toContain(`aria-label="${ja.common.delete}"`);
    expect(row.body).toMatch(new RegExp(`role="switch"[^>]*aria-checked="true"[^>]*aria-label="${ja.modules.level} 1"`));
  });

  it("無効な行は薄くし、スイッチはオフ、名前のボタンは押せない（選べない）", async () => {
    const [level, wave] = defaults();
    const html = await render([level, { ...wave, enabled: false } as Instance]);
    const [on, off] = rows(html);
    expect(on.tag).not.toContain("is-off");
    expect(off.tag).toContain("is-off");
    expect(off.body).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(off.body).toMatch(/class="row-name[^"]*"[^>]*disabled/);
    expect(on.body).not.toMatch(/class="row-name[^"]*"[^>]*disabled/);
  });

  it("選んでいる行を強調する", async () => {
    const instances = defaults();
    const picked = rows(await render(instances, instances[2].id)).filter((row) => row.tag.includes("is-picked"));
    expect(picked).toHaveLength(1);
    expect(picked[0].tag).toContain('aria-current="true"');
    expect(nameOf(picked[0].body)).toBe(`${ja.modules.spectrum} 1`);
  });

  it("一覧の下に「＋ モジュールを追加」を置き、種類の一覧は押すまで閉じている", async () => {
    const html = await render(defaults());
    expect(html).toMatch(new RegExp(`aria-expanded="false"[^>]*>(?:<!--\\[-->)?\\s*${ja.layout_edit.add_module}`));
    expect(html).not.toContain(ja.module_shape.long);
    expect(html.indexOf(ja.layout_edit.add_module)).toBeGreaterThan(html.lastIndexOf("mod-row"));
  });

  it("お知らせがあれば、一覧の下に読み上げられる形で出す", async () => {
    expect(await render(defaults())).not.toContain('role="status"');
    const html = await render(defaults(), null, "layout_edit.no_space");
    expect(html).toMatch(new RegExp(`role="status"[^>]*>${ja.layout_edit.no_space}<`));
  });
});
