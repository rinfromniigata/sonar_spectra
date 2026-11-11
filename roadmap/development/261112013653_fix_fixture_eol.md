# fix：CIで、テスト用の見本がCRLFになって単体テストが失敗する

- 種別：軽微な修正（要件・設計・インターフェース・タスク構成・プランアセットの確定事項は変えない）
- きっかけ：ユーザーの指摘（T10-3の後。b53b032以降のCIがすべて失敗していた）
- 関連タスク：T7-6、W7-7（テストを足したコミット b53b032）、T10-4（リリースのワークフローも同じ`bun run check`を呼ぶ）

## 内容

b53b032（W7-7）から、GitHub Actionsの`CI`が7回続けて失敗していた。失敗は毎回同じ1件で、`bun run check:unit`の`src/config/config_flow.test.ts`の「共有の見本（構成ファイル）> 見本の構成を書き出すと、見本と同じ本文になる」。

```
expected '{\n  "format": "sonar_spectra.config"…' to be '{\r\n  "format": "sonar_spectra.confi…'
```

このテストは、`src-tauri/src/settings_store/fixtures/config_file_v2.json`を`?raw`で読み、UIが書き出した本文と文字列で比べる。手元では見本がLFで取り出されるため通るが、CIのWindowsランナーは、`core.autocrlf`の既定でCRLFに変換して取り出すため、本文が食い違う。

`bun run check`は`&&`でつないでいるため、`check:unit`で止まり、そのあとの`check:rust`（clippyと`cargo test`）は、b53b032以降のCIで1度も実行されていなかった。

## 修正

- `.gitattributes`を足し、`src-tauri/src/**/fixtures/*.json`を`text eol=lf`にした（`git check-attr`と`git ls-files --eol`で、3つの見本に当たることを確かめた）。チェックアウトの改行の設定によらず、LFで取り出される
- テストは変えない（バイト単位で比べるテストの意図を残すため）

## 理由

見本を持つ側（リポジトリ）で改行を固定するのが原因に近く、比べる側のテストに改行の正規化を足すより、ほかの見本にも効く。

## 補足

- CI上での通過は、このコミットをpushしたあとのCIで確かめる。手元では、Windowsのランナーの改行の変換を再現していない
- `check:rust`は、前述のとおり長くCIで実行されていない。通ったあとにここで失敗したら、別の問題として扱う
- リリースのタグをpushする前に、CIが通ることを確かめる（`release.yml`も同じ`bun run check`を実行するため、失敗するとドラフトが作られない）
