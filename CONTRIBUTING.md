# sonar_spectra 開発ガイド

不具合の報告はIssueで受け付けます。プルリクエストは、事前にIssueで相談してください。

## 開発環境

初版はWindows x64だけに対応しています（出力音声の取得にWASAPIのループバックを使うため）。

- Windows 10／11（x64）
- [Bun](https://bun.sh/)：ランタイムとパッケージマネージャ。版は`package.json`の`packageManager`（CIも同じ版を使います）
- [Rust](https://www.rust-lang.org/tools/install)：stable。edition 2024を使うため、1.85以降
- Microsoft C++ Build Tools：「C++によるデスクトップ開発」のワークロード
- Microsoft Edge WebView2 Runtime：Windows 11には同梱されています

Tauriの前提条件の詳細は、[Tauriの公式ドキュメント](https://tauri.app/start/prerequisites/)を参照してください。

主な依存は次のとおりです。版は`package.json`と`src-tauri/Cargo.toml`で固定しています。

- Tauri 2（2.12系）
- Vue 3（3.5系）、Vite（8.3系）、TypeScript

## セットアップ

```sh
git clone https://github.com/rinfromniigata/sonar_spectra.git
cd sonar_spectra
bun install
```

開発版を起動します（初回はRust側のビルドに数分かかります）。

```sh
bun run tauri dev
```

## 開発版での確認

### 部品ギャラリー

開発版では、`Ctrl+Shift+P`でメーター画面と部品ギャラリーを切り替えられます（URLの`#parts`でも開きます）。ギャラリーには基本部品が状態ごとに並び、上部の切り替えでダークとライトを見比べられます。公開版のビルドには含まれません。

### 疑似ロケール

```sh
bun run dev:pseudo
```

文字列を3〜4割伸ばし、`⟦…⟧`で囲んだ疑似ロケールで起動します。囲まれていない文字列は辞書を通っていない直書きで、文字列が伸びたときの崩れもここで確かめます。`<html lang>`と日付・数値の整形は、原文の言語（`ja`）のままです。

## 確認と検査

```sh
bun run check
```

次の検査を順に実行し、最初に失敗したところで止まります。CI（`.github/workflows/ci.yml`）も、pushとプルリクエストのたびに同じコマンドを実行します。ただし、`roadmap/`・`docs/`・Markdown・`LICENSE`だけの変更では実行しません（どの検査もこれらを読まないため）。個別に実行することもできます。

- `bun run check:types`：型検査（`vue-tsc`と`tsc`）。存在しない辞書のキーや、プレースホルダの過不足もここで見つかります
- `bun run check:lint`：ESLint。UIの文字列の直書き（テンプレート、`aria-label`などの属性、スクリプト内の日本語）と、`useT()`を通らない翻訳を検出します
- `bun run check:i18n`：ロケール間のキーの過不足、プレースホルダの一致、メッセージの構文、未使用キー
- `bun run check:tokens`：`src/theme/`以外にある、色とpx値の直書き
- `bun run check:unit`：単体テスト（vitest）
- `bun run check:rust`：`cargo clippy`（警告もエラー扱い）と`cargo test`

### 文言の決まり

- UIの文字列は、すべて`src/i18n/locales/ja.ts`（原文の辞書）に置き、コンポーネントからは`src/i18n/use_t.ts`の`useT()`で引きます。`vue-i18n`の`useI18n`や`$t`は直接使いません（キーとプレースホルダを型で検査するため）
- 文字列を連結して文を組み立てず、可変部分はプレースホルダ（`{name}`）で表します。日付と数値は`src/i18n/format.ts`の関数で整形します
- キーは`"title_bar.settings"`のように、組み立てずに文字列のまま書きます（未使用キーの検査が、文字列として現れるキーを数えるため）
- 辞書にはあるが、使う画面がまだできていないキーは、`scripts/i18n_pending_keys.ts`に挙げます。画面で使い始めたら、ここから外します（外し忘れは`check:i18n`がエラーにします）

### 値の決まり

- 色・余白・角丸・書体・発光・モーションは`src/theme/tokens.css`、部品の寸法は`src/theme/component_metrics.css`のカスタムプロパティ（`var(--…)`）を使います
- `src/theme/tokens.css`は`roadmap/specs/`のトークンの写しです。直接編集しません
- どうしても直書きが必要な行には、`token-check-ignore: 理由`を書き添えます（理由のない印は無効です）

## アイコンの生成

```sh
bun run icons
```

`roadmap/specs/`にある最新版のマスターSVG（`sonar_spectra_icon_master_v{n}.svg`）から、`tauri icon`で`src-tauri/icons/`のアイコン一式を作り直し、ファビコンを`public/`に置きます。マスターSVGの写し`docs/brand/icon_master.svg`が最新版と一致していないときは、生成を止めます。マスターSVGが変わったら、先に写しを更新してから実行してください。

## リポジトリ構成

```
sonar_spectra/
├─ src/                  UI（Vue 3 + TypeScript）
│  ├─ theme/             トークン（tokens.css）・部品の寸法・書体・基本スタイル
│  ├─ i18n/              辞書（locales/ja.ts）・useT()・ロケールの判定・整形・疑似ロケール
│  ├─ components/ui/     基本部品
│  └─ dev/               開発時だけ開ける画面（部品ギャラリー）
├─ src-tauri/            Rust（Tauri）。icons/ は bun run icons で生成
├─ scripts/              検査（i18n・トークン）とアイコン生成のスクリプト
├─ public/               ファビコン（bun run icons で生成）
├─ docs/brand/           ブランド方針（brand.md）とマスターSVGの写し
├─ .github/workflows/    CI
└─ roadmap/              計画と記録（下記）
```

`roadmap/`には、企画から実装までの計画と記録を置いています。

- `roadmap/timeline.md`：プランアセットの版とリリースを時系列に並べた索引。どのリリースがどの版から作られたかを、ここで対応づけます
- `roadmap/specs/`：プランアセット（スペックシート、モック、トークン、マスターSVG、ブランド方針）の最新版。値・画面構成・振る舞いの正本です
- `roadmap/planning_dialog/`：実装の設計（imple）・実装タスク（tasks）・検証項目（walk）の最新版
- `roadmap/development/`：tasksにない修正の記録（fix）と、仕様変更のサマリー（change）
- `roadmap/archived/`：旧版。Gitでは管理しません

`docs/brand/`は、`roadmap/specs/`のブランド方針とマスターSVGを、版番号のない固定名で写したものです。版が変わっても、リポジトリの中から同じ名前で参照できるように置いています。
