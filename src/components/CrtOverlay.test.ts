import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import metrics from "../theme/component_metrics.css?raw";
import CrtOverlay from "./CrtOverlay.vue";
import source from "./CrtOverlay.vue?raw";

async function render(props: { enabled?: boolean } = {}): Promise<string> {
  return renderToString(createSSRApp({ render: () => h(CrtOverlay, props) }));
}

describe("CrtOverlay", () => {
  it("既定で表示する（display.scanline の既定値はオン）。読み上げからは外す", async () => {
    const html = await render();
    expect(html).toContain("crt-overlay");
    expect(html).toContain('aria-hidden="true"');
  });

  it("enabled が false なら何も出さない", async () => {
    const html = await render({ enabled: false });
    expect(html).not.toContain("crt-overlay");
  });

  describe("スタイル（単一ファイルコンポーネントの定義）", () => {
    const style = source.slice(source.indexOf("<style"));

    it("画面全体に重ね、操作をさえぎらない", () => {
      expect(style).toMatch(/position:\s*absolute/);
      expect(style).toMatch(/inset:\s*0/);
      expect(style).toMatch(/pointer-events:\s*none/);
    });

    it("タイトル帯（5）・状態の表示（4）・設定パネル（6）より上に重ねる（モックの z-index 7）", () => {
      expect(style).toMatch(/z-index:\s*7/);
    });

    it("走査線と周辺減光の色は、テーマごとのトークンから取る。寸法は部品の寸法から取る", () => {
      expect(style).toContain("repeating-linear-gradient");
      expect(style).toContain("radial-gradient");
      expect(style).toContain("var(--color-scanline)");
      expect(style).toContain("var(--color-vignette)");
      for (const name of ["--scanline-gap", "--scanline-width", "--vignette-clear"]) {
        expect(style).toContain(`var(${name})`);
        expect(metrics).toMatch(new RegExp(`${name}:`));
      }
    });
  });
});
