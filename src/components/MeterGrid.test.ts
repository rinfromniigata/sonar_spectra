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

describe("MeterGrid の編集中の見出し", () => {
  const frames = (html: string) => [...html.matchAll(/data-kind="(\w+)"/g)].map((m) => m[1]);

  it("編集中は、置いたモジュールごとに見出しを出し、同じ種類は番号で見分ける（無効なものも数える）", async () => {
    const instances = defaults();
    const extra = { ...instances.find((i) => i.kind === "stereo" && i.slot === "pan")!, id: "extra" };
    const html = await render({ instances: [...instances, extra] as Instance[], mode: "auto", editing: true });
    expect(count(html, /class="edit-head"/g)).toBe(instances.filter((i) => i.enabled).length + 1);
    const names = [...html.matchAll(/class="name"[^>]*>([^<]*)</g)].map((m) => m[1]);
    // 位相は3つ（リサージュ1・周波数別の定位2・追加3）
    expect(names.filter((n) => n.startsWith(ja.modules.phase))).toEqual([`${ja.modules.phase} 1`, `${ja.modules.phase} 2`, `${ja.modules.phase} 3`]);
    expect(names).toContain(`${ja.modules.level} 1`);
    expect(frames(html).length).toBeGreaterThan(0);
  });

  it("編集中でなければ見出しを出さない", async () => {
    expect(await render({ instances: defaults(), mode: "auto" })).not.toContain("edit-head");
  });

  it("モジュールごとに、枠の形に合わせた適合判定のバッジを出す", async () => {
    const html = await render({ instances: defaults(), mode: "auto", editing: true });
    const results = [...html.matchAll(/data-fit="(\w+)"/g)].map((m) => m[1]);
    expect(results).toHaveLength(defaults().filter((i) => i.enabled).length);
    expect(results.every((r) => ["good", "warn_short", "warn_axis", "warn_long", "warn_tall"].includes(r))).toBe(true);
  });

  it("手動配置では、置いた位置の縦横比で判定する（スペクトラムを縦長に置くと、向きと枠が逆）", async () => {
    const spec = { ...defaults().find((i) => i.kind === "spec")!, rect: { c: 1, r: 1, cs: 2, rs: 8 }, direction: "up" } as Instance;
    const html = await render({ instances: [spec], mode: "manual", editing: true });
    expect(html).toContain('data-fit="warn_axis"');
    const wide = { ...spec, rect: { c: 1, r: 1, cs: 12, rs: 3 } } as Instance;
    expect(await render({ instances: [wide], mode: "manual", editing: true })).toContain('data-fit="good"');
  });
});

describe("MeterGrid の編集を終えたときの見え方（S03a）", () => {
  const holeAreas = (html: string) => [...html.matchAll(/class="hole"[^>]*style="grid-area:([^";]+)/g)].map((m) => m[1].trim());

  it("格子が埋まっていれば、空きを塗るものは出さない", async () => {
    expect(await render({ instances: defaults(), mode: "auto" })).not.toContain('class="hole"');
    const full = { ...defaults().find((i) => i.kind === "spec")!, rect: { c: 1, r: 1, cs: 12, rs: 8 } } as Instance;
    expect(await render({ instances: [full], mode: "manual" })).not.toContain('class="hole"');
  });

  it("手動配置で空いたマスは、まとめた長方形ごとに背景色で塗る（置いたモジュールは変えない）", async () => {
    const spec = { ...defaults().find((i) => i.kind === "spec")!, rect: { c: 1, r: 1, cs: 6, rs: 4 } } as Instance;
    const html = await render({ instances: [spec], mode: "manual" });
    // 右上（7列〜・1〜4行）と、下の4行
    expect(holeAreas(html)).toEqual(["1 / 7 / span 4 / span 6", "5 / 1 / span 4 / span 12"]);
    expect(html).toContain("grid-area:1 / 1 / span 4 / span 6");
  });

  it("無効にしたモジュールの位置も空きとして塗る", async () => {
    const spec = { ...defaults().find((i) => i.kind === "spec")!, enabled: false, rect: { c: 1, r: 1, cs: 12, rs: 8 } } as Instance;
    expect(holeAreas(await render({ instances: [spec], mode: "manual" }))).toEqual(["1 / 1 / span 8 / span 12"]);
  });

  it("編集中は塗らない（格子の点を見せる）。編集の飾りも、終えれば残らない", async () => {
    const spec = { ...defaults().find((i) => i.kind === "spec")!, rect: { c: 1, r: 1, cs: 6, rs: 4 } } as Instance;
    const editing = await render({ instances: [spec], mode: "manual", editing: true, selectedId: spec.id });
    expect(editing).not.toContain('class="hole"');
    expect(editing).toContain("edit-head");
    const done = await render({ instances: [spec], mode: "manual", editing: false, selectedId: spec.id });
    for (const leftover of ["edit-head", "resize-handle", 'role="separator"', "is-editing", "is-selected", "tabindex", "aria-current"]) {
      expect(done, leftover).not.toContain(leftover);
    }
  });
});
