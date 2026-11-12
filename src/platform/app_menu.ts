// macOS のメニューバー（imple 3.6）：アプリメニューと「編集」メニューを、Tauri の定義済みの項目で作る。
// 定義済みの項目の文言は英語のまま固定で OS の言語に合わせない（muda 0.20）ため、文言は辞書から渡す。
// 「編集」メニューがあることで、名前の入力欄（構成・配色の名前）で取り消し・カット・コピー・ペースト・すべてを選択の
// 標準のショートカット（⌘Z・⌘X・⌘C・⌘V・⌘A）が効く。Windows にはメニューを足さない。
// 起動直後は Tauri の既定のメニュー（英語）が出ていて、これを組み終えたところで置き換わる（組めなかったときは既定のまま）。

import { getName } from "@tauri-apps/api/app";
import { Menu, Submenu } from "@tauri-apps/api/menu";
import type { Translate } from "../i18n/use_t";

/** 定義済みの項目の種類（@tauri-apps/api/menu の PredefinedMenuItemOptions["item"] の一部） */
export type PredefinedItem =
  | "Separator"
  | "Hide"
  | "HideOthers"
  | "ShowAll"
  | "Quit"
  | "Undo"
  | "Redo"
  | "Cut"
  | "Copy"
  | "Paste"
  | "SelectAll"
  | { About: null };

export interface MenuItemSpec {
  item: PredefinedItem;
  /** 区切りの線は文言を持たない */
  text?: string;
}

export interface SubmenuSpec {
  text: string;
  items: MenuItemSpec[];
}

/** メニューバーの中身（アプリメニュー、「編集」の順）。app はアプリの名前 */
export function appMenuSpec(t: Translate, app: string): SubmenuSpec[] {
  const separator: MenuItemSpec = { item: "Separator" };
  return [
    {
      // アプリメニューの見出しは、OS がアプリの名前で出す
      text: app,
      items: [
        // このアプリについて：tauri.conf.json の名前・バージョンで OS の標準の画面を出す
        { item: { About: null }, text: t("menu.about", { app }) },
        separator,
        { item: "Hide", text: t("menu.hide", { app }) },
        { item: "HideOthers", text: t("menu.hide_others") },
        { item: "ShowAll", text: t("menu.show_all") },
        separator,
        { item: "Quit", text: t("menu.quit", { app }) },
      ],
    },
    {
      text: t("menu.edit"),
      items: [
        { item: "Undo", text: t("menu.undo") },
        { item: "Redo", text: t("menu.redo") },
        separator,
        { item: "Cut", text: t("menu.cut") },
        { item: "Copy", text: t("menu.copy") },
        { item: "Paste", text: t("menu.paste") },
        { item: "SelectAll", text: t("menu.select_all") },
      ],
    },
  ];
}

/** メニューバーを組んで、アプリのメニューにする（macOS のときだけ呼ぶ） */
export async function installAppMenu(t: Translate): Promise<void> {
  const spec = appMenuSpec(t, await getName());
  const submenus = await Promise.all(spec.map((submenu) => Submenu.new(submenu)));
  const menu = await Menu.new({ items: submenus });
  await menu.setAsAppMenu();
}
