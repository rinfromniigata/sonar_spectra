# change：macOSに対応し、0.2.0として配布する（claude.aiの改訂版プランアセット v6の取り込み）

- 種別：仕様変更（要件・設計・インターフェース・タスク構成・プランアセットの確定事項〔画面構成にS09・S09a・S09bを足す、アイコンの`.icon`をスコープに入れる〕を変える）
- 状態：**承認済み（261113）**。ユーザーの回答は、点1「問題ありません」、点2「Xcodeのインストールはそれまでの作業中に裏で進めておきます」、点3「実機で確認します」（(a)）
- 反映（261113032529）：specsをv6に、imple・tasks・walkを`261113032529_*`にした。下の案から次を詰めた
  - 点2により、Xcodeのインストールを`.icon`の作成と分けてT14-2（Phase 12から裏で進めてよい）にし、`.icon`の作成をT14-3、組み込みをT14-4にした
  - 点3の(a)により、Windowsの実機での確認をW16-4（ドラフトのインストーラーを0.1.0の上から入れる）として足した。W16-3はmacOSの`.dmg`の確認
  - Phase 13のwalkは、【ユーザー】の実機の確認をW13-3の1項目にまとめた。モックとの照合（W13-2）は、S09・S09a・S09bに加え、v5の11節から取り込まれたS01e・S02も対象にした
- 発端：ユーザーがルートに改訂版プランアセット（`sonar_spectra_SPEC.md`・`_brand.md`・`_icon_master.svg`・`_mock.html`・`_tokens.css`。版番号なし）を置いた（261113）。SPEC冒頭の「v6」の記述が変更サマリー

## 改訂版の内容（v5との差分を`diff`で確かめた結果）

- **SPEC**：macOS（Apple Silicon、macOS 26以降）への対応を足した
  - 2節：「macOS（S09、S09a、S09b）」の節を新設（信号機ボタンをタイトル帯に重ねる、ドラッグとダブルクリック、新しい操作スペースを作らない全画面、システムオーディオ録音の許可がないときの表示、最小限のアプリメニューと「編集」メニュー）。S01e（描画を開始できないとき）を本文に取り込んだ。S02の上書き保存とフレームレートの上限の記述を本文に詰めた（中身はv5の11節と同じ）
  - 3節：macOSでの負荷の確かめ方（M1・8GB、リリースビルド、全モジュール、内蔵ディスプレイの全画面、上限60fpsに届く、VJツールと30分、メモリプレッシャーが黄色にならない）と、App Napで間引かれないこと。データの保存場所にmacOSを足した。既知の制限にアドホック署名による許可の与え直しを足した
  - 4節：`cpal` 0.18.2（Process Tap）、Tauriの`titleBarStyle: Overlay`・`trafficLightPosition`・`set_simple_fullscreen`、Icon Composerの`.icon`（Xcode 26以降の`actool`が要る）。バンドルの設定（`minimumSystemVersion` 26.0、`aarch64-apple-darwin`だけ、`NSAudioCaptureUsageDescription`の文言は原文の辞書から）
  - 5節：入力源にmacOSの実装と「OSの許可がない」理由を足し、層に「ウィンドウとOSの差（platform）」を足した。タイトル帯がOSの種類で余白とつかみを持つ
  - 6節：画面ID S01e・S09・S09a・S09bを足した。`.icon`の作り方（レイヤーのSVGを`docs/brand/icon_layers/`へ、`AppIcon.icon`は利用者が作り`bundle.icon`に加える）を確定事項に書いた。信号機ボタンの正確な位置は委任事項
  - 7節：macOSの`.dmg`（Xcode 26以降のランナー）、`0.2.0`、macOSはアドホック署名だけ（READMEとCHANGELOGに開き方と許可の与え直しを書く）
  - 8節：「Macへの対応」「`.icon`の作成」をスコープ外から外し、Intel Mac・macOS 25以前・Developer ID署名と公証・Windowsのタイトルバーの変更・Windowsの負荷テストのやり直しをスコープ外に足した
  - 9節：0.2.0に向けて決めたこと（版番号、署名、取得方式、対象、全画面の方式）
  - 11節「モックとの差分」：モックに取り込まれて消えた
- **mock**：S01e・S09・S09a・S09bの画面を足し、S02に構成の3ボタンとフレームレートの上限を描いた。辞書に`perm.*`・`source.chip_perm`・`source.chip_loopback_mac`・`app.version`（v0.2.0）などが増えた。1枚の`mock.html`の旧形式のまま
- **tokens.css・brand.md・マスターSVG**：v5と内容が同じ（`diff`で差分なし）

## 解析で分かったこと・確かめたいこと

- **開発機**：このMac（MacBook Air M1・8GB、macOS 27.2.1）。Xcodeは入っておらず、Command Line Toolsだけ（`actool`がない）。Icon Composerは入っている。RustはHomebrewの1.99.1（rustupなし。対象はこの機と同じ`aarch64-apple-darwin`だけなので支障はない）
  - `.icon`を含むビルド（`actool`で`Assets.car`を作る）を手元で確かめるには、Xcode 26以降が要る → 【ユーザー】の項目にする
- **今のコード**：入力源はWindowsのWASAPIだけで、ほかのOSでは常に「使えない」を返す`UnsupportedSource`に落ちる（`src-tauri/src/audio_source/unsupported.rs`）。全画面は`@tauri-apps/api`の`setFullscreen`。CIとリリースはWindowsのランナーだけ。`state.json`は`app_data_dir()`を使っているので、macOSの保存場所はSPECのとおりになる見込み（確かめる）
- **許可がないことを見分けられるか（技術的な不確かさ）**：Process Tapで、システムオーディオ録音が許可されていないときに、エラーとして返るのか、無音のサンプルが来るだけなのかは、まだ確かめていない。無音が来るだけで、公開APIで許可の状態を調べられない場合は、S09b（許可がない）とS01b（無音）を見分けられない。最初の項目（T12-1）で確かめ、見分けられないと分かったら、その時点で出し方を仕様変更として相談する
- **Windowsの確認**：開発機がMacになったため、Windowsの動作を実機で確かめられるかが分からない（「承認していただきたい点」の3）

## 変更内容

### imple（新しいタイムスタンプで作る）

- 1節：「Macの取得方式は入力源の実装を足すだけで済むようにする」を、実装した形に改める。OSの差は`platform`に閉じ込める方針を足す
- 2節：`audio_source/`にmacOSの実装（`cpal`のループバック）、`platform/`（Rust）を足す。`docs/brand/icon_layers/`、`src-tauri/AppIcon.icon`（置き場所は委任事項）、`tauri.macos.conf.json`（macOSだけの設定）を足す
- 3.1：`CoreAudioTap`（仮名）を`#[cfg(target_os = "macos")]`で足し、`default_source`がOSに合うものを返す。`UnavailableReason`に`PermissionDenied`を足す。`cpal`はmacOSのときだけの依存にする
- 3.5：`get_platform() -> "windows" | "macos" | ...`、`open_privacy_settings()`（S09b）、`set_simple_fullscreen(bool)`（S09a）を足す。イベント`source-status`の理由に`permission_denied`が増える
- 3.6（新設）：platform。タイトルバー（`titleBarStyle: Overlay`・`hiddenTitle`・`trafficLightPosition`。macOSだけ）、全画面の方式（macOSは`set_simple_fullscreen`、Windowsは今のまま）、メニュー（アプリメニュー・「編集」）、システム設定を開く、App Napの抑止
- 4.5：タイトル帯（S09：信号機ボタンの分の余白、`data-tauri-drag-region`、ダブルクリック）、S09aでは余白をなくし信号機ボタンを出さない、S09b（`StatusOverlay`に許可がないときの表示。中央の表示の出し分けでは、S01cと同じ「使えない」の側に入れる）、出力系統のチップのmacOSの文言（`source.chip_loopback_mac`・`source.chip_perm`）
- 4.8：CIの`ci.yml`をWindowsとmacOSの2つのランナーで回す（OSごとの条件付きコンパイルの両方を`clippy`と`test`にかける）。`Info.plist`の`NSAudioCaptureUsageDescription`が辞書の文言と一致することを自動検査に足す（作り方は委任事項）
- 6節：macOS（Apple Silicon）の`.dmg`をアドホック署名で作る。最低バージョン26.0。リリースのワークフローにmacOSのジョブ（Xcode 26以降のランナー）を足す
- 7節：レイヤーのSVGの書き出し（`bun run icons`に足す）と、`AppIcon.icon`の組み込み、`.icns`のフォールバックを残す
- 負荷の計測（macOS）：WebView2のリモートデバッグの代わりに、ページ内の計測（描画の回数と時間）と、アクティビティモニタ（CPU・GPU・メモリプレッシャー）で測る

### tasks・walk（新しいタイムスタンプで作る）

Phase 1〜11は、IDとチェック状態と実施メモをそのまま引き継ぐ。Phase 12からを足す（推奨は案）。

- **Phase 12: macOSでの出力音声の取得**（Phaseの推奨: Opus・high以上）
  - T12-1 【エージェント】`cpal` 0.18.2のループバックのAPI、許可がないときの振る舞い（エラーか無音か、調べる手段があるか）、Tauri 2.12の`set_simple_fullscreen`・`titleBarStyle`・`trafficLightPosition`・`.icon`の対応を、インストール済みの版と公式ドキュメントで確かめ、小さな試作で許可の振る舞いを実機で確かめて報告する（見分けられなければ仕様変更として相談）
  - T12-2 【エージェント】`UnavailableReason::PermissionDenied`を足し、イベントとUIの型まで通す（表示はPhase 13）
  - T12-3 【エージェント】macOSの入力源（`cpal`のProcess Tap）を実装する（既定の出力デバイス、デバイスの一覧と切り替え、ステレオ・f32へのそろえ、無音の判定、切断・既定の変更での開き直し、許可がないときの通知）。テストを足す
  - T12-4 【エージェント】macOSのバンドルの設定（`tauri.macos.conf.json`：最低バージョン26.0、`Info.plist`の`NSAudioCaptureUsageDescription`を辞書の文言から）と、その一致の自動検査
    - 推奨: Sonnet・high以上
  - T12-5 【エージェント】`ci.yml`にmacOSのランナーのジョブを足す
    - 推奨: Sonnet・high以上
  - walk：W12-1 checkコマンドが通る（Sonnet・low以上）／W12-2 【エージェント】開発用のビルドで、このMacの出力音声（`afplay`で鳴らした見本）が取得でき、無音・デバイスの切り替えで状態が変わる／W12-3 【ユーザー】初回の許可の確認が出て、許可するとすぐ表示され、出力デバイス（内蔵スピーカー・ヘッドホンなど）を切り替えても追従する／W12-4 【ユーザー】CIのmacOSのジョブが通る
- **Phase 13: macOSのウィンドウ・許可の表示・メニュー**（Phaseの推奨: Sonnet・high以上）
  - T13-1 【エージェント】platform（Rust）：OSの種類のコマンド、タイトルバーのOverlayと信号機ボタンの位置、`set_simple_fullscreen`、システム設定を開く、App Napの抑止
    - 推奨: Opus・high以上
  - T13-2 【エージェント】タイトル帯をOSの種類で切り替える（S09：余白、つかみ、ダブルクリック。出力系統のチップのmacOSの文言）
    - 画面: S09
  - T13-3 【エージェント】macOSの全画面を`set_simple_fullscreen`に切り替え、全画面では信号機ボタンを出さない（S09a）。Windowsは今のまま
    - 画面: S09a
  - T13-4 【エージェント】許可がないときの表示（S09b。「システム設定を開く」「再試行」）と、中央の表示の出し分けへの組み込み。辞書に`perm.*`などを足す
    - 画面: S09b, S01e
  - T13-5 【エージェント】メニューバー（アプリメニュー・「編集」メニュー。名前の入力欄で標準のショートカットが効く）
  - walk：W13-1 checkコマンドが通る／W13-2 【エージェント】S09・S09a・S09bと、v5の11節から取り込まれたS01e・S02（構成の3ボタン・フレームレートの上限）が、モックと構造で一致する（Sonnet・high以上。S01e・S02は実装済みのものの照合だけ）／W13-3 【ユーザー】信号機ボタンの位置・ドラッグ・ダブルクリック、全画面（複数ディスプレイがあれば別のディスプレイでも）、許可を取り消してS09b→「システム設定を開く」→許可→「再試行」、メニューとショートカット
- **Phase 14: Apple環境向けアイコン**（Phaseの推奨: Sonnet・high以上）
  - T14-1 【エージェント】マスターSVGの前景（`01_ring`〜`03_peak`）を、レイヤーごとのSVGとして`docs/brand/icon_layers/`に書き出す（`bun run icons`に足す）
    - 推奨: Sonnet・medium以上
  - T14-2 【ユーザー】Xcode 26以降を入れる（`actool`のため）。レイヤーのSVGと`brand.md`の「Apple環境向けアイコン」から、Icon Composerで`AppIcon.icon`を作り、エージェントが示す場所に置く
  - T14-3 【エージェント】`.icon`をビルドに組み込み、`.icns`のフォールバックを残す
  - walk：W14-1 checkコマンドが通る／W14-2 【エージェント】ビルドした`.app`に`.icon`由来の`Assets.car`と`.icns`があり、`.icon`内のレイヤーのSVGが`docs/brand/icon_layers/`と一致する／W14-3 【ユーザー】Dock・Finderで、既定・ダーク・Clear・Tintedの各モードの見え方を確かめる
- **Phase 15: macOSでの負荷と動作の継続**（Phaseの推奨: Opus・high以上）
  - T15-1 【エージェント】リリースビルド（`.icon`入り）を内蔵ディスプレイの全画面に出し、全モジュールで描く回数と1回の時間を測る。上限60fpsに届かなければ原因を調べ、Windowsの処理を変えない範囲で軽くする（届かないときの上限の初期値の変更などは仕様変更として相談）
  - T15-2 【エージェント】VJツールを前面にしたとき、App Napなどで取得と描画が間引かれないことを測って確かめる
  - walk：W15-1 checkコマンドが通る／W15-2 【エージェント】計測の結果が3節の基準を満たす／W15-3 【ユーザー】VJツールと同時に30分動かし、カクつき・ずれ・VJツール側の重さが気にならず、メモリプレッシャーが黄色にならない
- **Phase 16: 0.2.0のリリースの準備**（Phaseの推奨: Sonnet・high以上）
  - T16-1 【エージェント】`release.yml`にmacOS（Apple Silicon、`.dmg`、アドホック署名、Xcode 26以降のランナー）のジョブを足す
  - T16-2 【エージェント】READMEにmacOSの入手方法・動作環境・初回の開き方・許可の与え直しを書き、`CONTRIBUTING.md`にmacOSの開発環境（Xcode、`bun run icons`のレイヤーの書き出し）を書く。必要ならmacOSのスクリーンショットを足す
  - T16-3 【エージェント】GitHubのAbout欄の文案を見直す（説明文の「on Windows」、トピック）
  - T16-4 【エージェント】`CHANGELOG.md`に0.2.0を書き、バージョン表記を`0.2.0`にそろえる
  - T16-5 【エージェント】ローカルでmacOSのビルドを確かめ、アイコン一式と`.icon`のレイヤーが最新のマスターから作られたことを確かめ、`timeline.md`にリリース準備の行を追記し、コミットメッセージとタグ・pushのコマンドを提示して停止する
  - T16-6 【ユーザー】コミット・`v0.2.0`タグ・push、ドラフトにWindowsのインストーラーとmacOSの`.dmg`がそろったことを確かめ、About欄を設定する
  - walk：W16-1 【エージェント】バージョン表記・CHANGELOG・timelineの確認／W16-2 【ユーザー】READMEを利用者の立場で読む／W16-3 【ユーザー】ドラフトの`.dmg`を入れ、READMEどおりの開き方と許可で表示されること（Windowsの確認は「承認していただきたい点」の3による）
- **Phase 17: 公開**
  - T17-1 【ユーザー】ドラフトリリースを公開する／W17-1 【ユーザー】公開したページから両OSのファイルを入手でき、READMEのリンクが切れていない

### specs・timeline

- v5の全ファイルを`archived/`へ移し、ルートの改訂版を`_v6`を付けて`specs/`へ移す（5ファイルとも。tokens・brand・マスターSVGは内容が同じまま版番号だけ上がる）
- `src/theme/tokens.css`・`docs/brand/brand.md`・`docs/brand/icon_master.svg`は、v6と内容が同じなので変えない（`diff`で確かめる）
- `timeline.md`に「プランアセット v6：macOS（Apple Silicon、macOS 26以降）に対応し、0.2.0として配布する。claude.aiの改訂版を取り込み ← development/261113031351_change_macos_support.md」の行を足す

## 影響するドキュメントと項目

- `specs/`：全ファイルをv6に（v5は`archived/`へ）
- `planning_dialog/`：imple・tasks・walkを新しいタイムスタンプで作り、旧版を`archived/`へ移す
- `timeline.md`：プランアセット v6の行
- コード（Phase 12以降）：`src-tauri/src/audio_source/`、`src-tauri/src/`の新しい`platform`、`commands.rs`、`lib.rs`、`Cargo.toml`、`tauri.conf.json`と`tauri.macos.conf.json`、`src/window/`、タイトル帯・`StatusOverlay`・`MeterScreen`まわり、`src/i18n/locales/ja.ts`、`scripts/generate_icons.ts`、`.github/workflows/`、README・CONTRIBUTING・CHANGELOG
- 完了済みの項目（Phase 1〜11）：変更なし

## 承認していただきたい点

1. 上の変更内容（v6の取り込み、imple・tasks・walkの改訂、Phase 12〜17の構成と順序）で進める
2. Phase 14でXcode 26以降を入れる作業（数十GB）を【ユーザー】の項目にする。入れない場合は、`.icon`入りのビルドをCI（macOSのランナー）だけで確かめる形に組み替える
3. Windowsの確認の扱い。どちらかを選ぶ
   - **(a)** Windowsの実機が使える：W16-3に、Windowsのインストーラーを入れて従来どおり動くことの確認（SmartScreenからの開き方、起動するとすぐ表示される）を足す
   - **(b)** Windowsの実機は使えない：Windowsは、CIのWindowsのジョブ（`clippy`・`test`）とリリースのビルドが通ることだけで確かめる。Windows用の処理は条件付きコンパイルで分けて変えない
