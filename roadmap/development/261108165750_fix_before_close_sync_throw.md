# fix：Tauriの外で、閉じる前の見張りの失敗が捕まえられない（W4-4の検証中）

- 種別：軽微な修正（要件・設計・インターフェース・タスク構成・プランアセットの確定事項は変えない。Tauriの中での振る舞いは変わらない）
- 見つけた検証：W4-4（設定パネルのキーボード操作を、Edgeで実際に確かめている途中）
- 関連タスク：T4-2（閉じるときの保存）、T4-6（閉じる前の全画面の終了。`flush_on_close.ts`を`before_close.ts`に改めた）

## 内容

W4-4の検証で、開発サーバーのアプリをTauriの外（ブラウザ）で開くと、ページのエラーに、捕まえ損ねた例外（未処理）が1件あった。

```
TypeError: Cannot read properties of undefined (reading 'metadata')
    at getCurrentWindow
    at beforeClose (src/app/before_close.ts)
    at src/main.ts
```

`beforeClose`が`async`でない関数で、中の`getCurrentWindow()`はTauriの外では**同期的に**例外を投げる。`main.ts`の`beforeClose(...).catch(...)`（「Tauriの外では失敗を記録だけする」）は、返された約束の失敗しか捕まえられないため、同期の例外は素通りして未処理になっていた。画面を出したあとの処理で、Tauriの中では起きないため、利用者への影響はない（開発時にブラウザで開いたときのコンソールの汚れと、コメントの約束との食い違い）。

## 修正

- `src/app/before_close.ts`：`beforeClose`を`async`にした。同期の例外が、返す約束の失敗になり、呼び出し側の`.catch`に届く。理由をコメントに書いた
- `src/app/before_close.test.ts`：新規（3件）。ウィンドウを取れないとき、同期的に投げず失敗として返すこと／閉じる要求で後始末を待ってから進むこと／終わらなくても上限（1秒）で閉じ、後始末が失敗しても閉じること

## 確認

- 修正後、同じ操作でページの未処理の例外が0件になった
- `bun run check`は終了コード0で通った（UI 395件・Rust 114件）
