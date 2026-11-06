import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import { i18n } from "../i18n";
import type { SourceStatusEvent } from "../source";
import StatusOverlay from "./StatusOverlay.vue";

async function render(source: SourceStatusEvent | null): Promise<string> {
  const app = createSSRApp({ render: () => h(StatusOverlay, { source }) });
  app.use(i18n);
  return renderToString(app);
}

const device = { id: "id-1", name: "Speakers", isDefault: true };

describe("StatusOverlay", () => {
  it("取得中は何も重ねない", async () => {
    const html = await render({ status: { state: "live" }, device });
    expect(html).not.toContain("status-overlay");
  });

  it("無音（S01b）：メーターを隠さない細い表示で、脈動する点と文言だけ", async () => {
    const html = await render({ status: { state: "silent" }, device });
    expect(html).toContain("is-silent");
    expect(html).toContain('role="status"');
    expect(html).toContain("音を待っています");
    expect(html).toContain("pulse");
    expect(html).not.toContain("<button");
  });

  it("起動中・切り替え中（S01d）：スピナーと文言。状態がまだ届いていない起動直後も同じ", async () => {
    for (const source of [{ status: { state: "opening" as const }, device }, null]) {
      const html = await render(source);
      expect(html).toContain("is-opening");
      expect(html).toContain('role="status"');
      expect(html).toContain("入力源を開いています");
      expect(html).toContain("spinner");
      expect(html).not.toContain("<button");
    }
  });

  it("入力源が使えない（S01c）：タイトル・説明と、「再試行」「設定」のボタン。理由によらず同じ", async () => {
    for (const reason of ["notFound", "disconnected", "inUse", "other"] as const) {
      const html = await render({ status: { state: "unavailable", reason }, device: null });
      expect(html).toContain("is-unavailable");
      expect(html).toContain('role="alert"');
      expect(html).toContain("出力デバイスが見つかりません");
      expect(html).toContain("デバイスをつなぎ直してから再試行してください");
      // スロットの境目のコメント（<!--[-->）を除いて、ボタンの文言を並び順に取り出す
      const buttons = [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => m[1].replace(/<!--.*?-->/g, ""));
      expect(buttons).toEqual(["再試行", "設定"]);
    }
  });
});
