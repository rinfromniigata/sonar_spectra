# sonar_spectra 実装設計（imple）

- 対象：`roadmap/specs/sonar_spectra_SPEC_v9.md` と同版のデザインアセット
- 種別：Agentic Coding
- 対になるドキュメント：`261113070449_tasks_sonar_spectra_initial.md`、`261113070449_walk_sonar_spectra_initial.md`
- 改訂：change「261113065821_change_app_display_name」を反映（プランアセット v9。アプリの表示名をSonar Spectraにし、Windowsで0.1.0から更新するときインストーラーが旧版を自動で取り除く：2節、6節）。前の版は`archived/261113063725_imple_sonar_spectra_architecture.md`（その前の改訂：change「261113063530_change_macos_title_double_click_and_esc」を反映（プランアセット v8。タイトル帯のダブルクリックは拡大・戻すだけ、Escで全画面を終える動きは求めない、T13-1〜T13-5で確かめた細部：3.6、4.5）。前の版は`archived/261113042452_imple_sonar_spectra_architecture.md`（その前の改訂：change「261113041903_change_macos_permission_and_tap」を反映（プランアセット v7。録音の許可を判定せずS09bを取りやめる、Process Tapと集約デバイスを自前で作りcpalで開く、T12-1で確かめた細部：2節、3.1、3.5、3.6、4.5、7節）。前の版は`archived/261113032529_imple_sonar_spectra_architecture.md`（その前の改訂：change「261113031351_change_macos_support」を反映（プランアセット v6。macOSへの対応：1節、2節、3.1、3.4、3.5、3.6〔新設〕、4.5、4.6、4.8、6節、7節。v5のSPEC 11節「モックとの差分」がモックに取り込まれたため、11節への参照を画面IDに改めた）。前の版は`archived/261111033238_imple_sonar_spectra_architecture.md`（その前の改訂：change「261111033031_change_render_unavailable_priority」を反映（4.5：描画を開始できない表示と、入力源の状態の表示〔S01b〜S01d〕の出し分け）。前の版は`archived/261110165456_imple_sonar_spectra_architecture.md`（その前の改訂：change「261110165301_change_glow_sharp_redraw」を反映（4.6の発光：等倍の図形は画像を写さず同じ頂点の範囲をもう一度描いて重ねる）。前の版は`archived/261110133636_imple_sonar_spectra_architecture.md`（その前の改訂：change「261110124814_change_frame_limit_and_webgl」を反映（1節、2節、3.4、4.2、4.5、4.6、4.8、5.1、5.2の16、5.3）。前の版は`archived/261109115345_imple_sonar_spectra_architecture.md`（その前の改訂：change「261109114953_change_config_name_unique_and_overwrite」））））））

## 1. 方針

- **音の流れに沿って層を分ける**：入力源 → 解析 → 送出 →（Channel）→ 受信 → モジュールの描画。各層は1つ前の層のインターフェースだけを知る。OSごとの取得方式（WindowsのWASAPI、macOSのProcess Tap）や将来の入力デバイスは、「入力源」の実装を足すだけで済むようにする
- **OSの差は2か所に閉じ込める**（v6）：音の取得の違いは「入力源」の実装に、ウィンドウ・メニュー・OSの設定画面・App Napの違いはRust側の`platform`に置く。UIは`get_platform`で受け取ったOSの種類でタイトル帯の形だけを変え、ほかの層はOSの違いを知らない。Windows用の処理は条件付きコンパイルで分け、v6で変えない
- **モジュールは登録制**：モジュールの種類ごとに「解析結果のどこを読むか・どう描くか・どんな設定を持つか」を1組にまとめ、レジストリに登録する。配置・設定パネル・レイアウト編集は、モジュールの中身を知らない
- **値はトークン経由のみ**：色・サイズ・余白・角丸・発光・モーションは`src/theme/tokens.css`のカスタムプロパティだけを参照する。描画（WebGL2の図形・Canvas 2Dの文字）で使う色も、描画時に`getComputedStyle`で読み出したトークンから取る（テーマ切り替えで読み直す）
- **図形はWebGL2、文字はCanvas 2D**（v4）：メーター全体を覆う1枚の共有のWebGL2キャンバスに、各モジュールが自分の枠の範囲だけに図形を描く。文字はモジュールの枠ごとのCanvas 2Dの層に描く。モジュールは「描くもの（図形・色・発光）を作る」だけで、WebGLを直接触らない（作る部分を単体テストで調べられるようにする）
- **文言は辞書経由のみ**：`vue-i18n`のComposition APIで、`src/i18n/locales/ja.ts`の型からキーの型を作る。直書きと文字列連結をしない
- **状態は1か所に集める**：UIの状態（構成・設定・編集中かどうか）はストアにまとめ、保存はRust側の`settings_store`に任せる。ルーターは使わない

## 2. リポジトリ構成

```
sonar_spectra/
├─ src/                         UI（Vue 3 + TypeScript）
│  ├─ main.ts
│  ├─ App.vue                   メーター画面を置き、ドロワー・編集モードを状態で切り替える
│  ├─ theme/
│  │  ├─ tokens.css             specs/ の tokens をコピー（値の正本の写し。編集しない）
│  │  ├─ fonts.ts               @fontsource の書体を同梱して読み込む
│  │  └─ canvas_colors.ts       トークンを読み出して Canvas 用の色を作る
│  ├─ i18n/
│  │  ├─ index.ts               createI18n、ロケールの判定・保持・フォールバック、<html lang> 更新
│  │  ├─ locales/ja.ts          原文の辞書（文言の正本）
│  │  └─ pseudo.ts              疑似ロケール（開発時のみ）
│  ├─ frame_client/             受信：バイト列 → 解析結果の型、最新値の保持
│  ├─ modules/                  モジュール（種類ごとにフォルダ）とレジストリ
│  ├─ layout/                   自動整列・手動配置（12×8の格子）
│  ├─ config/                   インスタンス設定・配色・構成・永続化の呼び出し
│  ├─ render/                   描画ループ（requestAnimationFrame、フレームレートの上限による間引き）、最小化時の停止
│  │  └─ gl/                    WebGL2の描画の層（共有キャンバス、図形の描画、発光、流れる画像、コンテキストの喪失）
│  ├─ components/               画面と基本部品
│  │  ├─ ui/                    ボタン、アイコンボタン、スイッチ、セグメント、スライダー、セレクト、配色の見本、チップ、ドロワー、ポップオーバー
│  │  └─ ...                    TitleBar、MeterGrid、ModuleFrame、StatusOverlay、SettingsDrawer など
│  └─ dev/                      開発時だけ使うギャラリー（部品の状態・各モジュールの表示方式）
├─ src-tauri/                   Rust
│  ├─ src/
│  │  ├─ main.rs / lib.rs       Tauri の組み立て、プラグイン登録、コマンド登録
│  │  ├─ audio_source/          入力源（trait と、WASAPI ループバック〔Windows〕・Process Tap〔macOS。集約デバイスを cpal で開く。v7〕の実装）
│  │  ├─ platform/              ウィンドウとOSの差（タイトルバー、全画面の方式、メニュー、App Nap の抑止。v6）
│  │  ├─ analysis/              解析（種類ごとのファイル）
│  │  ├─ frame_transport/       約60回/秒のまとめと、バイト列への符号化
│  │  ├─ settings_store/        設定と構成のJSON
│  │  └─ commands.rs            UI から呼ぶコマンド
│  ├─ icons/                    マスターSVGから形式ごとに展開したアイコン一式（リポジトリに含める。7節）
│  ├─ AppIcon.icon              Icon Composer で作った Apple 環境向けアイコン（利用者が作る。置き場所は T14-9 で決めて示す。v6）
│  ├─ Info.plist                macOS の Info.plist に足す項目（NSAudioCaptureUsageDescription。v6）
│  ├─ windows/hooks.nsh         Windows のインストーラー（NSIS）のフック。0.1.0（表示名 sonar_spectra）を取り除く（v9）
│  ├─ tauri.conf.json
│  └─ tauri.macos.conf.json     macOS だけの設定（タイトルバー、最低バージョン、署名。v6）
├─ scripts/                     i18n の自動検査、トークン直書きの検査、アイコンの展開（generate_icons.ts）
├─ docs/
│  ├─ brand/                    specs/ の brand.md とマスターSVGのコピー
│  │  └─ icon_layers/           マスターSVGの前景をレイヤーごとに書き出したSVG（01_ring・02_wave・03_peak。v6）
│  └─ images/                   README 用スクリーンショット
├─ .github/workflows/           ci.yml（検査。Windows と macOS）、release.yml（v* タグでドラフトリリース。Windows と macOS）
├─ README.md / CONTRIBUTING.md / CHANGELOG.md / LICENSE
└─ roadmap/
```

## 3. Rust側

### 3.1 入力源（audio_source）

```rust
pub struct DeviceInfo { pub id: String, pub name: String, pub is_default: bool }

pub enum SourceStatus { Opening, Live, Silent, Unavailable { reason: UnavailableReason } }
pub enum UnavailableReason { NotFound, Disconnected, InUse, Other } // v7：macOS の録音の許可は判定しない（PermissionDenied は作らない）

pub struct AudioFormat { pub sample_rate: u32, pub channels: u16 } // 解析側にはステレオ f32 に揃えて渡す

pub trait AudioSource: Send {
    fn list_devices(&self) -> Result<Vec<DeviceInfo>, SourceError>;
    /// device_id が None なら既定の出力デバイス。sink にはステレオ・f32・インターリーブのフレームを渡す
    fn start(&mut self, device_id: Option<&str>, sink: FrameSink, on_status: StatusSink) -> Result<AudioFormat, SourceError>;
    fn stop(&mut self);
}
```

- Windowsの実装は`WasapiLoopback`（`wasapi`クレート 0.26系。APIはインストール後のドキュメントで確認する）。取得はイベント駆動の専用スレッドで行う
- macOSの実装（v6。v7で改めた）は、Core AudioのProcess Tapと集約デバイスを`objc2-core-audio`で自前で作り、その集約デバイスを`cpal` 0.18系（0.18.2）の入力として開く。`#[cfg(target_os = "macos")]`で分け、`cpal`と`objc2-core-audio`はmacOSのときだけの依存にする。名前（仮に`CoreAudioTap`）と細部は実装で決めてよい。`cpal`のコールバックからリングバッファへ書き、ステレオ・f32へのそろえは共通の`convert`を使う
  - タップは、選んだ出力デバイスのUIDに対して、全プロセス（除外なし）・ミュートしない・プライベートで作り、集約デバイスはそのタップだけを持つプライベートなもの（タップの自動開始あり）にする。作り方は`cpal`の`host/coreaudio/macos/loopback.rs`が参考になる。停止のときは、ストリームを止めてから集約デバイス、タップの順に壊す
  - `cpal`自身のループバック（出力デバイスに入力のストリームを作る）は使わない。入力チャンネルを持つデバイス（入出力兼用のオーディオインターフェース等）では、ループバックではなくそのデバイスの入力を開くため（T12-1）
  - 出力デバイスの今の形式（`default_output_config()`が返すもの）で開き、出力デバイスの標本化周波数などを変えない
  - `default_source`は、Windowsでは`WasapiLoopback`、macOSではこの実装、ほかのOSでは`UnsupportedSource`を返す
  - 既定の出力への追従：タップは作成時のデバイスに固定され、`cpal`からは既定の変更が通知されない。`kAudioHardwarePropertyDefaultOutputDevice`を自前で監視し（または短い間隔で既定のデバイスを調べ）、既定に追従しているときは開き直す。`cpal`のエラーの`DeviceNotAvailable`（切断）と`StreamInvalidated`（標本化周波数の変更）でも開き直す
  - 録音の許可（v7）：判定しない。許可がない（未決定で拒否・取り消し）ときも、エラーは返らず0のサンプルが来るだけで、許可があって何も鳴っていないときと見分けられず、公開APIもないため（T12-1）。許可がないときは無音（S01b）になる
  - 無音のあいだの開き直し（v7）：macOSでは、無音（`Silent`）が続くあいだ、一定の間隔（例：10秒。細部は実装で決めてよい）で取得を作り直す。許可したあとも、動いているストリームには0が来続け、作り直せば取れるため（T12-1）。作り直しのあいだも状態は`Silent`のまま（`Opening`にしない）にして、表示を揺らさない
  - 初回の取得では、OSの確認が出ているあいだ、ストリームの作成が答えるまで止まる（T12-1で4〜71秒）。そのあいだは`Opening`を通知し、エンジンのロックを持ったまま待たない（`list_output_devices`・`set_render_paused`などのコマンドを止めない）
  - デバイスの一覧・既定の変更・切断の扱いは、Windowsと同じ状態の通知（`Opening`／`Live`／`Silent`／`Unavailable`）にそろえる
- モノラルや多チャンネルのデバイスは、この層でステレオに揃える（解析は常にL・Rの2チャンネルを前提にできる）
- 既定のデバイスが変わった・切断された場合は`Unavailable`か`Opening`を通知し、再オープンを試みる
- 無音の判定（一定時間しきい値以下）は、解析ではなくこの層の状態として出す。取得中であることと音が来ていないことを区別する（S01b）
- `FrameSink`はリングバッファ（数秒分）への書き込み口。描画や送出が詰まっても取得スレッドは止まらない

### 3.2 解析（analysis）

```rust
pub trait Analyzer: Send {
    fn id(&self) -> SectionId;
    /// 最新のサンプル窓を受けて、自分のセクションを書き出す
    fn process(&mut self, window: &StereoWindow, ctx: &AnalysisContext, out: &mut SectionWriter);
}
```

- 解析の種類ごとにファイルを分ける：`level`、`waveform`、`spectrum`、`stereo`（リサージュの点列と周波数別の定位）、`loudness`（LOUDの近似とピーク）、`vu`、`chroma`（12音名＋コード・キーの推定、時間方向の平滑化つき）、`centroid`（重心とフラックス）
- FFTは`rustfft` 6.4系。スペクトラム・定位・クロマ・重心で1回のFFT結果を共有する（`AnalysisContext`に置く）
- 解析を追加するときは、ファイルを足して登録するだけで、既存の解析に手を入れない
- 解析結果を使うモジュールが1つも有効でないときは、その解析を止められるように、有効な解析の一覧をUIから受け取る（`set_active_sections`）

### 3.3 送出（frame_transport）

- 送出用スレッドが約60回/秒（16.7msごと）に、リングバッファの最新の窓で各解析を回し、1つのバイト列にまとめて`tauri::ipc::Channel`で送る
- バイト列の形式（リトルエンディアン）：

```
ヘッダ   : magic "SS"(u16) / format_version(u8) / flags(u8) / seq(u32) / sample_rate(u32) / section_count(u16)
セクション: section_id(u8) / reserved(u8) / length(u32) / payload(f32 の並び)
```

- 形式を知るのは送出側（Rust）と受信側（`frame_client`）だけ。セクションIDと中身の対応表は`frame_transport/format.rs`と`src/frame_client/format.ts`に置き、format_versionで食い違いを検出する
- ウィンドウが最小化されている間は、UIからの通知で解析と送出を止める（取得は続ける）

### 3.4 保存（settings_store）

- 保存先：アプリのデータフォルダ（`app_data_dir()`。Windowsでは`%APPDATA%\com.rinontech.sonar-spectra\state.json`、macOSでは`~/Library/Application Support/com.rinontech.sonar-spectra/state.json`。v6で実機の場所を確かめる）
- 書き込みは一時ファイルに書いてから置き換える（書き込み中に落ちても前の状態が残る）
- 読み込み時に`schema`を確かめ、古い形式は移行し、読めない場合は既定の状態で起動して元のファイルを`state.broken-{日時}.json`として残す
- schema 2（v4）：`state.json`に`app`（アプリ全体の設定）を足す。1→2の移行は`app: { frameLimit: 60 }`を足すだけ。構成ファイルの`schema`は`state.json`と同じ版を使うため2になり、その1→2の移行は中身を変えない
- 構成の書き出し・読み込みは、UIで`tauri-plugin-dialog`で場所を選び、`tauri-plugin-fs`で読み書きする（fsの権限はダイアログで選んだパスに限る）。中身の検証は`settings_store`のコマンドで行う

### 3.5 コマンドとイベント（UI ⇔ Rust のインターフェース）

- `start_stream(on_frame: Channel)`：取得と送出を開始する。結果のバイト列は`on_frame`へ
- `list_output_devices() -> Vec<DeviceInfo>`
- `select_output_device(device_id: Option<String>)`：入力源を切り替える（`Opening` → `Live`）
- `retry_source()`：S01cの「再試行」
- `get_platform() -> "windows" | "macos" | "other"`（v6）：タイトル帯の形と全画面の方式を選ぶ
- `set_render_paused(paused: bool)`：最小化の通知
- `set_active_sections(ids: Vec<u8>)`
- `load_state() -> PersistedState` / `save_state(state: PersistedState)`
- `validate_config_file(text: String) -> Config`：読み込んだファイルの検証と移行
- イベント`source-status`：`SourceStatus`と`DeviceInfo`（出力系統のチップ、S01b〜S01dの表示に使う）。v7：使えない理由は増えない（`permission_denied`は作らない）

### 3.6 ウィンドウとOSの差（platform。v6）

- **`tauri.macos.conf.json`の重なり方**（v7。T12-1）：`tauri.conf.json`にJSON Merge Patch（RFC 7396）で重なり、配列（`app.windows`・`bundle.icon`）はまるごと置き換わる。配列を変えるときは、macOS用に全体を書く
- **タイトルバー**：macOSだけ、`tauri.macos.conf.json`でウィンドウを`titleBarStyle: Overlay`・`hiddenTitle: true`にし、`trafficLightPosition`で信号機ボタンをタイトル帯の左端・帯の高さの中央に置く。値は`{x:16, y:15}`（v8。T13-2）：macOS 26のボタンは直径14・間隔23で、帯の高さ44px（ウィンドウの幅1294px以上）の中央にそろう。位置は起動時に決まり帯の高さに追従しないため、狭いウィンドウでは中央より少し下になる（SPEC 2節。許容）。帯の左の余白は`--traffic-light-inset`（`component_metrics.css`。x＋ボタン3つの幅＋ロゴまでの間）。Overlayのつかみには権限`core:window:allow-start-dragging`（`core:window:default`に含まれない）が要る。Windowsは標準のタイトルバーのまま
- **全画面**：macOSは`@tauri-apps/api`の`setSimpleFullscreen`（Tauri 2.10以降。権限`core:window:allow-set-simple-fullscreen`をcapabilitiesに足す。独自のコマンドは作らない。v7）で、新しい操作スペースを作らずに覆い、メニューバーとDockを隠す。Windowsは今の`setFullscreen`のまま。UIの`window_api`は、OSの種類で呼び分ける（`window_controller`の状態の持ち方は変えない）。Tauriの`isFullscreen`はsimple fullscreenを見ない（taoは`fullscreen`と`is_simple_fullscreen`を別に持つ）ため、macOSでは`window_api`の`macFullscreen`が入ったかどうかを持つ（simple fullscreenはアプリの操作でしか出入りしない）。信号機の緑のボタンでOSの全画面に入ったときも全画面として扱い、全画面のボタンでそちらを終える（v8）。全画面を終えるのは全画面のボタンだけで、Escの処理は持たない（Windowsと同じ。v8）。全画面の状態は記憶しない（v1と同じ）
- **メニュー**：macOSだけ、アプリメニュー（このアプリについて・隠す・ほかを隠す・すべてを表示・終了）と「編集」メニュー（取り消し・やり直し・カット・コピー・ペースト・すべてを選択）を、Tauriの定義済みの項目で作る。名前の入力欄で標準のショートカットが効くこと。定義済みの項目の文言は、渡さないと英語のまま固定（muda 0.20.0。OSの言語に合わせない）ため、UI（`src/platform/app_menu.ts`）で辞書`menu.*`の文言を渡して組み、macOSのときだけ`setAsAppMenu`する（v8。T13-5）。起動直後はTauriの既定のメニュー（英語）が出ていて、組み終えたところで置き換わる（組めなければ既定のまま）
- **App Napの抑止**：macOSで、起動中は`NSProcessInfo`の活動（`beginActivityWithOptions`。ユーザーが始めた活動・App Napを止める）を保ち、VJツールを前面にしても取得・送出・描画が間引かれないようにする。WebViewの描画の間引き（ウィンドウが見えている限り上限どおりに描くこと）は、T15-2で測って確かめる
- **バンドルの設定（macOS）**：`minimumSystemVersion` 26.0、対象は`aarch64-apple-darwin`だけ（設定ではなく`tauri build --target aarch64-apple-darwin`で絞る。v7）、アドホック署名（`bundle.macOS.signingIdentity: "-"`。バンドラーは`codesign --force -s - --options runtime`を実行し、この署名でProcess Tapが使える〔エンタイトルメント不要。T12-1〕）。`Info.plist`は`src-tauri/Info.plist`に置けば自動で合成され、devのビルドにも埋め込まれる。`Info.plist`に`NSAudioCaptureUsageDescription`を足す。その文言は原文の辞書（`ja.ts`）のキーから取り、`Info.plist`の値と辞書の値が一致することを自動検査で確かめる（4.8）

## 4. UI側

### 4.1 受信（frame_client）

- Channelのバイト列を`DataView`で読み、`AnalysisFrame`（セクションごとの`Float32Array`のビュー）に戻す。コピーを避ける
- 最新のフレームだけを保持し、描画ループが毎回それを読む（受信と描画のタイミングを切り離す）
- 波形の履歴とスペクトログラムの履歴は、受信側でリングバッファに積む（モジュールのインスタンス間で共有）

### 4.2 モジュール（modules）

```ts
type ModuleKind = "level" | "wave" | "spec" | "stereo" | "gram" | "loud" | "vu" | "chroma" | "centroid";
type Shape = "long" | "compact" | "free";            // 推奨の形
type Direction = "up" | "right" | "down" | "left";

interface ModuleDefinition<O> {
  kind: ModuleKind;
  labelKey: MessageKey;                // 見出しの辞書キー
  shape: Shape;
  baseDirection: Direction | null;     // null は方向なし
  flows: boolean;                      // 流れる速さの設定を持つか
  sections: SectionId[];               // 必要な解析
  defaultOptions: O;
  inspectorFields: InspectorField<O>[];// インスタンスの設定に出す項目（辞書キーで記述）
  createRenderer(ctx: RenderContext): ModuleRenderer<O>;
}

interface ModuleRenderer<O> {
  resize(geom: Geometry): void;        // 枠の大きさ・向き・DPR
  draw(frame: AnalysisFrame, history: Histories, opts: O, colors: PaletteColors, dt: number): void;
  dispose(): void;
}
```

- レジストリ（`modules/registry.ts`）に登録するだけで、配置・レイアウト編集・インスタンスの設定に現れる
- 流れる方向は、モジュールの枠（`ModuleFrame`）側で座標系を回して実現し、目盛りや文字も枠ごと回す。描画側は常に既定の向きで描けばよい（v4：図形は描画の層が同じ回転を頂点の変換で当て、文字は枠のCanvas 2Dの座標系を回す）
- **描くものの受け渡し**（v4）：`draw`は、図形を`ShapeSink`へ、文字を文字の層（Canvas 2D）へ出す。上の型の`draw`の引数に`out: DrawOutput`を足し、`RenderContext.ctx`（Canvas 2D）は文字の層だけに使う。名前と細部は実装で決めてよい

```ts
interface DrawOutput {
  shapes: ShapeSink;                   // 図形（描画の層がWebGL2で描く）
  text: CanvasRenderingContext2D;      // 文字の層（枠ごと。図形の上に重なる）
}

interface ShapeSink {
  polyline(points: Float32Array, style: StrokeStyle): void;          // 線（太さ・色・発光）
  band(xs: Float32Array, top: Float32Array, bottom: Float32Array, style: FillStyle): void; // 塗りの帯
  polygon(points: Float32Array, style: FillStyle): void;             // 円形の塗りなど
  points(points: Float32Array, size: number, style: FillStyle): void;
  rects(rects: Float32Array, style: FillStyle): void;                // 棒・格子線（1ピクセル幅）
  image(stream: StreamImage, dest: Rect): void;                      // 流れる画像（履歴・スペクトログラム）
}
```

- **流れる画像**（v4）：今の`OffscreenBuffer`（すでに描いた分をずらす）は、WebGL2では輪の形のテクスチャ（新しい列だけを書き、表示するときに読み始めの位置をずらす）に置き換える。モジュールは新しい列の中身だけを作る
- **発光**（v4）：`style.glow`（発光の値。0は発光なし）を持つ図形を、描画の層がまとめて発光させる（4.6）。モジュールは発光の描き方を知らない
- 描画の細部（線の太さ、残像の減衰、平滑化の係数）はモックの見え方に近づける（委任事項）

### 4.3 配置（layout）

- 格子：12列×8行。インスタンスの位置は`{ c, r, cs, rs }`（1始まり、モックと同じ）
- **自動整列**：有効なインスタンスと画面比から配置を選ぶ純粋関数`autoArrange(instances, aspect) -> Map<id, Rect>`
  - 画面比の帯：帯 2.4以上／横長 1.5〜2.4／標準 1.1〜1.5／縦長 1.1未満（定数。設定には出さない）
  - 帯ごとのテンプレートはモックのS04の並びを格子に置き換えたもの。2つ目の位相（周波数別の定位）は専用の位置を持つ
  - 同じ種類が複数あるときは、2つ目以降を同じ種類の隣に並べる（隣の領域を分割する）
  - 縦長の帯では、レベルを横向き（右へ）にする
- **手動配置**：ドラッグでの移動、右下の角での大きさ変更、境界線の移動（両側を同時に変える）、矢印キーで1マスずつ。どのモジュールも1マス未満にしない
- 手で動かした時点で`mode = "manual"`になり、そのときの自動配置の結果を各インスタンスの`rect`に固定する。「自動整列」で`mode = "auto"`に戻す
- 推奨の形との適合判定（「適」「もっと細長く」など、S03の見出しのバッジ）も、純粋関数として持つ

### 4.4 インスタンス設定・配色・構成（config）

- ストア：`useConfigStore`（現在の構成、保存済みの構成、使用中の構成のID、変更ありかどうか）と、`useRuntimeStore`（入力源の状態、編集中かどうか、開いているドロワー。保存しない）
- 配色：標準のプリセット（マゼンタ主・シアン主・アンバー主）はコードに持ち、トークンの`neon-a/b/c`の組み合わせで表す（値を直書きしない）。自分で作った配色は主色・副色・強調色をダーク用の値で持ち、ライト用は自動で暗く・彩度を落として作る（OKLCHで明度と彩度を下げ、地の色に対して4.5:1以上になるまで明度を下げる）
- 保存：状態が変わるたびに、少し間を置いて（300ms程度）`save_state`を呼ぶ

### 4.5 画面（components）

- `App.vue`：`MeterScreen`（タイトル帯＋格子＋走査線と周辺減光）を常に表示し、その上に`StatusOverlay`（S01b〜S01d）、`SettingsDrawer`（S02）／`PaletteDrawer`（S02a）／`ConfigDrawer`（S02b）、`LayoutEditPanel`と`InstanceInspector`（S03）を状態で重ねる
- ボーダレスフルスクリーン：Windowsは`@tauri-apps/api`のウィンドウAPIで全画面にする（ボーダレスになることを実機で確認済み）。macOSは`setSimpleFullscreen`（3.6）。タイトル帯と操作系は残し、ボタンは終了のアイコンに変える（S01a、S09a）
- タイトル帯（v6）：`get_platform`がmacOSのときは、左端に信号機ボタンの分の余白を取り、ロゴをその右から始める。帯のボタン以外の部分に`data-tauri-drag-region`（`"deep"`。ボタンはTauriがつかみから外す）を付け、ダブルクリックで拡大する・元に戻す（S09）。ダブルクリックはTauriのつかみの既定の振る舞い（`internal_toggle_maximize`）のままとし、システム設定の「しまう」「何もしない」には従わない（v8。SPEC 2節）。全画面（S09a）では余白をなくし、Windowsの全画面（S01a）と同じ形にする。Windowsは今のまま
- 出力系統のチップ（v6）：macOSでは取得中の文言を`source.chip_loopback_mac`に（モックの辞書のとおり）。許可がないときの`source.chip_perm`は作らない（v7）
- ウィンドウ状態：`tauri-plugin-window-state`で位置・大きさ・ディスプレイを記憶する。全画面の状態は記憶しない（StateFlagsから外す）
- `MeterGrid`（v4）：格子の後ろに、共有のWebGL2キャンバスを1枚敷く（格子と同じ範囲、ポインターのイベントは通す）。`ModuleFrame`のキャンバスは文字の層になり、地は透明にする（地の色は共有キャンバスが塗る）
- 描画を開始できないとき（v4。S01e）：WebGL2のコンテキストを作れなければ、メーターの領域の中央に`status.render_unavailable`を1行出す。タイトル帯と操作系はふだんどおり
- 中央の表示の出し分け（v5。S01e）：描画を開始できない表示（`MeterGrid`）と、入力源の状態の表示（`StatusOverlay`。S01b〜S01d）は、中央に1つだけ出す。`MeterGrid`は描画の層が使えない（作れない・失った）ことを親の`MeterScreen`へ知らせ、`MeterScreen`が両方の出し方を決める（名前と細部は実装で決めてよい）
  - 無音（S01b）：描画を開始できない表示を出し、`StatusOverlay`の無音の表示は出さない（無音はタイトル帯のチップで分かる。チップは今のまま）
  - 使えない（S01c）・開いている途中（S01d）：`StatusOverlay`を出し、描画を開始できない表示は出さない（入力源が開いて live か silent になったら出す）
  - 判定は純粋関数にしてテストする（入力源の状態 × 描画の層の状態 → 出す表示）
- 設定パネルの表示の欄（v4。S02）：末尾に「フレームレートの上限」のセグメント（60／45／30fps）を置く
- ライトテーマで小さな文字に`neon-b`・`neon-c`を使う部品（適合判定のバッジ、手動配置のバッジ、LOUDの数値など）は、文字を`--color-text`にし、枠線だけ発光色を残す（SPEC 9節）

### 4.6 描画ループ（render）

- `requestAnimationFrame`を1本だけ回し、表示中のモジュールを順に描く
- **フレームレートの上限**（v4）：`requestAnimationFrame`は毎回受け、前回描いた時刻からの経過が上限の周期に満たない回は描かずに飛ばす
  - 周期は平均で合わせる：描くたびに「次に描いてよい時刻」を周期ぶん進める（遅れが周期を超えたら今の時刻に合わせ直し、まとめて描かない）。画面の1周期の半分を許容の幅にして、60 Hzの画面で上限60fpsのときに1回おきにならないようにする
  - 画面の周期が上限より低いときは、来た回ごとに描く（上限は引き上げない）
  - 上限は`app.frameLimit`から読み、変わったらすぐ効かせる。経過時間（`dt`）は描いた回どうしの差のまま（流れる速さは描く回数によらない）
- ウィンドウが最小化されたら止め、`set_render_paused(true)`を送る。復帰したら再開する
- 描画が重い場合も受信・取得は止まらない（最新のフレームだけを描く）
- macOSでの計測（v6）：WebView2のリモートデバッグは使えないため、ページ内の計測（描く回数と1回の時間。開発用のビルドでだけ有効にするか、計測用の一時的なコードにする）と、アクティビティモニタ（CPU・GPU・メモリプレッシャー）で測る。Safariの Web インスペクタが使えるかはT15-1で確かめる

#### 描画の層（`render/gl/`。v4）

- **共有キャンバス**：WebGL2のコンテキストは1つ。1回の描画の初めに全体を消し、モジュールごとに、枠の範囲（`MeterGrid`の配置から求めた矩形。デバイスピクセル）をビューポートと切り抜きにして、そのモジュールの図形を描く。枠の地の色もここで塗る。枠の位置はDOMから測らず、配置の状態から毎回求める（レイアウト編集のドラッグに追従する）
- **図形の描き方**：線は太さを持つ三角形の列に展開する（WebGLの線は1ピクセル固定のため）。端と継ぎ目のアンチエイリアスはシェーダーで付ける。帯・多角形・点・四角も三角形にする。1つのモジュールの図形は、色と発光ごとにまとめて少ない描画命令で描く
- **方向**：枠の`quarterTurns`を頂点の変換（行列）で当てる
- **発光**（T9-1の推奨案(a)）：発光する図形を、等倍のオフスクリーンのフレームバッファに1回だけ描き、それを縮小（発光の値が12以下は1/2、超えると1/4）して分離型のガウスでぼかし（標準偏差＝発光の値/2。`shadowBlur`と同じ広がり。枠の範囲の外は透明として読む）、拡大して枠に敷いてから、等倍の図形を重ねる。等倍の図形は、フレームバッファの画像を写さず、送ってある同じ頂点の範囲を枠へもう一度描く（展開はし直さない。塗りのふちは共有キャンバスのマルチサンプルでならされ、画像の側にマルチサンプルの領域と解決が要らない）。発光が0のときは、ぼかしを飛ばして図形だけを描く。フレームバッファは共有キャンバスの大きさで作って全部の枠で使い回し、大きさが変わったときだけ作り直す
- **色**：テーマ・配色の色（CSSの色の文字列）は、描画の層でRGBAの数値に直してから使う（同じ文字列は使い回す）
- **コンテキストの喪失**：`webglcontextlost`で`preventDefault`して描くのを止め、`webglcontextrestored`でシェーダー・バッファ・テクスチャを作り直して再開する。流れる画像の中身は消えたところから描き直す
- **作れないとき**：WebGL2のコンテキストを作れなければ、描画の層は描かず、`MeterScreen`に描画を開始できない状態を知らせる（4.5）。Canvas 2Dの描き方へは戻さない

### 4.7 国際化

- `vue-i18n` 11.4系（Composition API、`legacy: false`）。辞書はロケールごとのTypeScriptファイルで、`ja.ts`の型を`MessageSchema`としてキーを型検査する
- ロケールの判定：保存値 → OSのロケール → 原文（`ja`）の順。初版は`ja`だけなので切り替えUIは出さない。フォールバックは`ja`
- `<html lang>`はロケールの確定時と切り替え時に更新し、`tokens.css`の`:lang()`で`--font-ui`が切り替わる
- 疑似ロケール：`bun run dev:pseudo`で起動したときだけ有効（`ja`の文字列を3〜4割伸ばし`⟦…⟧`で囲む）。公開版には含めない
- 日付（構成の保存日）と数値（dB、倍率、%）は`Intl`にロケールを渡して整形する
- 辞書のキーはモックの辞書を出発点にし、機能ごとの階層・スネークケースに整える（画面IDは使わない）。モックの説明用の文言（`doc.*`、`screen.*`、表示方式の説明文など）は移さない

### 4.8 自動検査（`bun run check`）

- `vue-tsc --noEmit`：存在しないキーの参照を型で検出
- `scripts/i18n_check.ts`：ロケール間のキーの過不足とプレースホルダの一致、未使用キーの検出
- `@intlify/eslint-plugin-vue-i18n`：テンプレートとスクリプト内の文字列の直書きを検出
- `scripts/token_check.ts`：`src/theme/`以外にある色（`#…`、`rgb(`、`hsl(`、`oklch(`）・px値の直書きを検出
- `cargo clippy`と`cargo test`、`vitest`
- `Info.plist`の`NSAudioCaptureUsageDescription`と、辞書の対応するキーの値が一致すること（v6。スクリプトの置き場所と名前は委任事項）
- CIの`ci.yml`でも同じコマンドを、WindowsとmacOSの2つのランナーで実行する（v6。OSごとの条件付きコンパイルの両方を`clippy`と`test`にかけるため）
- 描画のテスト（v4）：各モジュールの描画は、記録用の`ShapeSink`（受け取った図形をそのまま並べる）と、文字の層だけを記録するテスト用のCanvas（`test_canvas.ts`）で調べる。WebGL2の描画の層は、WebGLに頼らない部分（線の三角形への展開、方向の変換、発光の縮小率とぼかしの係数、色の変換、間引きの判定）を純粋関数にして単体テストで調べ、WebGLに渡す部分は薄く保って実機の撮影で確かめる

## 5. データモデル

### 5.1 構造

`state.json`（アプリのデータフォルダ）：

```ts
interface PersistedState {
  schema: 2;                       // v4で2に上げた（3.4）
  current: Config;                 // 今表示している構成（作業中の写し）
  activeConfigId: string;          // 使用中の保存済み構成
  dirty: boolean;                  // 保存後に変更があるか（S02の「保存後に変更あり」）
  savedConfigs: SavedConfig[];
  source: { deviceId: string | null }; // null は既定の出力デバイス。構成には含めない
  app: { frameLimit: 60 | 45 | 30 };   // アプリ全体の設定（v4）。構成には含めない。既定は60
}

interface SavedConfig extends Config { id: string; name: string; savedAt: string /* ISO 8601 */ }

interface Config {
  layout: { mode: "auto" | "manual"; instances: Instance[] };
  customPalettes: Palette[];       // 自分で作った配色
  theme: "dark" | "light" | "system";
  display: { scanline: boolean; alwaysOnTop: boolean; startFullscreen: boolean };
}

interface Instance {
  id: string;
  kind: ModuleKind;
  enabled: boolean;
  rect: { c: number; r: number; cs: number; rs: number } | null; // 自動配置中は null
  slot?: "pan";                    // 既定の配置で専用の位置を持つもの
  direction: Direction | null;
  paletteId: string;               // "preset.a" など、または自分で作った配色のID
  sourceId: "default";             // 初版は既定の1系統だけ
  options: ModuleOptions[kind];    // 種類ごとの設定
}

interface Palette { id: string; name: string; main: string; sub: string; accent: string } // ダーク用の値
```

種類ごとの設定（`options`）と既定値：

- `wave`：`channel: "stereo"`、`showNow: true`、`split: 72`、`histColor: "solid"`、`speed: 1`
- `spec`：`mode: "fill"`、`ghost: true`
- `stereo`：`mode: "lissajous"`、`dots: "both"`、`blur: true`
- `gram`・`centroid`：`speed: 1`
- `level`・`loud`・`vu`・`chroma`：なし

ウィンドウの位置・大きさ・ディスプレイは`tauri-plugin-window-state`の別ファイルに保存し、構成には含めない。

### 5.2 動きで見るデータの変化

架空の利用者「Aさん」の操作を時系列で追う。

1. **初めて起動する** → `state.json`がないので既定の状態を作る。`savedConfigs`に「既定」を1件作って`activeConfigId`に入れ、`current`はその写し。インスタンスは10件（レベル・波形・スペクトラム・位相・スペクトログラム・ラウドネス・位相〔周波数別の定位、`slot: "pan"`〕は有効、VU・クロマ・重心と変化量は無効）、`mode: "auto"`、`rect`はすべて`null`。`source.deviceId: null`。ファイルに保存する
2. **音楽を再生する** → 何も変わらない（解析結果はメモリ上だけで、保存しない）
3. **ウィンドウを動かして大きさを変える** → `state.json`は変わらない。window-stateのファイルが終了時に更新される。自動配置なので配置は描画時に計算し直すだけ
4. **設定でテーマをライトにする** → `current.theme = "light"`、`dirty = true`
5. **レイアウト編集でスペクトラムをドラッグする** → `current.layout.mode = "manual"`。その時点の自動配置の結果が全インスタンスの`rect`に入り、スペクトラムの`rect`がドラッグ後の値になる。`dirty = true`
6. **スペクトラムを複製する** → 新しい`id`のインスタンスが1件増える。`options`・`direction`・`paletteId`は複製元と同じ。`rect`は同じ大きさが入る空きを左上から探して置き、空きがなければ1マスの空きに置く。1マスの空きもなければ`enabled: false`・`rect: null`で追加する
7. **複製したスペクトラムの設定で表示方式を「バー」、配色を「シアン主」にする** → そのインスタンスの`options.mode`と`paletteId`だけが変わる
8. **そのインスタンスで「既定に戻す」を押す** → `options`・`direction`・`paletteId`が既定値に戻る。`rect`と`sourceId`は変わらない
9. **「名前を付けて保存」で「クラブ用」と付ける** → `savedConfigs`に`current`の写しが新しい`id`・`name`・`savedAt`で1件増え、`activeConfigId`がそれになり、`dirty = false`
10. **配色を作る（主色・副色・強調色）** → `current.customPalettes`に1件増える。`dirty = true`。どのインスタンスもまだ使っていない
11. **構成を「既定」に切り替える** → `dirty = true`なので、上書き・別名で保存・破棄を確認する。破棄を選ぶと`current`は「既定」の写しになり、`activeConfigId`が「既定」、`dirty = false`。10で作った配色は「クラブ用」に保存していないので消える
12. **「クラブ用」を書き出す** → `state.json`は変わらない。選んだ場所に`{ format: "sonar_spectra.config", schema: 2, config: SavedConfig }`のJSONを書く（v4で`schema`は2。schema 1のファイルも移行して読める）
13. **別のPCでそのファイルを読み込む** → 検証してから、新しい`id`を振って`savedConfigs`に1件増やす。`activeConfigId`は変えない（読み込んだ構成は一覧から切り替えて使う）。そのPCに「クラブ用」がすでにあれば、「クラブ用_1」として足す（5.4）
14. **入力源のデバイスを変える** → `source.deviceId`だけが変わる。構成は変わらず、`dirty`も変わらない
15. **アプリを終了して起動し直す** → `state.json`から`current`をそのまま復元し、`display.startFullscreen`がオンなら全画面で始める。ウィンドウの位置・大きさはwindow-stateから復元する（そのディスプレイがなければOSが置く位置）
16. **設定でフレームレートの上限を30fpsにする**（v4） → `app.frameLimit = 30`だけが変わり、すぐ描く回数が減る。構成は変わらず、`dirty`も変わらない。構成を切り替えても30fpsのまま

### 5.3 画面の項目とデータの対応

- タイトル帯の出力系統のチップ（S01、S01b〜S01d）：`source-status`イベント（保存しない）と`source.deviceId`
- 設定パネル（S02）：構成の欄 → `activeConfigId`の`name`と`dirty`（「上書き保存」は`dirty`のときだけ押せ、使用中の保存済み構成を`current`の写しにして`dirty = false`）／入力源 → `source.deviceId`／テーマ → `current.theme`／表示 → `current.display.*`／フレームレートの上限 → `app.frameLimit`（v4）
- 配色の管理（S02a）：標準 → コード上のプリセット／自分で作った配色 → `current.customPalettes`
- 構成の管理（S02b）：一覧 → `savedConfigs`（名前、配置の種類・モジュール数・保存日は`layout.mode`・有効なインスタンスの数・`savedAt`から作る）／使用中 → `activeConfigId`
- レイアウト編集（S03）：置いたモジュールの一覧 → `current.layout.instances`（`enabled`はスイッチ）／見出しの矢印 → `direction`／自動配置・手動配置のバッジ → `layout.mode`
- インスタンスの設定（S03）：入力源 → `sourceId`／配色 → `paletteId`／その他 → `options`

### 5.4 削除・修正・二重操作

- **インスタンスの削除**：そのインスタンスだけを消す。手動配置では空いたマスはそのまま残り、自動配置では残りで並べ直す。種類の最後の1つも消せる（「＋ モジュールを追加」で戻せる）
- **自分で作った配色の削除**：その配色を使っていたインスタンスは`paletteId`が既定（マゼンタ主）に戻る
- **保存済み構成の削除**：使用中の構成は削除できない（ボタンを無効にする）。それ以外は一覧から消えるだけで、`current`は変わらない
- **同じ名前での保存**（v3で変更）：構成の名前は重ならない。すでにある名前で、名前を付けて保存（切り替えの確認の「別の名前で保存」を含む）・複製・読み込みをすると、末尾に`_{n}`（使われていない最小のn。1から）を付ける。名前の比べ方は前後の空白を除いた完全一致で、`_{n}`を付けたあとも40文字に収める（本体の末尾を削る）。上書きは名前を変えず、「上書き」の操作だけで行う。内部の区別は引き続き`id`で行う。すでに保存されている同名の構成は書き換えない
- **自分で作った配色の名前**（v3で追加）：構成と同じ規則で、今の構成の配色の一覧の中で重ならない。標準の配色の名前（今の言語の文言）とも重ならない。作る・複製・名前の変更で当てる
- **同じファイルの二重読み込み**：2件として増える（それぞれ新しい`id`。2件目は名前に`_1`が付く）
- **壊れた・形式の違うファイルの読み込み**：検証で拒否し、`state.json`は変えない
- **書き込み中の異常終了**：一時ファイルからの置き換えなので、前回の`state.json`が残る

## 6. 配布

- tauri-actionで、Windows x64のインストーラー（NSIS）と、macOS（Apple Silicon、`aarch64-apple-darwin`）のディスクイメージ（`.dmg`）をビルドする（SPEC 7節。v6）。`release.md`の「macOS Universal」は作らない（Intel Macはスコープ外のため）
- macOSのジョブは、Xcode 26以降のあるランナーで動かす（`.icon`を`actool`で`Assets.car`にするため）。ランナーのラベルは、T16-1の時点のGitHubのドキュメントで確かめる
- 表示名（v9）：`productName`は「Sonar Spectra」（SPEC 10節）。ウィンドウの`title`、`index.html`の`<title>`、辞書の`app.window_title`と、アプリ名を含む文言（`config.file_filter`・`config.import_failed`）も同じにする。アプリメニューの名前は`getName()`（＝`productName`）から作るので、辞書には持たない。`productName`から、`.app`・`.dmg`・インストーラーの名前、インストール先、ショートカット、Windowsのアンインストール情報のキーが決まる。実行ファイルの名前はCargoの`package.name`（`sonar_spectra`）のままにし、`mainBinaryName`は使わない
- 0.1.0からの更新（Windows。v9）：表示名が変わると、NSISのアンインストール情報のキー（`Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}`）とインストール先が変わり、インストーラーは0.1.0を同じアプリと見なさない。そこで`bundle.windows.nsis.installerHooks`で`src-tauri/windows/hooks.nsh`を指し、`NSIS_HOOK_PREINSTALL`で、0.1.0のキー（`HKCU`。0.1.0は既定の`currentUser`で入る）の`UninstallString`があれば、旧版のアンインストーラーを`/S`で、`_?=`に旧版のインストール先を添えて待って実行し、終わったら旧版のアンインストーラーとフォルダーを消す。`/UPDATE`は付けない（付けるとショートカットなどが残る）。サイレントでは「アプリのデータを削除する」が選ばれないため、`identifier`の場所にある設定と構成は残り、0.2.0がそのまま読む。旧版が見つからなければ何もしない。細部（キーの読み方、引用符の扱い）は、インストール済みのtauri-bundlerの`installer.nsi`に合わせてT14-5で決める
- 識別子：`com.rinontech.sonar-spectra`（表示名を変えても変えない。設定と構成の保存場所、WebView2のデータ、macOSの録音の許可は、これで決まる）。バージョンは`package.json`・`tauri.conf.json`・`Cargo.toml`で同じ値（初回`0.1.0`）
- Windowsはコード署名なし。READMEにSmartScreenの警告と開き方を書く
- macOSはアドホック署名だけ（Developer IDの署名と公証はしない）。READMEとCHANGELOGに、初回の開き方（「システム設定」→「プライバシーとセキュリティ」の「このまま開く」。版ごとに必要）と、更新するたびにシステムオーディオ録音の許可を与え直す必要があることを書く

## 7. アイコンの展開

プランアセット v2（`development/261106052155_change_icon_layer_structure.md`）で、マスターSVGはレイヤー構成（`00_bg`・`01_ring`・`02_wave`・`03_peak`）を持つ角のない正方形になった。角丸と余白はマスターに持たせず、展開するときに形式ごとに足す（SPEC 6節「アイコンの余白ルール」）。展開の方法は委任事項。

- **入口**：`bun run icons`（`scripts/generate_icons.ts`）。`roadmap/specs/`の最新版のマスターSVGを入力にし、`docs/brand/icon_master.svg`がそれと一致しなければ止める（v1と同じ）
- **中間のSVGを作ってから`tauri icon`に渡す**：マスターSVGを`<image>`や`<use>`で参照するのではなく、マスターの中身をそのまま入れ子にした一時的なSVGを、作業用のフォルダに形式ごとに作る。`tauri icon`は入力1つから全形式を作るため、形式ごとに別の出力先へ実行し、必要なファイルだけを`src-tauri/icons/`へ集める
  - Windows用：1024四方のまま、角丸半径200の`clipPath`で切り抜く。余白は足さない。ここから`icon.ico`、Windows向けのPNG（`Square*Logo.png`・`StoreLogo.png`）、`bundle.icon`が参照するPNG（`32x32.png`・`128x128.png`・`128x128@2x.png`・`icon.png`・`64x64.png`）を取る
  - macOSの従来形式用：マスターを824四方に縮めて中央に置き（四辺100）、角丸半径185.4で切り抜く。ここから`icon.icns`だけを取る。連続曲率の角丸への置き換えは、まず行わない（SPECで任意とされているため。必要になったら別の作業として扱う）
  - `.icon`用（v6）：マスターの前景`01_ring`・`02_wave`・`03_peak`を、1024四方のキャンバスのまま、角丸や余白を足さずに、レイヤーごとのSVGとして`docs/brand/icon_layers/{id}.svg`へ書き出す（`00_bg`は書き出さない。その色はIcon Composerの背景の塗りにする）。`bun run icons`の中で行う
- **`AppIcon.icon`**（v6）：利用者が、レイヤーのSVGと`brand.md`の「Apple環境向けアイコン」からIcon Composerで作り、リポジトリに置く。`tauri.conf.json`（または`tauri.macos.conf.json`）の`bundle.icon`に加え、`.icns`は従来形式のフォールバックとして残す。Tauriの`.icon`の扱い（対応した版、`actool`の呼び出し、既知の不具合）はT12-1とT14-9で確かめる
  - Tauriの`.icon`の扱い（v7。T12-1）：tauri-bundler 2.9.0で対応し、`@tauri-apps/cli` 2.12.4はtauri-bundler 2.10.4を使う。`bundle.icon`に`.icon`のフォルダを挙げると、バンドラーが`actool`（26以上）で`Assets.car`を作り、`CFBundleIconName`と`CFBundleIconFile`（`.icns`）の両方を`Info.plist`に書く。`actool`がない・26未満のときは、エラーを記録するだけで、`Assets.car`なしでビルドに成功する（下の確かめ方で拾う）。既知の不具合（tauri#15315：`actool`がnilの挿入で落ちる、tauri#16386：Xcode 27.1で`Bad file descriptor`。どちらも未解決）に当たったときは、事前に`actool`で作った`Assets.car`を`bundle.icon`に入れる（`.car`はそのまま使われる）
- **ファビコン**：`public/favicon.svg`はWindows用の中間SVG（角丸で切り抜いたもの）を置く。`public/favicon.ico`は`icon.ico`の写し
- **切り抜きの書き方**：中間SVGでは`clipPath`だけを使う。マスターSVGの規則（`filter`・`mask`・`opacity`系を使わない）はマスターに対するもので、展開後のファイルには及ばないが、`clipPath`で足りるため使わない
- **確かめ方**：展開した画像の画素から、角が透明であること、Windows向けは図形の外接矩形の余白が四辺112/1024以上、`.icns`の中の画像はタイルの外接矩形が四辺100/1024（1画素までのずれは許す）であることを測る。`.icon`については、`.icon`の中のレイヤーのSVGが`docs/brand/icon_layers/`と一致すること、ビルドした`.app`に`Assets.car`と`.icns`の両方があることを確かめる（v6）
