import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import { createDefaultInstances } from "../config/default_instances";
import type { Instance } from "../config/types";
import { i18n } from "../i18n";
import ja from "../i18n/locales/ja";
import { autoArrange } from "../layout/auto_arrange";
import { findSplitters, pinAutoLayout } from "../layout/manual";
import { moduleRegistry } from "../modules";
import MeterGrid from "./MeterGrid.vue";

// DOM のテスト環境がないため、SSR で組み立てた結果を確かめる（ドラッグの計算は layout/edit_gesture のテスト）
let nextId = 0;
const defaults = (): Instance[] => createDefaultInstances(moduleRegistry, () => `i${++nextId}`);

type Props = InstanceType<typeof MeterGrid>["$props"];

async function render(props: Props): Promise<string> {
  const app = createSSRApp({ render: () => h(MeterGrid, props) });
  app.use(i18n);
  return renderToString(app);
}

const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

describe("MeterGrid", () => {
  it("編集中でなければ、境界線も右下の角もなく、モジュールにフォーカスしない", async () => {
    const instances = defaults();
    const html = await render({ instances, mode: "auto" });
    expect(count(html, /class="module-frame/g)).toBe(instances.filter((i) => i.enabled).length);
    expect(html).not.toContain('role="separator"');
    expect(html).not.toContain("resize-handle");
    expect(html).not.toContain("tabindex");
    expect(html).not.toContain("is-editing");
  });

  it("自動配置の編集中は、今の自動整列の結果を固定した配置の境界線を出す", async () => {
    const instances = defaults();
    const html = await render({ instances, mode: "auto", editing: true });
    const expected = findSplitters(pinAutoLayout(instances, autoArrange(instances, 16 / 9)));
    expect(expected.length).toBeGreaterThan(0);
    expect(count(html, /role="separator"/g)).toBe(expected.length);
    expect(count(html, new RegExp(`aria-label="${ja.layout_edit.splitter.replace(/[()（）]/g, ".")}"`, "g"))).toBe(expected.length);
    expect(count(html, /aria-orientation="vertical"/g)).toBe(expected.filter((s) => s.axis === "v").length);
  });

  it("編集中は、各モジュールにフォーカスでき、右下の角を持ち、選んでいるものを強調する", async () => {
    const instances = defaults();
    const selected = instances[2];
    const html = await render({ instances, mode: "auto", editing: true, selectedId: selected.id });
    const enabled = instances.filter((i) => i.enabled).length;
    expect(count(html, /tabindex="0"/g)).toBe(enabled + findSplitters(pinAutoLayout(instances, autoArrange(instances, 16 / 9))).length);
    expect(count(html, /class="resize-handle"/g)).toBe(enabled);
    expect(count(html, /is-selected/g)).toBe(1);
    expect(count(html, /aria-current="true"/g)).toBe(1);
    expect(html).toMatch(new RegExp(`class="module-frame is-editing is-selected"[^>]*data-kind="${selected.kind}"`));
  });

  it("手動配置では、各インスタンスの位置に置き、位置のないものと無効なものは置かない", async () => {
    const instances = defaults().map((instance, n) => ({
      ...instance,
      rect: n === 0 ? { c: 2, r: 3, cs: 4, rs: 5 } : n === 1 ? null : { c: 12, r: 8, cs: 1, rs: 1 },
      enabled: n !== 2,
    })) as Instance[];
    const html = await render({ instances, mode: "manual" });
    expect(html).toContain("grid-area:3 / 2 / span 5 / span 4");
    expect(count(html, /class="module-frame/g)).toBe(instances.filter((i, n) => n !== 1 && i.enabled).length);
  });
});
