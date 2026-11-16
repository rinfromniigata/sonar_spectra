# Sonar Spectra 開発ガイド

不具合の報告はIssueで受け付けます。プルリクエストは、事前にIssueで相談してください。

## 開発環境

WindowsとmacOS（Apple Silicon）に対応しています。出力音声の取得はOSごとに実装し、Windowsは WASAPI のループバック、macOSは Process Tap（Core Audio）を使います。開発は、次のどちらかの環境で行います。

- Windows 10／11（x64）
- macOS 26以降（Apple Silicon）：Xcode 26以降（`bun run icons:car`の`actool`のために本体が要ります。Command Line Toolsだけでは足りません）

共通の道具は次のとおりです。

- [Bun](https://bun.sh/)：ランタイムとパッケージマネージャ。版は`package.json`の`packageManager`（CIも同じ版を使います）
- [Rust](https://www.rust-lang.org/tools/install)：stable。edition 2024を使うため、1.85以降

Windowsではさらに次が要ります。

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

次の検査を順に実行し、最初に失敗したところで止まります。CI（`.github/workflows/ci.yml`）も、pushとプルリクエストのたびに、WindowsとmacOS（Apple Silicon）のランナーで同じコマンドを実行します（出力音声の取得はOSごとに条件付きでコンパイルするため、両方で検査します）。ただし、`roadmap/`・`docs/`・Markdown・`LICENSE`だけの変更では実行しません（どの検査もこれらを読まないため）。個別に実行することもできます。

- `bun run check:types`：型検査（`vue-tsc`と`tsc`）。存在しない辞書のキーや、プレースホルダの過不足もここで見つかります
- `bun run check:lint`：ESLint。UIの文字列の直書き（テンプレート、`aria-label`などの属性、スクリプト内の日本語）と、`useT()`を通らない翻訳を検出します
- `bun run check:i18n`：ロケール間のキーの過不足、プレースホルダの一致、メッセージの構文、未使用キー
- `bun run check:plist`：`src-tauri/Info.plist`の用途の説明（`NSAudioCaptureUsageDescription`）が、原文の辞書の値と一致すること
- `bun run check:appicon`：`src-tauri/macos/Assets.car`が、今の`AppIcon.icon`から作られたものであること（`Assets.car.source`に記録した`AppIcon.icon`の指紋と比べます。OSを問いません）
- `bun run check:tokens`：`src/theme/`以外にある、色とpx値の直書き
- `bun run check:unit`：単体テスト（vitest）
- `bun run check:rust`：`cargo clippy`（警告もエラー扱い）と`cargo test`

実機の出力デバイスを使うテスト（WASAPIのループバックの取得）は、CIのランナーに出力デバイスがないことがあるため、既定では実行しません。音声まわりを変えたときは、Windowsの手元で次のコマンドを実行してください。

```sh
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored
```

解析結果のバイト列の形式（`src-tauri/src/frame_transport/format.rs`と`src/frame_client/format.ts`）は、送出側と受信側で同じテスト用データ（`src-tauri/src/frame_transport/fixtures/frame_format_v1.json`）を使って検査します。形式を変えたときは、両方の`FORMAT_VERSION`を上げ、環境変数`SONAR_UPDATE_FIXTURE=1`を付けて次のコマンドでデータを作り直してください（PowerShellでは、先に`$env:SONAR_UPDATE_FIXTURE = "1"`を実行します）。環境変数がなければ、データは書き換わりません。

```sh
SONAR_UPDATE_FIXTURE=1 cargo test --manifest-path src-tauri/Cargo.toml regenerate_shared_fixture -- --ignored
```

### 文言の決まり

- UIの文字列は、すべて`src/i18n/locales/ja.ts`（原文の辞書）に置き、コンポーネントからは`src/i18n/use_t.ts`の`useT()`で引きます。`vue-i18n`の`useI18n`や`$t`は直接使いません（キーとプレースホルダを型で検査するため）
- 文字列を連結して文を組み立てず、可変部分はプレースホルダ（`{name}`）で表します。日付と数値は`src/i18n/format.ts`の関数で整形します
- キーは`"title_bar.settings"`のように、組み立てずに文字列のまま書きます（未使用キーの検査が、文字列として現れるキーを数えるため）
- 辞書にはあるが、使う画面がまだできていないキーは、`scripts/i18n_pending_keys.ts`に挙げます。画面で使い始めたら、ここから外します（外し忘れは`check:i18n`がエラーにします）
- OSが出す文言（macOSの`Info.plist`の用途の説明）も、原文の辞書の`bundle.*`が正本です。辞書を直してから`src-tauri/Info.plist`に同じ値を写します（対応は`scripts/info_plist_check_core.ts`の`INFO_PLIST_MESSAGES`）

### 値の決まり

- 色・余白・角丸・書体・発光・モーションは`src/theme/tokens.css`、部品の寸法は`src/theme/component_metrics.css`のカスタムプロパティ（`var(--…)`）を使います
- `src/theme/tokens.css`は`roadmap/specs/`のトークンの写しです。直接編集しません
- どうしても直書きが必要な行には、`token-check-ignore: 理由`を書き添えます（理由のない印は無効です）

## ビルドとリリース

### 手元でビルドする

```sh
bun run tauri build
```

フロントエンドのビルドのあと、Rust側をリリースビルドし、配布用のファイルを作ります（初回は数分かかります）。`src-tauri/target/release/bundle/`の下にできます。

- Windows：NSISのインストーラー（`nsis/*-setup.exe`）とMSI（`msi/`）
- macOS：`macos/Sonar Spectra.app`と、ディスクイメージ（`dmg/*.dmg`）。`src-tauri/tauri.macos.conf.json`が、アドホック署名（`signingIdentity`が`-`）と、アイコン（`Assets.car`と`icon.icns`）を指定します。リリースのCIは`--target aarch64-apple-darwin`を付けるため、出力は`src-tauri/target/aarch64-apple-darwin/release/bundle/`の下になります

インストーラー・ディスクイメージを作らず実行ファイルだけを確かめるときは、`bun run tauri build --no-bundle`です。macOSでビルドしたら、`.app`の`Contents/Resources/`に`Assets.car`と`icon.icns`の両方があることを確かめてください（`--bundles dmg`では、`.dmg`を作ったあとに`.app`が片づけられるため、`.dmg`をマウントして中を見ます）。

NSISのインストーラーには、`src-tauri/windows/hooks.nsh`のフック（`bundle.windows.nsis.installerHooks`）を組み込みます。0.1.0は表示名が`sonar_spectra`だったため、アンインストール情報のキーとインストール先が今の版と違います。フックは、インストールの前に0.1.0のアンインストーラーをサイレントで実行し、設定と構成（`%APPDATA%\com.rinontech.sonar-spectra`）を残したまま旧版を取り除きます。表示名は`productName`で決まります。`identifier`とCargoの`package.name`（実行ファイルの名前）は、表示名とは別のもので、変えません（設定の保存場所と、実行ファイルの名前が、これで決まるため）。

アイコンだけを変えたときは、`cargo build`・`tauri build`が古いアイコンのままの実行ファイルを作ることがあります。手元で確かめるときは、`src-tauri/build.rs`を触って（保存し直して）から作り直してください。

### リリースの手順

リリースは、GitHub Actionsのワークフロー（`.github/workflows/release.yml`）が行います。Windowsはコード署名をしないため、初回起動時にSmartScreenの警告が出ます。macOSはアドホック署名だけで、Developer IDの署名と公証はしないため、初回に「このまま開く」が要り、更新のたびにシステムオーディオ録音の許可を与え直す必要があります（どちらも開き方をREADMEに書きます）。

1. `package.json`・`src-tauri/tauri.conf.json`・`src-tauri/Cargo.toml`の`version`を、リリースするバージョン（セマンティックバージョニング。初回は`0.1.0`）にそろえ、`CHANGELOG.md`に変更点を書きます
2. 手元で`bun run check`が通ることを確かめます
3. 変更をコミットし、`v`を付けたタグ（例：`v0.1.0`）を作って、pushします

```sh
git tag v0.1.0
git push origin v0.1.0
```

`v*`のタグをpushすると、ワークフローが次を順に行います。どこかで失敗すると、そこで止まり、リリースは作られません。

- タグ（`v`を除いた値）が、上の3つのファイルの`version`と一致することを確かめる。食い違っていたら失敗します（バージョンを直したら、タグを付け直してpushします）
- `bun run check`（`ci.yml`と同じ検査）
- 次の2つを、1つずつ順にビルドし、GitHub Releasesの**1つのドラフト**にそろえる（同時に走らせると、同じタグのドラフトが2つできることがあるため、`max-parallel: 1`にしています）。ビルドごとに、上の検査も実行します
    - Windows x64のインストーラー（NSISの`setup.exe`のみ。MSIは作りません）
    - macOS（Apple Silicon、`aarch64-apple-darwin`）のディスクイメージ（`.dmg`のみ）。ランナーは`macos-26`（Xcode 26以降）で、ビルドのあとに、`.dmg`をマウントして中の`.app`に`Assets.car`と`icon.icns`があること、アドホック署名であることを確かめます。Intel Mac用（Universal）は作りません

4. GitHubのReleasesのページでドラフトを開き、Windowsのインストーラーと、macOSの`.dmg`の両方が添付されていること、本文を確かめて、公開します。公開するまで、一般の利用者には見えません

自動更新は使わないため、更新用の`latest.json`は作りません。

## アイコンの生成

```sh
bun run icons
```

`roadmap/specs/`にある最新版のマスターSVG（`sonar_spectra_icon_master_v{n}.svg`）から、`tauri icon`で`src-tauri/icons/`のアイコン一式を作り直し、ファビコンを`public/`に置き、レイヤーごとのSVGを`docs/brand/icon_layers/`に書き出します。マスターSVGの写し`docs/brand/icon_master.svg`が最新版と一致していないときは、生成を止めます。マスターSVGが変わったら、先に写しを更新してから実行してください。

マスターSVGは角のない正方形で、角丸と余白は持ちません。生成するときに、形式ごとに次のとおり足します。

- Windows向け（`icon.ico`・PNG）とファビコン：1024四方のまま、角丸半径200で切り抜きます（余白は足しません）
- macOS向けの従来形式（`icon.icns`）：824四方に縮めて中央に置き（四辺に100の余白）、角丸半径185.4で切り抜きます

- Apple環境向けの`AppIcon.icon`の材料：前景のレイヤー（`01_ring`・`02_wave`・`03_peak`）を、1024四方のキャンバスのまま、角丸や余白を足さずに`docs/brand/icon_layers/{レイヤー名}.svg`へ書き出します。`00_bg`は書き出さず、その色（実行の最後に表示します）をIcon Composerの背景の塗りにします

`src-tauri/macos/AppIcon.icon`は、これらのSVGと`docs/brand/brand.md`の「Apple環境向けアイコン」から、Icon Composerで作ったものです。`bun run icons`は`src-tauri/icons/`を消してから作り直すため、その外に置いています。ビルドに組み込むのは、`AppIcon.icon`から手元で作った`src-tauri/macos/Assets.car`です。`src-tauri/tauri.macos.conf.json`の`bundle.icon`が`Assets.car`と`icon.icns`の両方を指し、バンドラーは`Assets.car`をそのまま`.app`に入れます（`.icns`は、従来形式のフォールバックとして残します）。`bundle.icon`に`.icon`を挙げるとバンドラーがビルドの中で`actool`を呼びますが、GitHub Actionsのランナーでは`actool`が落ちるため（[tauri#15315](https://github.com/tauri-apps/tauri/issues/15315)）、この形にしています。モバイル向けは作りません。

```sh
bun run icons:car
```

macOSで、`AppIcon.icon`を`actool`で`Assets.car`にし、元にした`AppIcon.icon`の指紋を`Assets.car.source`に書きます（`actool`の引数は、tauri-bundlerと同じです）。`actool`には、Xcode 26以降が要り、`xcode-select -p`がXcode本体（`/Applications/Xcode.app/Contents/Developer`）を指している必要があります。

マスターSVGが変わったときの`AppIcon.icon`の作り直しの手順は、次のとおりです。`AppIcon.icon`は、Icon Composerで人が作り直し、エージェントや生成スクリプトは編集しません。

1. 先に`docs/brand/icon_master.svg`を最新版のマスターSVGと同じにし、`bun run icons`を実行する（`docs/brand/icon_layers/`のレイヤーのSVGが更新されます）
2. Icon Composerで`src-tauri/macos/AppIcon.icon`を開き、各レイヤーを`docs/brand/icon_layers/`の新しいSVGに差し替える。背景の塗りは、`bun run icons`の最後に表示される`00_bg`の色にし、そのほかの設定は`docs/brand/brand.md`の「Apple環境向けアイコン」に従う
3. 保存して、`bun run icons:car`で`Assets.car`を作り直す（作り直し忘れは`bun run check:appicon`で止まります）
4. `bun run tauri build`で`.app`を作り、`Assets.car`と`icon.icns`が入っていることを確かめる

## リポジトリ構成

```
sonar_spectra/
├─ src/                  UI（Vue 3 + TypeScript）
│  ├─ theme/             トークン（tokens.css）・部品の寸法・書体・基本スタイル
│  ├─ i18n/              辞書（locales/ja.ts）・useT()・ロケールの判定・整形・疑似ロケール
│  ├─ components/ui/     基本部品
│  └─ dev/               開発時だけ開ける画面（部品ギャラリー）
├─ src-tauri/            Rust（Tauri）。icons/ は bun run icons で生成。windows/hooks.nsh はNSISのフック、macos/AppIcon.icon はApple環境向けアイコン（Assets.car はそこから作ったもの）
├─ scripts/              検査（i18n・トークン）とアイコン生成のスクリプト
├─ public/               ファビコン（bun run icons で生成）
├─ docs/brand/           ブランド方針（brand.md）とマスターSVGの写し。icon_layers/ は bun run icons で生成
├─ .github/workflows/    CI（ci.yml）とリリース（release.yml）
└─ roadmap/              計画と記録（下記）
```

`roadmap/`には、企画から実装までの計画と記録を置いています。

- `roadmap/timeline.md`：プランアセットの版とリリースを時系列に並べた索引。どのリリースがどの版から作られたかを、ここで対応づけます
- `roadmap/specs/`：プランアセット（スペックシート、モック、トークン、マスターSVG、ブランド方針）の最新版。値・画面構成・振る舞いの正本です
- `roadmap/planning_dialog/`：実装の設計（imple）・実装タスク（tasks）・検証項目（walk）の最新版
- `roadmap/development/`：tasksにない修正の記録（fix）と、仕様変更のサマリー（change）
- `roadmap/archived/`：旧版。Gitでは管理しません

`docs/brand/`は、`roadmap/specs/`のブランド方針とマスターSVGを、版番号のない固定名で写したものです。版が変わっても、リポジトリの中から同じ名前で参照できるように置いています。
