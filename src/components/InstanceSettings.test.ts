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

/** 種類ごとの項目：data-field 付きの要素（項目の key の並び） */
function fieldKeys(html: string): string[] {
  return [...html.matchAll(/data-field="(\w+)"/g)].map((m) => m[1]);
}

/** 押された状態のセグメント（グループの読み上げ名ごと） */
function pressed(html: string, groupLabel: string): string | null {
  const group = new RegExp(`<div class="ui-segmented[^"]*" role="group" aria-label="${groupLabel}"[^>]*>([\\s\\S]*?)</div>`).exec(html);
  if (!group) return null;
  const on = /aria-pressed="true"[^>]*>([^<]*)/.exec(group[1]);
  return on ? on[1].trim() : null;
}

describe("InstanceSettings の種類ごとの項目", () => {
  it("波形：速さ → 履歴の色 → チャンネル → 今の波形 → 境目の順。既定は単色・ステレオ・オン・72%", async () => {
    const html = await render(instanceOf("wave"));
    expect(fieldKeys(html)).toEqual(["histColor", "channel", "showNow", "split"]);
    expect(html.indexOf(`>${ja.instance.speed}<`)).toBeLessThan(html.indexOf('data-field="histColor"'));
    expect(pressed(html, ja.instance.waveform.history_color)).toBe(ja.instance.waveform.history_color_solid);
    expect(pressed(html, ja.instance.waveform.channel)).toBe(ja.instance.waveform.channel_stereo);
    // 選んでいる選択肢の注記
    expect(html).toContain(`>${ja.instance.waveform.channel_note_stereo}<`);
    expect(html).not.toContain(ja.instance.waveform.channel_note_mono);
    // スイッチとスライダー（境目は 10〜90、値は割合、注記に既定の 72%）
    expect(html).toMatch(new RegExp(`role="switch"[^>]*aria-checked="true"[^>]*aria-label="${ja.instance.waveform.show_now}"`));
    const split = /<input[^>]*aria-label="履歴と今の波形の境目"[^>]*>/.exec(html)![0];
    expect(split).toContain('min="10"');
    expect(split).toContain('max="90"');
    expect(split).toContain('value="72"');
    expect(split).toContain('aria-valuetext="72%"');
    expect(html).toContain(`>${ja.instance.waveform.split_note.replace("{value}", "72%")}<`);
  });

  it("波形：モノラル・帯域別の設定を反映し、今の波形をオフにすると境目を隠す", async () => {
    const wave = instanceOf("wave");
    const options = { ...wave.options, channel: "mono", histColor: "bands", split: 40 };
    const html = await render({ ...wave, options } as Instance);
    expect(pressed(html, ja.instance.waveform.channel)).toBe(ja.instance.waveform.channel_mono);
    expect(pressed(html, ja.instance.waveform.history_color)).toBe(ja.instance.waveform.history_color_bands);
    expect(html).toContain(`>${ja.instance.waveform.channel_note_mono}<`);
    expect(html).toContain('aria-valuetext="40%"');

    const off = await render({ ...wave, options: { ...wave.options, showNow: false } } as Instance);
    expect(fieldKeys(off)).toEqual(["histColor", "channel", "showNow"]);
    expect(off).toMatch(new RegExp(`role="switch"[^>]*aria-checked="false"[^>]*aria-label="${ja.instance.waveform.show_now}"`));
  });

  it("スペクトラム：表示方式の4つと、ピークの残像のスイッチ（既定は線＋塗り・オン）", async () => {
    const html = await render(instanceOf("spec"));
    expect(fieldKeys(html)).toEqual(["mode", "ghost"]);
    for (const label of [ja.instance.spectrum.mode_fill, ja.instance.spectrum.mode_bars, ja.instance.spectrum.mode_mirror, ja.instance.spectrum.mode_radial]) {
      expect(html).toContain(label);
    }
    expect(pressed(html, ja.instance.spectrum.mode)).toBe(ja.instance.spectrum.mode_fill);
    expect(html).toMatch(new RegExp(`role="switch"[^>]*aria-checked="true"[^>]*aria-label="${ja.instance.spectrum.peak_ghost}"`));
    // 流れる速さは出さない
    expect(html).not.toContain('type="range"');
  });

  it("位相：リサージュには点描、周波数別の定位にはモーションブラーを出す。表示方式ごとの注記つき", async () => {
    const lissajous = await render(instanceOf("stereo"));
    expect(fieldKeys(lissajous)).toEqual(["mode", "dots"]);
    expect(pressed(lissajous, ja.instance.phase.dots)).toBe(ja.instance.phase.dots_both);
    expect(lissajous).toContain(`>${ja.instance.phase.mode_note_lissajous}<`);

    const stereo = instanceOf("stereo");
    const pan = await render({ ...stereo, options: { ...stereo.options, mode: "pan", blur: false } } as Instance);
    expect(fieldKeys(pan)).toEqual(["mode", "blur"]);
    expect(pan).toMatch(new RegExp(`role="switch"[^>]*aria-checked="false"[^>]*aria-label="${ja.instance.phase.motion_blur}"`));
    expect(pan).toContain(`>${ja.instance.phase.mode_note_pan}<`);
    expect(pan).not.toContain(ja.instance.phase.dots_size);
  });

  it("設定のない種類（レベル・ラウドネス）と、速さだけのスペクトログラムは、種類ごとの項目を出さない", async () => {
    for (const kind of ["level", "loud", "gram"] as const) {
      expect(fieldKeys(await render(instanceOf(kind)))).toEqual([]);
    }
  });
});

describe("InstanceSettings の「既定に戻す」", () => {
  /** 「既定に戻す」のボタンの開きタグ */
  function resetButton(html: string): string {
    const text = html.indexOf(ja.common.reset_default);
    const start = html.lastIndexOf("<button", text);
    if (text < 0 || start < 0) throw new Error("reset button not found");
    return html.slice(start, html.indexOf(">", start) + 1);
  }

  it("見出しの横に置き、方向・配色・設定がすべて既定のままなら押せない", async () => {
    const html = await render(instanceOf("wave"));
    expect(resetButton(html)).toContain("disabled");
    expect(html.indexOf(ja.common.reset_default)).toBeGreaterThan(html.indexOf("選択中："));
    expect(html.indexOf(ja.common.reset_default)).toBeLessThan(html.indexOf(`>${ja.instance.source}<`));
  });

  it("配色・方向・設定のどれかが既定と違えば押せる", async () => {
    const wave = instanceOf("wave");
    expect(resetButton(await render({ ...wave, paletteId: "preset.c" }))).not.toContain("disabled");
    expect(resetButton(await render({ ...wave, direction: "up" } as Instance))).not.toContain("disabled");
    expect(resetButton(await render({ ...wave, options: { ...wave.options, speed: 2 } } as Instance))).not.toContain("disabled");
  });
});
