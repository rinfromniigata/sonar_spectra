# fix：`tsconfig.node.tsbuildinfo`を追跡対象から外す（W1-10の検証中）

- 種別：軽微な修正（要件・設計・インターフェース・タスク構成・プランアセットの確定事項は変えない）
- 見つけた検証：W1-10
- 関連タスク：T1-1（`tsconfig.node.tsbuildinfo`が追跡された`c23d2e3`の時点）

## 内容

W1-10でクローンした作業ツリーに、`tsconfig.node.tsbuildinfo`（TypeScriptのビルド情報）がGitの追跡対象として含まれていた。ビルドの副産物で、リポジトリに置く意味はない。

現在の`tsconfig.node.json`は`noEmit`で`composite`・`incremental`を使っておらず、`bun run check`を実行してもこのファイルは書き換わらない。以前の構成の名残だった。

## 修正

- `tsconfig.node.tsbuildinfo`を削除した（コミットすると追跡から外れる）
- `.gitignore`に`*.tsbuildinfo`を追加した
- `bun run check:types`が通ることを確かめた

## 理由

ビルドの副産物をリポジトリに入れないため。
