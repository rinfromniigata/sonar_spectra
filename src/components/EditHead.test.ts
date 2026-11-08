import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import { createDefaultInstances } from "../config/default_instances";
import type { Instance } from "../config/types";
import { i18n } from "../i18n";
import ja from "../i18n/locales/ja";
import { moduleRegistry } from "../modules";
import type { ModuleKind } from "../modules/options";
import type { AnyModuleDefinition } from "../modules/types";
import EditHead from "./EditHead.vue";

const instances = createDefaultInstances(moduleRegistry, () => "x");
const instanceOf = (kind: ModuleKind, extra: object = {}): Instance => ({ ...instances.find((i) => i.kind === kind)!, ...extra }) as Instance;

async function render(instance: Instance, size: { width: number; height: number }, number = 1): Promise<string> {
  const definition = moduleRegistry.get(instance.kind) as AnyModuleDefinition;
  const app = createSSRApp({ render: () => h(EditHead, { instance, definition, number, size }) });
  app.use(i18n);
  return renderToString(app);
}

const fitOf = (html: string) => /data-fit="(\w+)"[^>]*>([^<]*)</.exec(html)?.slice(1) ?? [];
const pressedArrows = (html: string) => [...html.matchAll(/aria-pressed="true"[^>]*aria-label="([^"]*)"/g)].map((m) => m[1]);

describe("EditHead", () => {
  it("つまみ・名前と番号・適合判定のバッジ・方向の矢印を、この順に置く", async () => {
    const html = await render(instanceOf("spec"), { width: 400, height: 150 }, 2);
    const order = ["grip", ja.modules.spectrum + " 2", 'data-fit="', "dirs"].map((text) => html.indexOf(text));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("適合判定の結果を、辞書の文言で出す（適／もっと細長く／向きと枠が逆／もっと正方形に／もっと縦長に）", async () => {
    expect(fitOf(await render(instanceOf("spec"), { width: 400, height: 150 }))).toEqual(["good", ja.shape_fit.good]);
    expect(fitOf(await render(instanceOf("spec"), { width: 100, height: 100 }))).toEqual(["warn_short", ja.shape_fit.warn_short]);
    expect(fitOf(await render(instanceOf("spec"), { width: 100, height: 400 }))).toEqual(["warn_axis", ja.shape_fit.warn_axis]);
    expect(fitOf(await render(instanceOf("loud"), { width: 600, height: 100 }))).toEqual(["warn_long", ja.shape_fit.warn_long]);
    const pan = instanceOf("stereo", { options: { mode: "pan", dots: "both", blur: true } });
    expect(fitOf(await render(pan, { width: 300, height: 300 }))).toEqual(["warn_tall", ja.shape_fit.warn_tall]);
  });

  it("流れる方向を変えると、判定も変わる（波形は左右に流れるなら横長が適）", async () => {
    const size = { width: 400, height: 100 };
    expect(fitOf(await render(instanceOf("wave", { direction: "left" }), size))[0]).toBe("good");
    expect(fitOf(await render(instanceOf("wave", { direction: "up" }), size))[0]).toBe("warn_axis");
  });

  it("適合は副色、それ以外は注意色のバッジにする", async () => {
    const classesOf = (html: string) => /<span class="([^"]*fit[^"]*)"/.exec(html)?.[1].split(" ").sort();
    expect(classesOf(await render(instanceOf("spec"), { width: 400, height: 150 }))).toEqual(["fit", "is-good"]);
    expect(classesOf(await render(instanceOf("spec"), { width: 100, height: 100 }))).toEqual(["fit", "is-warn"]);
  });

  it("方向の矢印は4つで、今の向きが押された状態。読み上げの名前は辞書から引く。ドラッグを始めないよう印を付ける", async () => {
    const html = await render(instanceOf("spec", { direction: "right" }), { width: 400, height: 150 });
    expect(html).toContain("data-no-drag");
    expect(html).toContain(`aria-label="${ja.instance.direction.label}"`);
    for (const label of [ja.instance.direction.up, ja.instance.direction.right, ja.instance.direction.down, ja.instance.direction.left]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(["↑", "→", "↓", "←"].every((arrow) => html.includes(arrow))).toBe(true);
    expect(pressedArrows(html)).toEqual([ja.instance.direction.right]);
  });

  it("名前とバッジには、狭い枠で「…」に切り詰められても全文を読めるよう title を付ける", async () => {
    const html = await render(instanceOf("spec"), { width: 100, height: 100 }, 2);
    expect(html).toContain(`class="name" title="${ja.modules.spectrum} 2"`);
    expect(html).toMatch(new RegExp(`data-fit="warn_short" title="${ja.shape_fit.warn_short}"`));
  });

  it("方向のないモジュール（LOUDなど）には矢印を出さない", async () => {
    const html = await render(instanceOf("loud"), { width: 150, height: 150 });
    expect(html).not.toContain("dirs");
    expect(html).not.toContain("dir-button");
  });
});
