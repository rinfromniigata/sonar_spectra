import { describe, expect, it } from "vitest";
import { globalT } from "../i18n/use_t";
import { appMenuSpec } from "./app_menu";

describe("appMenuSpec", () => {
  const spec = appMenuSpec(globalT(), "sonar_spectra");

  it("アプリメニューと「編集」の2つだけを、この順に持つ（imple 3.6）", () => {
    expect(spec.map((submenu) => submenu.text)).toEqual(["sonar_spectra", "編集"]);
  });

  it("アプリメニュー：このアプリについて・隠す・ほかを隠す・すべてを表示・終了（定義済みの項目、文言は辞書）", () => {
    expect(spec[0].items).toEqual([
      { item: { About: null }, text: "sonar_spectraについて" },
      { item: "Separator" },
      { item: "Hide", text: "sonar_spectraを非表示" },
      { item: "HideOthers", text: "ほかを非表示" },
      { item: "ShowAll", text: "すべてを表示" },
      { item: "Separator" },
      { item: "Quit", text: "sonar_spectraを終了" },
    ]);
  });

  it("「編集」：取り消し・やり直し・カット・コピー・ペースト・すべてを選択（定義済みの項目、文言は辞書）", () => {
    expect(spec[1].items).toEqual([
      { item: "Undo", text: "取り消す" },
      { item: "Redo", text: "やり直す" },
      { item: "Separator" },
      { item: "Cut", text: "カット" },
      { item: "Copy", text: "コピー" },
      { item: "Paste", text: "ペースト" },
      { item: "SelectAll", text: "すべてを選択" },
    ]);
  });
});
