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
import InstanceSettings from "./InstanceSettings.vue";

function instanceOf(kind: ModuleKind, patch: Partial<Instance> = {}): Instance {
  let n = 0;
  const instance = createDefaultInstances(moduleRegistry, () => `i${++n}`).find((i) => i.kind === kind)!;
  return { ...instance, ...patch } as Instance;
}

async function render(instance: Instance, name = "波形 2"): Promise<string> {
  const definition = moduleRegistry.get(instance.kind) as AnyModuleDefinition;
  const app = createSSRApp({ render: () => h(InstanceSettings, { instance, definition, name }) });
  app.use(i18n);
  return renderToString(app);
}

/** 配色の見本（名前と押された状態） */
function swatches(html: string): { name: string; pressed: boolean }[] {
  return [...html.matchAll(/<button[^>]*class="ui-palette-swatch[^"]*"[^>]*aria-pressed="(true|false)"[\s\S]*?<span class="name"[^>]*>([^<]*)<\/span>/g)].map(
    (m) => ({ name: m[2], pressed: m[1] === "true" }),
  );
}

describe("InstanceSettings", () => {
  it("見出し（選択中：名前と番号）→ 入力源 → 配色 → 流れる速さの順に並べる", async () => {
    const html = await render(instanceOf("wave"));
    const order = [
      html.indexOf(`>${ja.layout_edit.selected.replace("{name}", "波形 2")}</h3>`),
      html.indexOf(`>${ja.instance.source}<`),
      html.indexOf(`>${ja.instance.palette}<`),
      html.indexOf(`>${ja.instance.speed}<`),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("入力源は既定の1系統だけを選んだセレクトと、注記を出す", async () => {
    const html = await render(instanceOf("spec"));
    const select = /<select[^>]*aria-label="([^"]*)"[^>]*>([\s\S]*?)<\/select>/.exec(html)!;
    expect(select[1]).toBe(ja.instance.source);
    const options = [...select[2].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)<\/option>/g)];
    expect(options.map((m) => [m[1], m[2].trim()])).toEqual([["default", ja.instance.source_default]]);
    expect(html).toContain(`>${ja.instance.source_note}<`);
  });

  it("配色は標準の3つの見本を出し、インスタンスの配色を押された状態にする。見本はラベルつきのグループに入る", async () => {
    expect(swatches(await render(instanceOf("spec")))).toEqual([
      { name: ja.palette.preset_magenta, pressed: true },
      { name: ja.palette.preset_cyan, pressed: false },
      { name: ja.palette.preset_amber, pressed: false },
    ]);
    expect(swatches(await render(instanceOf("spec", { paletteId: "preset.c" }))).map((s) => s.pressed)).toEqual([false, false, true]);

    const html = await render(instanceOf("spec"));
    const label = new RegExp(`<span id="([^"]+)" class="label"[^>]*>${ja.instance.palette}</span>`).exec(html)!;
    expect(html).toMatch(new RegExp(`role="group" aria-labelledby="${label[1]}"`));
  });

  it("流れる速さは、流れるモジュール（波形・スペクトログラム）だけに、×0.25〜×3.00・刻み0.05のスライダーで出す", async () => {
    const wave = await render(instanceOf("wave", { options: { channel: "stereo", showNow: true, split: 72, histColor: "solid", speed: 1.5 } } as Partial<Instance>));
    const range = /<input[^>]*type="range"[^>]*>/.exec(wave)![0];
    expect(range).toContain('min="0.25"');
    expect(range).toContain('max="3"');
    expect(range).toContain('step="0.05"');
    expect(range).toContain(`aria-label="${ja.instance.speed}"`);
    expect(range).toContain('value="1.5"');
    expect(range).toContain('aria-valuetext="×1.50"');

    expect(await render(instanceOf("gram"))).toContain('aria-valuetext="×1.00"');
    for (const kind of ["level", "spec", "stereo", "loud"] as const) {
      const html = await render(instanceOf(kind));
      expect(html).not.toContain('type="range"');
      expect(html).not.toContain(`>${ja.instance.speed}<`);
    }
  });
});
