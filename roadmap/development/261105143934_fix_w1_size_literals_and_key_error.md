# fix：部品のサイズの直書き2件と、存在しないキーのエラー文（W1-2・W1-3の検証中）

- 種別：軽微な修正（要件・設計・インターフェース・タスク構成・プランアセットの確定事項は変えない）
- 見つけた検証：W1-2、W1-3
- 関連タスク：T1-4、T1-6

## 1. 部品のサイズの直書き（W1-2）

### 内容

W1-2で`src/theme/`以外のサイズの直書きを目で確かめたところ、px以外の単位で、モック由来の値が2件残っていた（`check:tokens`はpxと色だけを検出するため、自動検査では見つからなかった）。

- `src/components/ui/UiSlider.vue`：値の欄の最小幅`3.2em`
- `src/components/ui/UiPopover.vue`：最大の高さ`84%`

### 修正

`src/theme/component_metrics.css`に`--slider-value-min-width: 3.2em`と`--popover-max-height: 84%`を加え、2つの部品からはそれを参照するようにした。値と見た目は変わらない。

### 理由

部品の寸法は`component_metrics.css`に集める、というT1-6の方針にそろえるため。

## 2. 存在しないキーのエラー文（W1-3）

### 内容

W1-3で、存在しないキー（`t("title_bar.no_such_key")`）を一時的に入れたところ、`vue-tsc`は検出した。ただしエラー文が「Expected 2 arguments, but got 1」で、キーの誤りだと読み取りにくかった。キーの型が合わないとき、TypeScriptが型引数を`MessageKey`全体として推論し、プレースホルダのある辞書の文言に引きずられて引数の数を求めたため。

### 修正

`src/i18n/use_t.ts`の`Translate`の型を、キーを`string`で受けてから`MessageKey`に絞る形に変えた。

```ts
export type Translate = <K extends string>(
  key: K extends MessageKey ? K : MessageKey,
  ...args: K extends MessageKey ? MessageArgs<K> : []
) => string;
```

存在しないキー・末端でないキーは「Argument of type '"…"' is not assignable to parameter of type 'MessageKey'」と、キーの引数を指すエラーになった。プレースホルダの不足・名前違い・余分の検出は変わらないことを確かめた。`bun run check`は通る。

### 理由

検出の可否は変わらないが、誤りの場所と原因がエラー文から分かるようにするため。
