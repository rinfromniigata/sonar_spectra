import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import { i18n } from "../i18n";
import type { SourceStatusEvent } from "../source";
import TitleBar from "./TitleBar.vue";

type Props = InstanceType<typeof TitleBar>["$props"];

async function render(props: Props): Promise<string> {
  const app = createSSRApp({ render: () => h(TitleBar, props) });
  app.use(i18n);
  return renderToString(app);
}

const live: SourceStatusEvent = {
  status: { state: "live" },
  device: { id: "id-1", name: "Speakers", isDefault: true },
};

/** ボタンの読み上げ用の名前（aria-label）を、並び順に */
const labels = (html: string) => [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);

describe("TitleBar", () => {
  it("ロゴタイプとバージョン、出力系統のチップ（状態とデバイス名）、3つのボタンを持つ", async () => {
    const html = await render({ version: "0.1.0", source: live });
    expect(html).toContain("SONAR");
    expect(html).toContain("SPECTRA");
    expect(html).toContain("v0.1.0");
    expect(html).toContain("出力音声 · Speakers");
    expect(html).toContain("is-live");
    // 読み上げ用の名前は、辞書から引いた文言（チップ・レイアウト編集・設定・ボーダレスフルスクリーン）
    expect(labels(html)).toEqual(["出力系統", "レイアウト編集", "設定", "ボーダレスフルスクリーン"]);
  });

  it("バージョンが空なら、バージョンの欄を出さない", async () => {
    expect(await render({ source: live })).not.toContain('class="version"');
  });

  it("状態が届く前は「入力源を開いています」、無音・使えないときはそれぞれの文言と色", async () => {
    expect(await render({ source: null })).toContain("入力源を開いています");
    const silent = await render({ source: { status: { state: "silent" }, device: live.device } });
    expect(silent).toContain("出力音声 · 無音");
    expect(silent).toContain("is-silent");
    const unavailable = await render({
      source: { status: { state: "unavailable", reason: "notFound" }, device: null },
    });
    expect(unavailable).toContain("入力源を開けません");
    expect(unavailable).toContain("is-unavailable");
  });

  it("レイアウト編集中はボタンが押された状態、全画面中は終了用の名前になる", async () => {
    const editing = await render({ source: live, layoutEditing: true });
    expect(editing).toMatch(/aria-label="レイアウト編集"[^>]*aria-pressed="true"/);
    const idle = await render({ source: live });
    expect(idle).toMatch(/aria-label="レイアウト編集"[^>]*aria-pressed="false"/);

    const full = await render({ source: live, fullscreen: true });
    expect(labels(full)).toEqual(["出力系統", "レイアウト編集", "設定", "ボーダレスフルスクリーンを終了"]);
  });

  it("macOS（S09）：信号機ボタンの分の余白を取る形になり、帯のボタン以外がつかみになる。チップは macOS の文言", async () => {
    const html = await render({ source: live, platform: "macos" });
    expect(html).toMatch(/<header[^>]*class="title-bar is-mac has-traffic-lights"/);
    expect(html).toMatch(/<header[^>]*data-tauri-drag-region="deep"/);
    expect(html).toContain("出力音声 · Speakers");
    // ボタンの並びと読み上げの名前は Windows と同じ
    expect(labels(html)).toEqual(["出力系統", "レイアウト編集", "設定", "ボーダレスフルスクリーン"]);
  });

  it("macOS の全画面（S09a）：信号機ボタンの余白をなくし、終了用のボタンになる", async () => {
    const html = await render({ source: live, platform: "macos", fullscreen: true });
    expect(html).toMatch(/<header[^>]*class="title-bar is-mac"/);
    expect(html).not.toContain("has-traffic-lights");
    expect(labels(html)).toEqual(["出力系統", "レイアウト編集", "設定", "ボーダレスフルスクリーンを終了"]);
  });

  it("Windows とそれ以外：今のまま（余白もつかみも足さない）", async () => {
    for (const platform of ["windows", "other"] as const) {
      const html = await render({ source: live, platform });
      expect(html).toMatch(/<header class="title-bar"/);
      expect(html).not.toContain("is-mac");
      expect(html).not.toContain("data-tauri-drag-region");
    }
    expect(await render({ source: live })).not.toContain("data-tauri-drag-region");
  });
});
