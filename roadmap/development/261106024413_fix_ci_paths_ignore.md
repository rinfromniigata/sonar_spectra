# fix：検査に関係しない変更だけのpushでCIを実行しない

- 種別：軽微な修正（要件・設計・インターフェース・タスク構成・プランアセットの確定事項は変えない）
- きっかけ：ユーザーの指摘（W1-10の後）
- 関連タスク：T1-8

## 内容

`.github/workflows/ci.yml`は`push`と`pull_request`に条件がなく、walkの更新など`roadmap/`だけを変えたpushでも、Windowsのランナーで`bun run check`を実行していた。

`bun run check`の各検査（型・ESLint・i18n・トークン・単体テスト・clippy・cargo test）は、`roadmap/`・`docs/`・Markdown・`LICENSE`を読まない（ESLintも`roadmap/**`と`docs/**`を除外している）。これらだけの変更では、検査の結果は変わらない。

## 修正

- `ci.yml`の`push`と`pull_request`に`paths-ignore`（`roadmap/**`・`docs/**`・`**/*.md`・`LICENSE`）を加えた。1回のpushにほかのファイルの変更が1つでも含まれれば、これまでどおり実行する
- `CONTRIBUTING.md`の「確認と検査」に、上記の変更だけでは実行しない旨を書き足した
- YAMLとして読めること（`on`の内容）を確かめた。CI上での動作は、次のpushで確かめる

## 理由

検査の範囲を変えずに、結果の変わらない実行を省くため。

## 補足

ブランチ保護でCIの通過を必須にした場合、除外された変更だけのプルリクエストは、保留のまま止まる。その場合は、必須の検査の扱いを見直す。
