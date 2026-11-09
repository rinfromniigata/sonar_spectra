# 改訂後のルールに合わせた推奨の見直し（Phase 8〜10の未着手項目）

- 種別: fix（Phaseの外。推奨の見直しは進捗記録の一部として承認不要）
- 対象: `roadmap/planning_dialog/261109115345_tasks_sonar_spectra_initial.md`、`roadmap/planning_dialog/261109115345_walk_sonar_spectra_initial.md`

## 内容

- `Phaseの推奨`と同じ`推奨:`の行を削除した：T8-1、W8-1（Opus・high）、T9-1（Opus・xhigh）、T10-1〜T10-4（Sonnet・high）
- T9-2（`release.yml`の作成）の推奨を`Opus・high以上`から`Sonnet・high以上`に下げ、見直しの理由を1行添えた

- 261109191420 追記：walkのPhase 8を、改訂後の順序（checkコマンド → モックとの照合 → 判断を要する検証 → ユーザーの確認）に並べ替えた。旧W8-1〜W8-4の位置には移動先を1行で残し、新しいIDを振った
  - W8-5：`bun run check`が通る（旧W8-3から分離。Sonnet・low以上）
  - W8-6：モックとの構造の照合（新規。画面 S03, S07。Sonnet・high以上）
  - W8-7：旧W8-1（解析の単体テスト）、W8-8：旧W8-2（初期状態と有効化）、W8-9：旧W8-3の疑似ロケールの確認、W8-10：旧W8-4（ユーザーの確認）
  - タスク構成の変更に当たるが、ルール改訂に伴う移行として、ユーザーの指示でfixとして扱った（プランアセットの版は上げない）

## 理由

改訂後のルールで、【エージェント】の項目の`推奨:`の行は`Phaseの推奨`と異なる場合だけ書くことになり、Coding固有の目安に「CIのワークフローの作成: Sonnet・high以上」が加わったため。また、各Phaseのwalkは、checkコマンドを先頭に置き、モックとの照合をPhaseごとに1回置く形になったため。完了済みの項目（Phase 1〜7）は変えていない。IDと順序も変えていない。
