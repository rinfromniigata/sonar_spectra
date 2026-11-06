# sonar_spectra 実装タスク（tasks）

- 対象：`roadmap/specs/sonar_spectra_SPEC_v2.md`、`261106104948_imple_sonar_spectra_architecture.md`
- 対になる検証：`261106104948_walk_sonar_spectra_initial.md`
- 進め方：Phase nの実装（Tn-\*）→ 検証（Wn-\*）→ 修正と再検証。Wnがすべて通過してからPhase n+1へ進む

## Phase 1: 基盤（雛形・トークン・i18n・検査・部品・アイコン）

Phaseの推奨: Sonnet・high以上

- [x] T1-1 【エージェント】create-tauri-app（Vue＋TypeScript、Bun）で雛形を作り、識別子`com.rinontech.sonar-spectra`・製品名・バージョン`0.1.0`・ウィンドウの最小幅960pxを設定する
  - 既存の`LICENSE`・`roadmap/`・`.gitignore`を残す。`.gitignore`には雛形の除外（`node_modules/`、`dist/`、`src-tauri/target/`）を追記する
  - 依存のバージョンはSPEC 4節に合わせる（Tauri 2.12系、Vue 3.5系、Vite 8.3系、`@vitejs/plugin-vue` 6系）。コマンドはインストール済みのcreate-tauri-appのヘルプで確認する
  - 実施メモ：`bun x create-tauri-app@latest sonar_spectra -m bun -t vue-ts --identifier com.rinontech.sonar-spectra --tauri-version 2 -y`で一時フォルダに生成してから、リポジトリへコピーした（テンプレートの`README.md`と`.gitignore`は持ち込まず、`.gitignore`は既存のものに追記）
  - 実施メモ：解決した版は`@tauri-apps/cli`・`@tauri-apps/api` 2.12.4、`tauri`クレート 2.12.5、Vue 3.5.44、Vite 8.3.5、`@vitejs/plugin-vue` 6.0.10。crates.ioには`tauri` 3.0.0-alphaがあるため、`Cargo.toml`は`2.12`、`package.json`のTauri・Viteは`~`で系列内に固定した
  - 実施メモ：製品名とウィンドウのタイトルは`sonar_spectra`（モックの辞書`app.window_title`と同じ）。ウィンドウは初期1280×800、最小幅960px
  - 実施メモ：テンプレートのデモ（英語の直書き文言、外部リンク、`greet`コマンド、`tauri-plugin-opener`、Vite・Tauri・Vueのロゴ）は、直書き禁止と外部送信なしに合わせて取り除き、`App.vue`は文言のない枠だけにした。`index.html`は`lang="ja"`
  - 実施メモ：`src-tauri/icons/`はテンプレートの既定アイコンのまま。T1-7でマスターSVGから生成し直す
  - 実施メモ：`bun run build`と`cargo build`が通ることを確認した
- [x] T1-2 【エージェント】`CONTRIBUTING.md`の骨格を作る（受け付け方針、開発環境、セットアップ）
  - 依存: T1-1
  - 実施メモ：受け付け方針は「不具合はIssue、プルリクエストは事前にIssueで相談」。開発環境はWindows x64、Bun、Rust 1.85以降（edition 2024）、C++ Build Tools、WebView2。セットアップは`bun install`と`bun run tauri dev`まで。検査・アイコン・リポジトリ構成はT1-9、ビルドとリリースはT9-3で追記する
- [x] T1-3 【エージェント】トークンと書体を配置する。`specs/`のトークンを`src/theme/tokens.css`へ、`brand.md`とマスターSVGを`docs/brand/`へコピーし、書体（Syncopate・Azeret Mono・Zen Kaku Gothic New）を`@fontsource`で同梱する。地の色・文字色などの基本スタイルをトークン経由で当て、テーマの初期値をダークにする
  - 依存: T1-1
  - 実施メモ：コピー先は`src/theme/tokens.css`（v1と同一内容）、`docs/brand/brand.md`、`docs/brand/icon_master.svg`（`docs/brand/`は版番号なしの固定名）
  - 実施メモ：書体は`@fontsource/syncopate`・`@fontsource/azeret-mono`・`@fontsource/zen-kaku-gothic-new`（5.3系）を入れ、`src/theme/fonts.ts`でモックが使う字重だけを読み込む（Syncopate 400・700、Azeret Mono 400・600、Zen Kaku Gothic New 400・500・700）。ビルド結果に外部URLがないことを確認した
  - 実施メモ：Syncopateのライセンスは、パッケージの記載ではApache-2.0だった（SPEC 9節は3書体ともSIL OFLとしている）。同梱に支障はなく、READMEのクレジットを書くときに正しいライセンスを記載する
  - 実施メモ：基本スタイルは`src/theme/base.css`（地の色・文字色・UI書体・文字サイズをトークンから取る。`body`はスクロールさせない）。読み込み順は`fonts.ts`→`tokens.css`→`base.css`（`src/main.ts`）
  - 実施メモ：テーマの初期値は、`index.html`の`<html data-theme="dark">`で決める。OSがライトでもダークで始まる。切り替えはT4-4でつなぐ
- [x] T1-4 【エージェント】i18nの基盤を作る。`vue-i18n`（11.4系、Composition API）を入れ、モックの辞書のうちアプリの文言を`src/i18n/locales/ja.ts`へ移し（キーは機能ごと・スネークケースに整える）、`ja.ts`の型でキーを型検査する。ロケールの判定・保持・フォールバック、`<html lang>`の更新、疑似ロケール（`bun run dev:pseudo`）、`Intl`による日付・数値の整形関数を用意する
  - 依存: T1-1
  - 実施メモ：`vue-i18n` 11.4.18。構成は`src/i18n/`に`index.ts`（createI18n、`initLocale`・`setLocale`、`<html lang>`）、`locale.ts`（判定・保持・フォールバックの純粋関数）、`use_t.ts`（型つきの`t`）、`format.ts`（`Intl`）、`pseudo.ts`、`locales/ja.ts`
  - 実施メモ：キーの最上位は`app`・`common`・`title_bar`・`source`・`status`・`modules`・`module_shape`・`shape_fit`・`layout_edit`・`instance`（`direction`・`waveform`・`spectrum`・`phase`）・`palette`・`config`・`settings`・`dev_gallery`。モックの説明用の文言（`doc.*`・`screen.*`・表示方式の説明文・`auto.*`・`new.*`・`notes.*`）と、見本のデータ（デバイス名、構成名とメタ情報、「マイ配色 1」）は移さず、見本のデータはプレースホルダに置き換えた（例：`source.chip_live`「出力音声 · {device}」、`config.meta`「{layout_mode}・モジュール{count}・{date}」、`app.version`「v{version}」）。S01cの「設定」ボタンは`status.open_settings`とした
  - 実施メモ：vue-i18nの`t`・`$t`は、キーの型を補完に使うだけで任意の文字列も受け付けることを、型定義と試験用のファイルで確かめた。そこで`useT()`（`use_t.ts`）を作り、辞書の型からキーとプレースホルダの名前を決めた。存在しないキー、末端でないキー、プレースホルダの不足・名前違い・余分が、`vue-tsc`でエラーになることを確かめた。`$t`は注入しない（`globalInjection: false`）。コンポーネントの文言はすべて`useT()`から引く
  - 実施メモ：判定は「保存値 → OSの言語（`navigator.languages`）→ `ja`」。初版は言語が1つで切り替えUIがなく、`state.json`のデータモデルにロケールの項目がないため、保存値はWebViewの`localStorage`（キー`sonar_spectra.locale`）に置いた。言語を追加する仕様変更のときに`state.json`へ移す
  - 実施メモ：疑似ロケールは`ja-x-pseudo`（文字列を約35%伸ばし`⟦…⟧`で囲む。プレースホルダは保つ）。`bun run dev:pseudo`は`tauri dev --config src-tauri/tauri.pseudo.conf.json`で、Viteを`--mode pseudo`で起動する。疑似ロケールでも`<html lang>`と`Intl`は`ja`。公開版のビルドに疑似ロケールが含まれないこと、`--mode pseudo`のビルドでは別チャンクになることを確かめた。Tauriのウィンドウでの起動はW1-4で確かめる
  - 実施メモ：整形関数は`formatDate`（jaで「2026/11/04」）、`formatDecibel`（小数1桁）、`formatMultiplier`（小数2桁。「×」は辞書の`common.speed_value`）、`formatPercent`（0〜100を受けて「72%」）、`formatInteger`
  - 実施メモ：T1-5への申し送り。現時点では辞書のキーがほぼすべて未使用のため、`i18n_check.ts`の未使用キーの検出をどう扱うか（画面ができるまでは警告にとどめる等）を決める必要がある。あわせて、`src/i18n/`以外での`useI18n`・`$t`の直接使用も検査で禁止する
- [x] T1-5 【エージェント】自動検査を`bun run check`1つにまとめる：`vue-tsc`、`scripts/i18n_check.ts`（キーの過不足・プレースホルダ・未使用キー）、`@intlify/eslint-plugin-vue-i18n`（直書き）、`scripts/token_check.ts`（色・px値の直書き）、`vitest`、`cargo clippy`・`cargo test`
  - 依存: T1-3, T1-4
  - 実施メモ：`bun run check`は`check:types`→`check:lint`→`check:i18n`→`check:tokens`→`check:unit`→`check:rust`の順に実行し、最初に失敗したところで止まる。各段は単独でも実行できる。全段が通ることを確認した
  - 実施メモ：版はESLint 10.14、`@intlify/eslint-plugin-vue-i18n` 4.5.1、`eslint-plugin-vue` 10.12、`typescript-eslint` 8.72（TypeScript 6.1未満に対応）、vitest 5.1、`@intlify/message-compiler` 11.4.18、`@types/node` 24
  - 実施メモ：`check:types`は`vue-tsc --noEmit`（`src/`）と`tsc --noEmit -p tsconfig.node.json`（`scripts/`・`vite.config.ts`・`vitest.config.ts`）。参照されるプロジェクトには`noEmit`を指定できないため、tsconfigどうしの参照（`references`）をやめ、2つを独立して検査する形にした。ルートのtsconfigは`types: []`にして、UIのコードからNodeの型が見えないようにした
  - 実施メモ：`check:lint`（`eslint.config.js`）。i18nのプラグインは`flat/base`の上に`no-raw-text`（テンプレートの文字列と、`aria-label`・`title`・`placeholder`・`alt`。記号と数字だけの文字列は対象外）と`no-v-html`を有効にした。`no-raw-text`はスクリプトを見ないため、CJK文字を含む文字列リテラルを`no-restricted-syntax`で検出する（英語の直書きは、スクリプト内では検出できない）。あわせて、`src/i18n/`の外での`vue-i18n`のimportと、`$t`などの参照を禁止した。`--max-warnings 0`。試験用のファイルで、各規則が検出することを確かめた
  - 実施メモ：`check:i18n`（`scripts/i18n_check.ts`、中身は`i18n_check_core.ts`）。`locales/`の`ja.ts`以外の各ロケールについて、キーの過不足とプレースホルダの一致を照合する。あわせて、全メッセージのvue-i18nの構文（`@`は連結キーとして解釈されるなど）を検査する。キーの使用は、`src/`の`.ts`・`.vue`（辞書とテストを除く）で、キーが引用符つきの文字列として現れるかで判定する。そのため、キーは組み立てずに文字列のまま書き、コメントに引用符つきでキーを書かない
  - 実施メモ：T1-4の申し送りへの対応。未使用キーは、画面ができるまで`scripts/i18n_pending_keys.ts`（使用予定のキーをPhaseごとに挙げる）に置く。次はすべてエラーになるため、Phaseが進むにつれて一覧は自動的に減り、0.1.0の準備までに空になる
    - 使用予定にない未使用キー
    - 使用予定に挙げたまま使われ始めたキー
    - 辞書にない使用予定のキー
  - 実施メモ：`check:tokens`（`scripts/token_check.ts`、中身は`token_check_core.ts`）。`src/theme/`以外の`.vue`・`.ts`・`.css`で、色（`#rgb`〜`#rrggbbaa`、`rgb(`・`hsl(`・`hwb(`・`lab(`・`lch(`・`oklab(`・`oklch(`）とpx値（0pxを除く）を検出する。やむを得ない行には`token-check-ignore: 理由`を付ける（理由のない印は無効）。色名（`white`など）は検出しない
  - 実施メモ：`check:unit`（`vitest.config.ts`。Viteの設定を引き継ぐ）。T1-4の`locale`・`pseudo`・`format`と、検査スクリプトの中身の単体テスト、計25件
  - 実施メモ：`check:rust`は`cargo clippy --all-targets -- -D warnings`と`cargo test`（いまはテスト0件）
  - 実施メモ：雛形の`src/vite-env.d.ts`の`DefineComponent<{}, {}, any>`を`DefineComponent`に、`vite.config.ts`の`@ts-expect-error`（`@types/node`がない前提）を削除した。いずれもlintと型検査を通すため
- [x] T1-6 【エージェント】基本部品（ボタン、アイコンボタン、スイッチ、セグメント切り替え、スライダー、セレクト、配色の見本、チップ、ドロワー、ポップオーバー）を`src/components/ui/`に作り、開発時だけ開ける部品ギャラリーに状態ごとに並べる
  - 依存: T1-3, T1-4
  - 画面: PARTS
  - 実施メモ：部品は`UiButton`・`UiIconButton`・`UiSwitch`・`UiSegmented`・`UiSlider`・`UiSelect`・`UiPaletteSwatch`・`UiChip`・`UiDrawer`・`UiPopover`と、補助の`UiIcon`（アイコンの形はモックと同じものを`icons.ts`に要素の配列で持つ。`v-html`は使わない）。文言は部品に持たせず、呼び出し側が`useT()`で引いて渡す。読み上げ用の名前（`label`）は、アイコンボタン・スイッチ・セグメント・スライダー・セレクトで必須にした。例外は`UiDrawer`・`UiPopover`の閉じるボタンで、部品の中で`common.close`を引く
  - 実施メモ：ドロワーとポップオーバーは、メーターを動かしたまま開くため、モーダルにしない（`role="dialog"`）。開くと中へフォーカスを移し、Escで閉じ、閉じると開く前の要素へフォーカスを戻す（`use_dismiss.ts`）。ポップオーバーの置き場所は、モックの規則（右→左→内側に寄せる、幅は使える幅の45%かつ最大幅まで、上下は領域内）を`popover_position.ts`の純粋関数に移し、単体テストを6件加えた
  - 実施メモ：セレクトはOS標準の`<select>`に見た目を当てた（キーボード操作と読み上げをそのまま使えるため）
  - 実施メモ：モックの部品の寸法（ボタンの高さ30px、アイコンボタン22px、スイッチ34×18px、線の太さ1px、フォーカスの線2px、チップ、ドロワーの幅380px、ポップオーバーの最大幅280pxなど）は`tokens.css`にないため、`src/theme/component_metrics.css`にカスタムプロパティとして集めた（コンポーネントへのトークン適用として扱った）。`tokens.css`の値は変えていない。フォーカスの見た目は`src/theme/focus_ring.css`で共通にした
  - 実施メモ：ギャラリーは`src/dev/PartsGallery.vue`。開発時（`import.meta.env.DEV`）だけ、`Ctrl+Shift+P`かURLの`#parts`で開く。公開版のビルドではコードごと除かれることを確かめた（辞書の`dev_gallery.*`の文言だけは残る）。各部品を、通常・ホバー・フォーカス・押下・選択中・無効と、長い文字列（チップ・セレクト）で並べた。ホバー・フォーカス・押下は`is-hover`・`is-focus`・`is-pressing`のクラスで固定して見せる。W1-6用に、ギャラリーの上部にダーク／ライト／OS設定の切り替えを置いた（`data-theme`を直接切り替える。設定へのつなぎ込みはT4-4）
  - 実施メモ：辞書に`dev_gallery.*`の見出しと状態名（`title`・`hint`・`part_*`・`open_drawer`・`open_popover`・`state_pressing`・`state_selected`・`state_long`）を加えた
  - 実施メモ：`check:i18n`を一部変更。ギャラリーで見本に使っただけで、本物の画面より先に使用予定から外れてしまうためで、`src/dev/`での使用は`dev_gallery.*`のキーだけを数えるようにした。使用予定からは、Phase 1の`dev_gallery.*`と、ドロワー・ポップオーバーで使い始めた`common.close`を外した
  - 実施メモ：`bun run check`が通ることを確認した。画面での見た目と操作は、W1-4〜W1-6で確かめる
- [x] T1-7 【エージェント】マスターSVGからアイコン一式（Windows・macOS向けとファビコン）を生成し、`src-tauri/icons/`に置く
  - 依存: T1-1
  - `tauri icon`の入力形式とオプションは、インストール済みバージョンの公式ドキュメントで確認する。余白の比率（四辺112/1024）を保つ
  - 実施メモ：インストール済みの`tauri icon`（CLI 2.12.4）のヘルプで、入力に正方形のSVGをそのまま使えることを確かめた。`bun run icons`（`scripts/generate_icons.ts`）で生成する。このスクリプトは次の順に動く
    - `roadmap/specs/`の最新版のマスターSVG（`_v{n}`の最大）を入力にする
    - `docs/brand/icon_master.svg`がそれと一致しなければ止める
    - `tauri icon`で`src-tauri/icons/`を作り直す
    - モバイル向け（`android/`・`ios/`）を消す（初版はデスクトップだけのため）
    - ファビコンとして、マスターSVGを`public/favicon.svg`に、`icon.ico`を`public/favicon.ico`にコピーする
  - 実施メモ：生成物は、PNG各種（32・64・128・128@2x・`icon.png` 512、Windowsストア用のSquare*）、`icon.ico`（16・24・32・48・64・256）、`icon.icns`。`tauri.conf.json`の`bundle.icon`の参照先がすべて存在することを確かめた（設定の変更はなし）。`index.html`にファビコン（ico・svg）を登録した
  - 実施メモ：余白の比率は、生成したPNGの画素で確かめた。地の色と異なる画素の外接矩形を測ると、四辺の余白は`icon.png`（512）で59〜61px、`128x128@2x.png`（256）で29〜30pxで、いずれも112/1024以上だった。角は透明（タイルの角丸）。32pxでは発光の線のぼかしが1画素はみ出して3px（期待3.5px）で、縮小によるものとして許容した
- [x] T1-8 【エージェント】`.github/workflows/ci.yml`を作る（push・プルリクエストで`bun run check`を実行。Windowsランナー）
  - 依存: T1-5
  - 実施メモ：`windows-latest`で次の順に実行する。同じブランチの古い実行は取り消す（`concurrency`）。権限は`contents: read`だけ
    - `actions/checkout@v7`
    - `oven-sh/setup-bun@v2`
    - `dtolnay/rust-toolchain@stable`（clippyつき）
    - `Swatinem/rust-cache@v2`
    - `bun install --frozen-lockfile`
    - `bun run check`
  - 実施メモ：各Actionの最新のリリース（checkout v7.0.1、setup-bun v2.2.0、rust-cache v2.9.3）を、GitHubのリリース情報で確かめた
  - 実施メモ：Bunの版は、`package.json`に`"packageManager": "bun@1.4.3"`（手元と同じ版）を加え、setup-bunの`bun-version-file`で読ませる
  - 実施メモ：CIでは`dist/`がない状態でRustの検査が走る。手元で`dist/`を消して`check:rust`が通ることを確かめた。YAMLとして正しく読めることも確かめた。実際の実行はW1-9（push後）で確かめる
  - 実施メモ：Rustはstableの最新を使う（手元は1.98.0）。clippyの新しい警告で`-D warnings`が失敗することがあれば、`rust-toolchain.toml`で版を固定する
- [x] T1-9 【エージェント】`CONTRIBUTING.md`に、確認・検査のコマンド、疑似ロケールでの起動、アイコンの生成、リポジトリ構成（`roadmap/`・`roadmap/timeline.md`・`docs/brand/`の役割）を追記する
  - 依存: T1-2, T1-5, T1-7
  - 実施メモ：追記した節は「開発版での確認」（部品ギャラリーの開き方、`bun run dev:pseudo`）、「確認と検査」（`bun run check`と各段、CIとの関係、文言の決まり、値の決まり）、「アイコンの生成」（`bun run icons`と、`docs/brand/`の写しを先に更新すること）、「リポジトリ構成」（`roadmap/`の各フォルダと`timeline.md`・`docs/brand/`の役割）。開発環境のBunに、版を`packageManager`で固定していることを書き足した
  - 実施メモ：記載したスクリプト名とファイルのパスが、すべて実在することを確かめた
- [x] T1-10 【エージェント】プランアセット v2の`brand.md`とマスターSVGを、`docs/brand/brand.md`・`docs/brand/icon_master.svg`へコピーし直す
  - 推奨: Sonnet・medium以上
  - 依存: T1-3
  - change: `development/261106052155_change_icon_layer_structure.md`（以下T1-12まで同じ）
  - 実施：Sonnet
  - 実施メモ：`specs/`のv2の`brand.md`・`icon_master.svg`を、`docs/brand/`の同名の写しへコピーし、`cmp`で差分がないことを確かめた。`src/theme/tokens.css`はv2の`tokens.css`と一致していて更新は不要だった。`bun run icons`はT1-11で実行する
- [x] T1-11 【エージェント】`scripts/generate_icons.ts`を、形式ごとに角丸と余白を足す展開（imple 7節。Windows向けは1024四方のまま角丸半径200、macOSの`.icns`は824四方に縮めて角丸半径185.4）に改め、`bun run icons`でv2のマスターSVGからアイコン一式とファビコンを作り直す
  - 推奨: Sonnet・high以上
  - 依存: T1-7, T1-10
  - `tauri icon`の入力とオプションは、インストール済みのバージョンのヘルプで確かめ直す
  - レイヤーごとのSVGの書き出しと`AppIcon.icon`は、macOS対応まで作らない（SPEC 8節）
  - 実施：Sonnet
  - 実施メモ：`tauri icon`（CLI 2.12.4）のヘルプで、入力にSVGを使えること、`--output`で出力先を変えられることを確かめた（v1と同じ）。オプションの変更は不要だった
  - 実施メモ：`scripts/generate_icons.ts`を、マスターSVGの中身（`<svg>`の中）を取り出し、形式ごとに`clipPath`と`transform`で包んだ一時的なSVGを作る形に改めた。一時的なSVGは作業用の一時フォルダに置き、終了時に消す
    - Windows用：1024四方のまま、角丸半径200で切り抜く。`tauri icon`の出力から、`.icns`とモバイル向け（`android/`・`ios/`）を除いて`src-tauri/icons/`に集める
    - macOS用：824四方に縮めて中央に置き（四辺100）、角丸半径185.4で切り抜く。`tauri icon`の出力から、`icon.icns`だけを取る
    - ファビコン：`public/favicon.svg`はWindows用のSVG（角丸で切り抜いたもの）、`public/favicon.ico`は`icon.ico`の写し
    - `docs/brand/icon_master.svg`が最新版のマスターSVGと一致しないときに止める確認は、そのまま残した。`src-tauri/icons/`は、毎回いったん空にして作り直す
  - 実施メモ：`bun run icons`を実行し、`src-tauri/icons/`が17ファイル（v1と同じ構成。モバイル向けなし）になること、`tauri.conf.json`の`bundle.icon`の5件が存在することを確かめた。`icon.png`を目で見て、角が透明に丸く切り抜かれ、v2の色・形（輪・波形・ピーク）が出ていることを確かめた。`check:types`・`check:lint`・`check:tokens`が通ることを確かめた。余白と角丸の寸法の測定と、`bun run check`全体は、W1-12・W1-14で行う
- [x] T1-12 【エージェント】`CONTRIBUTING.md`の「アイコンの生成」節を、形式ごとの展開に合わせて直す
  - 推奨: Sonnet・medium以上
  - 依存: T1-9, T1-11
  - 実施：Sonnet
  - 実施メモ：「アイコンの生成」節に、マスターSVGが角のない正方形であること、Windows向け・ファビコン（角丸半径200、余白なし）とmacOSの`.icns`（824四方、四辺100、角丸半径185.4）の違い、モバイル向けと`AppIcon.icon`を作らないことを書き足した。コマンドとパス（`bun run icons`、`docs/brand/icon_master.svg`）は変えていない

## Phase 2: 音の取得から最初の表示まで（レベル・波形・状態表示）

Phaseの推奨: Opus・high以上

- [x] T2-1 【エージェント】入力源のインターフェース（`AudioSource`トレイト、`DeviceInfo`、`SourceStatus`、`FrameSink`のリングバッファ）を作る
  - 推奨: Opus・high以上
  - 依存: T1-1
  - 実施: Opus
  - 実施メモ（261106）：`src-tauri/src/audio_source/`に、`mod.rs`（型とトレイト）と`ring_buffer.rs`（リングバッファ）を作った。`lib.rs`で`pub mod`として公開した（まだ使う側がなく、非公開だとclippyの未使用の警告で`-D warnings`に落ちるため）
    - impleの3.1にない、委任の範囲で決めたもの：`StatusSink`（`StatusEvent { status, device }`を受けるコールバック。イベント`source-status`の中身にそのまま使える）、`SourceError`（`NotFound`・`InUse`・`Backend`と、`UnavailableReason`への対応）、読み出し口の`FrameReader::copy_latest`と`WindowInfo`（サンプルレート・書き込みの累計・埋まっているフレーム数）、サンプルレートの変更を伝える`FrameSink::reset`
    - リングバッファ：満杯なら古い側から上書きし、書き込みは読み出しを待たない。ロックはコピーの間だけ持つ。既定の容量`DEFAULT_RING_FRAMES`は384,000フレーム（192 kHzで約2秒、48 kHzで約8秒）
    - JSONの形：`SourceStatus`は`{ "state": "unavailable", "reason": "disconnected" }`、`DeviceInfo`は`isDefault`のキャメルケース。UI側の型（T2-6・T2-12）はこれに合わせる
    - モノラル・多チャンネルのステレオへの変換と無音の判定は、T2-2（`WasapiLoopback`）で行う。`FrameSink::push`はステレオのインターリーブだけを受ける
    - 単体テスト12件（巻き戻り・不足分の0埋め・容量超えの書き込み・`reset`・並行の読み書き・トレイトの形・JSONの形）を付けた。`bun run check`は終了コード0で通った
- [x] T2-2 【エージェント】`wasapi`クレート（0.26系）で`WasapiLoopback`を実装する。既定の出力デバイスのループバック取得、ステレオ・f32への変換、無音の判定、切断と既定デバイスの変更時の再オープン
  - 推奨: Opus・high以上
  - 依存: T2-1
  - 実施: Opus
  - 実施メモ（261106）：`wasapi` 0.26.0をWindows限定の依存に、`windows-core` 0.62（`wasapi`と同じ版。テストでHRESULTのエラーを作るため）をWindows限定のdev依存に加えた。APIは、インストールしたクレートのソースと例（`loopback.rs`・`device_notifications.rs`）で確かめた
    - `audio_source/wasapi_loopback.rs`（Windowsだけ）：取得は専用スレッドで、イベント駆動・共有モードのループバック。ミックス形式のまま開き、チャンネルの変換は自前で行う（`autoconvert`は使わない）。デバイスの一覧も、呼び出し元のCOMの状態（UIスレッドはSTA）に左右されないよう、MTAの専用スレッドで行う
    - `audio_source/convert.rs`：ミックス形式（f32・16／24／32ビット整数）からステレオ・f32への変換。モノラルは両方に複製し、多チャンネルはスピーカー配置で畳み込む（前の左右は1.0、ほかは-3 dB、LFEは入れない。正規化はしない）。配置が分からなければ先頭の2チャンネルを使う
    - `audio_source/state.rs`：無音の判定（-70 dBFS以下が2秒続いたら`Silent`、超えたらすぐ`Live`。時間はフレーム数で数える）と、状態の通知の重複を除く`StatusReporter`。しきい値と保持時間はSPECに定めがないため、委任の範囲で決めた
    - 何も再生していない間、ループバックはパケットを出さない。最後の波形が止まって見えないよう、40ms以上届かなければ、届かなかった時間を0のフレームで埋める（上限1秒。無音の判定にも数える）
    - 切断・無効化・サンプルレートの変更は、読み取りの失敗として現れる。`Unavailable { Disconnected }`を通知し、1秒ごとに（デバイスの追加・状態の変化・既定の変更の通知があればすぐに）開き直す。開き直したら`FrameSink::reset`で新しいサンプルレートを伝える。再試行中の「見つからない」は、理由を「切断された」のまま保つ
    - 既定に追従しているとき（`device_id`が`None`）、既定が変わったら`Opening`を通知して新しい既定を開き直す。`device_id`を指定したときは、そのデバイスだけを開き直す
    - 最初のオープンに失敗したときは、`Unavailable`を通知してエラーを返し、スレッドを終える（再試行はS01cの「再試行」（T2-5の`retry_source`）から）
    - 単体テスト14件（変換7・無音と通知5・ほか2）を加えた。実機の出力デバイスが要るテスト3件（一覧、既定デバイスからの取得と停止、存在しないID）は`#[ignore]`とし、手元で`-- --ignored`を付けて実行して通った。実行のしかたを`CONTRIBUTING.md`の「確認と検査」に書いた。`bun run check`は終了コード0で通った
    - 実際に音を鳴らしての取得（値が振れること・遅れ）はW2-4で、切断・再試行の見え方はW2-6で確かめる
- [ ] T2-3 【エージェント】解析の枠組み（`Analyzer`トレイト、FFTを共有する`AnalysisContext`）と、レベル・波形（今の波形のサンプル、履歴用の要約と帯域別の強さ）の解析を作る
  - 推奨: Opus・high以上
  - 依存: T2-1
- [ ] T2-4 【エージェント】送出（約60回/秒のスレッド、バイト列の形式、`Channel`での送信、一時停止）を作る
  - 推奨: Opus・high以上
  - 依存: T2-3
- [ ] T2-5 【エージェント】コマンド（`start_stream`、`list_output_devices`、`select_output_device`、`retry_source`、`set_render_paused`、`set_active_sections`）とイベント`source-status`を作る
  - 推奨: Opus・high以上
  - 依存: T2-2, T2-4
- [ ] T2-6 【エージェント】受信（`frame_client`）を作る。バイト列を解析結果の型に戻し、最新の値と、波形・スペクトログラム用の履歴を保持する
  - 推奨: Opus・high以上
  - 依存: T2-4
- [ ] T2-7 【エージェント】モジュールの共通部分を作る。`ModuleDefinition`・`ModuleRenderer`、レジストリ、既定のインスタンスをレジストリから作る仕組み、`ModuleFrame`（見出し、流れる方向に合わせて座標系と文字を枠ごと回す）、標準の配色（マゼンタ主・シアン主・アンバー主）とトークンから読む`canvas_colors`
  - 推奨: Opus・high以上
  - 依存: T1-3, T1-4, T2-6
- [ ] T2-8 【エージェント】描画ループを作る（`requestAnimationFrame`を1本、最小化時の停止と`set_render_paused`、有効なモジュールに応じた`set_active_sections`）
  - 推奨: Opus・high以上
  - 依存: T2-5, T2-7
- [ ] T2-9 【エージェント】自動整列（`autoArrange`）と`MeterGrid`を作る。画面比の帯（2.4／1.5／1.1）ごとのテンプレート、推奨の形、2つ目の位相の専用の位置、同じ種類の2つ目以降を隣に並べる規則、縦長でのレベルの向き
  - 推奨: Opus・high以上
  - 依存: T2-7
- [ ] T2-10 【エージェント】レベルメーターのモジュールを作る
  - 推奨: Sonnet・high以上
  - 依存: T2-7
  - 画面: S01
- [ ] T2-11 【エージェント】波形のモジュールを作る。左に履歴・右に今の波形、芯と外縁の2本と半透明の塗り、両端の固定、境目の点線、ステレオ／モノラル、履歴の色（単色／帯域別）、今の波形の有効・無効、境目の割合、流れる速さ（設定値はすべて既定値で動かす。変更UIはPhase 6）
  - 推奨: Opus・high以上
  - 依存: T2-7
  - 画面: S01, S06
- [ ] T2-12 【エージェント】タイトル帯を作る。SONAR/SPECTRAとバージョン、出力系統のチップ（`source-status`の状態とデバイス名）、レイアウト編集・設定・ボーダレスフルスクリーンのボタン（読み上げ用の名前つき）
  - 推奨: Sonnet・high以上
  - 依存: T1-6, T2-5
  - 画面: S01
  - ボタンの動作は、設定がPhase 4、全画面がPhase 4、レイアウト編集がPhase 5でつなぐ
- [ ] T2-13 【エージェント】状態の表示（S01b 無音、S01c 入力源が使えない＋再試行、S01d 起動中・切り替え中）を作る
  - 推奨: Sonnet・high以上
  - 依存: T2-5, T2-12
  - 画面: S01b, S01c, S01d
  - S01cの「設定」ボタンは、設定パネルを作るPhase 4でつなぐ
- [ ] T2-14 【エージェント】メーター画面（タイトル帯、格子、状態の表示）を`App.vue`に組み立て、起動と同時に取得を始める
  - 推奨: Opus・high以上
  - 依存: T2-8, T2-9, T2-10, T2-11, T2-12, T2-13
  - 画面: S01

## Phase 3: 既定のモジュール一式（スペクトラム・位相・スペクトログラム・ラウドネス）

Phaseの推奨: Opus・high以上

- [ ] T3-1 【エージェント】スペクトラム（対数の帯域）、位相（リサージュの点列、帯域ごとの定位）、ラウドネスの近似（LOUDとピーク）の解析を作る
  - 推奨: Opus・high以上
  - 依存: T2-3
- [ ] T3-2 【エージェント】スペクトラムのモジュールを作る。線＋塗り（既定）・バー・鏡写し・円形と、ピークの残像
  - 推奨: Sonnet・high以上
  - 依存: T2-7, T3-1
  - 画面: S01, S05
- [ ] T3-3 【エージェント】位相のモジュールを作る。リサージュ（線＋点描、強調はなし／大きく／明るく／両方）と周波数別の定位（モーションブラー）。既定のインスタンスに、周波数別の定位の2つ目を専用の位置で加える
  - 推奨: Opus・high以上
  - 依存: T2-7, T2-9, T3-1
  - 画面: S01, S08
- [ ] T3-4 【エージェント】スペクトログラムのモジュールを作る
  - 推奨: Sonnet・high以上
  - 依存: T2-7, T3-1
  - 画面: S01
- [ ] T3-5 【エージェント】ラウドネス（表示名LOUD）のモジュールを作る。ライトテーマでは数値の文字を`--color-text`にする（SPEC 9節）
  - 推奨: Sonnet・high以上
  - 依存: T2-7, T3-1
  - 画面: S01
- [ ] T3-6 【エージェント】走査線と周辺減光のオーバーレイを作る（`display.scanline`の既定値オンで表示。切り替えUIはPhase 4）
  - 推奨: Sonnet・high以上
  - 依存: T2-14
  - 画面: S01
- [ ] T3-7 【エージェント】開発用のギャラリーに、各モジュールの表示方式（スペクトラムの4方式、波形の履歴の色、位相の表示方式と点描、周波数別の定位のモーションブラーのオン／オフ）を並べる
  - 推奨: Sonnet・medium以上
  - 依存: T1-6, T2-11, T3-2, T3-3
  - 画面: S05, S06, S08

## Phase 4: 設定パネルと保存・ウィンドウ

Phaseの推奨: Opus・high以上

- [ ] T4-1 【エージェント】`settings_store`を作る。`state.json`の読み書き（一時ファイルからの置き換え）、`schema`の確認と移行、読めないときの退避と既定の状態での起動、`load_state`・`save_state`
  - 推奨: Opus・high以上
  - 依存: T2-5
- [ ] T4-2 【エージェント】UIのストア（`useConfigStore`・`useRuntimeStore`）を作る。初回の既定の状態（保存済みの構成「既定」）、変更の自動保存（間を置いて保存）、起動時の復元
  - 推奨: Opus・high以上
  - 依存: T2-9, T4-1
- [ ] T4-3 【エージェント】設定パネル（S02）を作る。構成の欄（使用中の構成の名前と「保存後に変更あり」）、入力源（出力音声・出力デバイスの選択、入力デバイスは「今後対応」で無効）、テーマ（ダーク／ライト／OS設定）、配色の欄、レイアウトの欄、表示（走査線、常に最前面、起動時にボーダレスフルスクリーン）
  - 推奨: Opus・high以上
  - 依存: T1-6, T4-2
  - 画面: S02
  - 「構成を管理」「名前を付けて保存」「配色を管理」はPhase 7、「レイアウトを編集」はPhase 5でつなぐ
- [ ] T4-4 【エージェント】テーマ（`data-theme`の付け外しと、Canvasの色の読み直し）と走査線の切り替えを設定につなぐ
  - 推奨: Sonnet・high以上
  - 依存: T3-6, T4-3
- [ ] T4-5 【エージェント】入力源のデバイスの切り替えを設定につなぎ（`select_output_device`、`source.deviceId`の保存、切り替え中のS01d）、タイトル帯の設定ボタン・出力系統のチップと、S01cの「設定」ボタンから設定パネルを開けるようにする
  - 推奨: Opus・high以上
  - 依存: T2-13, T4-3
  - 画面: S01, S01c, S01d, S02
- [ ] T4-6 【エージェント】ウィンドウを扱う。ボーダレスフルスクリーンの切り替えとボタンのアイコンの変更、`tauri-plugin-window-state`（全画面の状態は記憶しない）、常に最前面、起動時にボーダレスフルスクリーン
  - 推奨: Sonnet・high以上
  - 依存: T2-12, T4-3
  - 画面: S01, S01a

## Phase 5: レイアウト編集

Phaseの推奨: Opus・high以上

- [ ] T5-1 【エージェント】手動配置の操作を純粋関数で作る。移動・大きさ変更・境界線の移動（両側を同時に）・矢印キーで1マス・1マス未満にしない規則・自動から手動への固定・空きを探して置く規則（imple 5.2の6）
  - 推奨: Opus・high以上
  - 依存: T2-9
- [ ] T5-2 【エージェント】推奨の形との適合判定（適／もっと細長く／向きと枠が逆／もっと正方形に／もっと縦長に）を純粋関数で作る
  - 推奨: Sonnet・high以上
  - 依存: T2-7
- [ ] T5-3 【エージェント】レイアウト編集のモードを作る。タイトル帯のボタンと設定の「レイアウトを編集」から入る、格子の表示、ドラッグでの移動・右下の角での大きさ変更・境界線の移動（マウスと矢印キー）、選択中、自動配置／手動配置のバッジ、「自動整列」「完了」、操作の説明
  - 推奨: Opus・high以上
  - 依存: T4-3, T5-1
  - 画面: S03
- [ ] T5-4 【エージェント】編集中のモジュールの見出しを作る。つまみ、名前と番号、適合判定のバッジ（ライトでは文字を`--color-text`）、流れる方向の矢印
  - 推奨: Sonnet・high以上
  - 依存: T5-2, T5-3
  - 画面: S03
- [ ] T5-5 【エージェント】置いたモジュールの一覧を作る。追加（種類を選ぶ）・複製・削除・有効／無効のスイッチ
  - 推奨: Opus・high以上
  - 依存: T5-1, T5-3
  - 画面: S03
- [ ] T5-6 【エージェント】編集を終えたときの見え方（S03a）を整える
  - 推奨: Sonnet・high以上
  - 依存: T5-3, T5-4, T5-5
  - 画面: S03a

## Phase 6: インスタンスの設定

Phaseの推奨: Opus・high以上

- [ ] T6-1 【エージェント】インスタンスの設定（ポップオーバー）を作る。モジュールの横に開き×で閉じる。共通の項目（入力源は既定の1系統と注記、配色、流れるモジュールの速さ×0.25〜×3.00）
  - 推奨: Opus・high以上
  - 依存: T1-6, T5-3
  - 画面: S03
- [ ] T6-2 【エージェント】種類ごとの項目をつなぐ。波形（チャンネル、今の波形を表示、履歴と今の波形の境目、履歴の色）、スペクトラム（表示方式、ピークの残像）、位相（表示方式、点描、モーションブラー）
  - 推奨: Sonnet・high以上
  - 依存: T2-11, T3-2, T3-3, T6-1
  - 画面: S03
- [ ] T6-3 【エージェント】「既定に戻す」を作る（方向・配色・種類ごとの設定を戻し、配置と入力源は残す）
  - 推奨: Sonnet・high以上
  - 依存: T6-1
  - 画面: S03
- [ ] T6-4 【エージェント】編集中のモジュールの見出しに歯車ボタンを加え、インスタンスの設定を開けるようにする
  - 推奨: Sonnet・medium以上
  - 依存: T5-4, T6-1
  - 画面: S03

## Phase 7: 配色と構成

Phaseの推奨: Opus・high以上

- [ ] T7-1 【エージェント】自分で作った配色からライト用の色を自動で作る関数を作る（OKLCHで暗く・彩度を落とし、ライトの地の色に対して4.5:1以上にする）
  - 推奨: Opus・high以上
  - 依存: T2-7
- [ ] T7-2 【エージェント】配色の管理（S02a）を作る。標準（編集不可・複製できる）と自分で作った配色の一覧、作成、名前と主色・副色・強調色の編集、削除（使っていたインスタンスは既定の配色に戻す）。インスタンスの設定の配色の選択肢に、自分で作った配色を加える
  - 推奨: Opus・high以上
  - 依存: T4-3, T6-1, T7-1
  - 画面: S02a, S03
- [ ] T7-3 【エージェント】構成の操作をストアに作る。名前を付けて保存、上書き、切り替え（変更があるときは上書き・別名で保存・破棄を確認）、複製、削除（使用中は不可）、変更ありの判定
  - 推奨: Opus・high以上
  - 依存: T4-2
- [ ] T7-4 【エージェント】構成の管理（S02b）を作る。一覧（名前、配置の種類・モジュール数・保存日を`Intl`で整形）、使用中の表示、切り替え・複製・削除、書き出し・読み込み（`tauri-plugin-dialog`・`tauri-plugin-fs`、権限は選んだパスに限る、`validate_config_file`での検証）
  - 推奨: Opus・high以上
  - 依存: T4-1, T7-3
  - 画面: S02b
- [ ] T7-5 【エージェント】設定パネルの「構成を管理」「名前を付けて保存」「配色を管理」をつなぐ
  - 推奨: Sonnet・medium以上
  - 依存: T7-2, T7-4
  - 画面: S02

## Phase 8: 追加のモジュール（VU・クロマ・重心と変化量）

Phaseの推奨: Opus・high以上

- [ ] T8-1 【エージェント】VU、クロマ（12音名、コードとキーの推定、時間方向の平滑化）、重心とフラックスの解析を作る
  - 推奨: Opus・high以上
  - 依存: T3-1
- [ ] T8-2 【エージェント】VUメーターのモジュールを作る（L・Rの2本の針、振れた跡の残像。初期状態は無効）
  - 推奨: Sonnet・high以上
  - 依存: T2-7, T8-1
  - 画面: S03, S07
- [ ] T8-3 【エージェント】クロマのモジュールを作る（音名の円環、根音を強調色、中央に今のコードとキー。初期状態は無効）
  - 推奨: Sonnet・high以上
  - 依存: T2-7, T8-1
  - 画面: S07
- [ ] T8-4 【エージェント】重心と変化量のモジュールを作る（重心の推移の線、変化量の棒、今の値、流れる方向と速さ。初期状態は無効）
  - 推奨: Sonnet・high以上
  - 依存: T2-7, T6-1, T8-1
  - 画面: S07
- [ ] T8-5 【エージェント】開発用のギャラリーに、追加のモジュールを並べる
  - 推奨: Sonnet・medium以上
  - 依存: T3-7, T8-2, T8-3, T8-4
  - 画面: S07

## Phase 9: 負荷の確認とリリースのワークフロー

Phaseの推奨: Opus・xhigh以上

- [ ] T9-1 【エージェント】全モジュールを有効にした状態で、CPU・GPUの使用率と1フレームの描画時間を測り、重いモジュールを軽くする（必要ならそのモジュールだけWebGLへ移す案を報告する）
  - 推奨: Opus・xhigh以上
  - 依存: T8-5
- [ ] T9-2 【エージェント】`.github/workflows/release.yml`を作る（`v*`タグのpushで起動、`bun run check`、tauri-actionでWindows x64のインストーラーをビルドし、GitHub Releasesにドラフトを作る）
  - 推奨: Opus・high以上
  - 依存: T1-8
- [ ] T9-3 【エージェント】`CONTRIBUTING.md`に、ビルドとリリースの手順を追記する
  - 推奨: Sonnet・medium以上
  - 依存: T9-2

## Phase 10: 初回リリースの準備（0.1.0）

Phaseの推奨: Sonnet・high以上

- [ ] T10-1 【エージェント】`README.md`（日本語）を書き、主要画面のスクリーンショットを実物から撮って`docs/images/`に置く
  - 推奨: Sonnet・high以上
  - 依存: T9-1
  - 画面: S01
- [ ] T10-2 【エージェント】GitHubのAbout欄（説明文は英語、Webサイト、トピック）の文案を提示する
  - 推奨: Sonnet・high以上
  - 依存: T10-1
- [ ] T10-3 【エージェント】`CHANGELOG.md`（Keep a Changelog形式）に0.1.0を書き、`package.json`・`tauri.conf.json`・`Cargo.toml`のバージョンが`0.1.0`でそろっていることを確かめる
  - 推奨: Sonnet・high以上
  - 依存: T10-1
- [ ] T10-4 【エージェント】ローカルでビルドし、アイコン一式が`specs/`の最新のマスターSVGから生成されたものであることを確かめる。`roadmap/timeline.md`にリリース準備の行（`0.1.0`と、その時点のプランアセットの版）を追記し、コミットメッセージとタグ作成・pushのコマンドを提示して停止する
  - 推奨: Sonnet・high以上
  - 依存: T9-2, T10-3
  - pushの前にバージョンを変えた場合は、timelineに新しい行を追記する（過去の行は書き換えない）
- [ ] T10-5 【ユーザー】コミット・`v0.1.0`タグの作成・pushを行い、GitHub Releasesにドラフトができたことを確かめる。About欄を設定する
  - 依存: T10-2, T10-4

## Phase 11: 公開

- [ ] T11-1 【ユーザー】ドラフトリリースを公開する
  - 依存: T10-5
