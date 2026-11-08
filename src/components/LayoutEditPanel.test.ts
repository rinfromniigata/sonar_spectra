import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import { i18n } from "../i18n";
import ja from "../i18n/locales/ja";
import LayoutEditPanel from "./LayoutEditPanel.vue";

async function render(mode: "auto" | "manual"): Promise<string> {
  const app = createSSRApp({ render: () => h(LayoutEditPanel, { mode }) });
  app.use(i18n);
  return renderToString(app);
}

/** ボタン（文言で探す。SSR のスロットの印 <!--[--> を挟んでもよい）の開きタグと位置 */
function button(html: string, label: string): { tag: string; index: number } {
  const match = new RegExp(`(<button[^>]*>)(?:<!--\\[-->)?${label}(?:<!--\\]-->)?</button>`).exec(html);
  if (!match) throw new Error(`button "${label}" not found`);
  return { tag: match[1], index: match.index };
}

/** バッジ（クラスと文言） */
function badge(html: string): { classes: string[]; text: string } {
  const match = /<span class="([^"]*mode-badge[^"]*)"[^>]*>([^<]*)<\/span>/.exec(html);
  if (!match) throw new Error("badge not found");
  return { classes: match[1].split(" "), text: match[2].trim() };
}

describe("LayoutEditPanel", () => {
  it("見出しとバッジ → 操作の説明 → 「自動整列」「完了」の順に置き、「完了」を主ボタンにする", async () => {
    const html = await render("manual");
    const order = [
      html.indexOf(`>${ja.layout_edit.title}</h2>`),
      html.indexOf("mode-badge"),
      html.indexOf(`>${ja.layout_edit.hint}</p>`),
      button(html, ja.layout_edit.auto_arrange).index,
      button(html, ja.layout_edit.done).index,
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(button(html, ja.layout_edit.done).tag).toContain("is-primary");
  });

  it("手動配置では「手動配置」のバッジを強調し、「自動整列」を押せる", async () => {
    const html = await render("manual");
    expect(badge(html)).toEqual({ classes: expect.arrayContaining(["mode-badge", "is-manual"]), text: ja.layout_edit.mode_manual });
    expect(button(html, ja.layout_edit.auto_arrange).tag).not.toContain("disabled");
  });

  it("自動配置では「自動配置」のバッジを出し、「自動整列」は押せない", async () => {
    const html = await render("auto");
    expect(badge(html)).toEqual({ classes: ["mode-badge"], text: ja.layout_edit.mode_auto });
    expect(button(html, ja.layout_edit.auto_arrange).tag).toContain("disabled");
  });
});
