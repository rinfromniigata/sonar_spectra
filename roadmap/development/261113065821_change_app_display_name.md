# change：アプリの表示名を「Sonar Spectra」にする

- 種別：仕様変更（要件〔アプリの名前〕、画面構成〔モックのS01・S09の`app.window_title`〕、配布物〔インストーラー・`.app`・`.dmg`の名前、Windowsでの0.1.0からの更新のしかた〕、検証の項目〔W16-4〕を変える）
- 状態：**承認済み（261113）**。ユーザーの回答は「2. b　3. Phase 14の先頭　承認します。進めてください」（点1は案のとおり、点2は(b)、点3はPhase 14の先頭）
- 反映（261113070449）：specsをv9に、imple・tasks・walkを`261113070449_*`にした。下の「3. 計画への反映」は、承認の内容（(b)・Phase 14の先頭）に合わせて次のように置いた
  - tasks：Phase 14を「アプリの表示名とApple環境向けアイコン」に改め、先頭にT14-5（表示名の変更とインストーラーのフック。依存W13-3。推奨Opus・high以上）を足し、T14-1の依存をT14-5に改めた。T16-1（リリースの説明文）・T16-2（README）・T16-4（CHANGELOG）に、旧版の自動の取り除きと表示名の記述を足した
  - walk：W14-4（表示名と、フックの組み込みの確かめ。W14-1のあと、W14-2の前）とW14-5（【ユーザー】Windowsの実機で、0.1.0の上から手元でビルドしたインストーラーを入れる。Phase 14の末尾）を足し、W14-2の依存をW14-4に改めた。W14-3・W16-2・W16-3・W16-4に表示名と旧版の取り除きの確かめを足した
  - imple：2節に`src-tauri/windows/hooks.nsh`、6節に表示名とフックの設計（旧版のアンインストーラーを`/S`で、`/UPDATE`を付けずに呼ぶ）を足した
  - timeline.mdの記録は261113070700
- 発端：ユーザーの指摘（261113）「アプリ名が`sonar_spectra`になっている。Windows版もそうだった。それはリポジトリ名で、アプリとしての名称はSonar Spectra（大文字小文字を区別、スペースあり）にしたい」

## 現状（v8）

- SPEC 10節は「プロジェクト名：`sonar_spectra`」だけで、アプリの表示名を定めていない。そのため、`tauri.conf.json`の`productName`も、ウィンドウのタイトルも、辞書の`app.window_title`も`sonar_spectra`になっている（モックの辞書も同じ）
- `productName`から決まるもの（tauri-bundler 2.10.4で確かめた）
  - macOS：`.app`の名前（`sonar_spectra.app`）、`CFBundleName`（メニューバーのアプリメニューの名前、「sonar_spectraについて」「sonar_spectraを終了」。T13-5の`getName()`）、`.dmg`の名前
  - Windows：インストーラーの名前（`sonar_spectra_0.1.0_x64-setup.exe`）、インストール先のフォルダー、スタートメニューとデスクトップのショートカットの名前、「アプリと機能」に出る名前、アンインストール情報のレジストリのキー（`…\Uninstall\${PRODUCTNAME}`）
- `identifier`（`com.rinontech.sonar-spectra`）から決まるもの：設定・構成の保存場所（`app_data_dir`）、WebView2のデータ、macOSの録音の許可。**表示名を変えても、これらは変わらない**

## 変更内容

### 1. アプリの表示名を「Sonar Spectra」とする

- SPEC 10節に「アプリ名（表示名）：Sonar Spectra」を足す。大文字小文字とスペースはこのとおり。リポジトリ名・プロジェクト名は`sonar_spectra`のまま。タイトル帯のロゴ（`SONAR/SPECTRA`）は変えない
- 変えるもの
  - `tauri.conf.json`の`productName`、ウィンドウの`title`（`tauri.conf.json`・`tauri.macos.conf.json`）、`index.html`の`<title>`
  - 辞書の`app.window_title`と、アプリ名を含む文言：`config.file_filter`（「Sonar Spectra の構成」）、`config.import_failed`（「…Sonar Spectra で書き出した構成ファイルを選ぶ」）
  - `app_menu.test.ts`の見本の名前、`lib.rs`のApp Napの理由の文（利用者には見えないが、OSの診断に出る）
  - `release.yml`のリリース名（`Sonar Spectra v0.2.0`）
  - README・`CONTRIBUTING.md`の見出しと本文の中のアプリ名。リポジトリのURL・`git clone`・フォルダー名は`sonar_spectra`のまま
- 変えないもの（利用者に見えない識別子、または互換に関わるもの）
  - `identifier`、Cargoの`package.name`（実行ファイルの名前`sonar_spectra`／`sonar_spectra.exe`）、`package.json`の`name`
  - 構成ファイルの形式名`sonar_spectra.config`（0.1.0で書き出したファイルを読めなくなるため）、`localStorage`のキー`sonar_spectra.locale`
  - macOSの集約デバイスとタップの内部の名前（非公開のデバイスで、利用者には見えない）
  - プランアセットのファイル名、`docs/brand/`のマスターSVGの写し（コメント）
- モックは編集しない。SPEC 11節「モックとの差分」に、S01・S09の`app.window_title`は「Sonar Spectra」と読む、と書く（`perm.body`はS09bの取りやめで使わない）

### 2. Windowsの0.1.0からの更新：0.1.0を先にアンインストールしてもらう（→ 承認していただきたい点2）

- 表示名が変わると、インストーラーは別のアプリとして扱う（アンインストール情報のキーとインストール先が変わる）。0.1.0の上から0.2.0を入れると、上書きされずに2つ並んで入る
- 設定・構成は`identifier`の場所にあるので、0.2.0でもそのまま引き継がれる。ただし、0.1.0のアンインストールで「アプリのデータを削除する」にチェックを入れると、0.2.0と共有している設定・構成も消える
- (a)【推奨】READMEと`CHANGELOG.md`（0.2.0のKnown issues）、リリースの説明文で、「0.1.0を入れている場合は、先にアンインストールする（『アプリのデータを削除する』のチェックは外す）。設定と構成は引き継がれる」と案内する。コードは足さない
- (b) NSISのフック（`NSIS_HOOK_PREINSTALL`）で、0.1.0のアンインストール情報が見つかれば、データを残したまま旧版のアンインストーラーを自動で実行する。利用者の手間はないが、フックのスクリプトを持ち、実機での確かめが増える

### 3. 計画への反映

- tasksのPhase 16の先頭に、新しい項目を置く（ID は未使用の番号）
  - T16-7 【エージェント】アプリの表示名を「Sonar Spectra」にする（上の1のとおり）。依存: W15-3。T16-1の依存をT16-7に改める
- T16-1（リリースの説明文）・T16-2（README）・T16-4（CHANGELOGのKnown issues）に、上の2の案内を足す。README・T16-2にある「システム設定の…でsonar_spectraをオンにする」は「Sonar Spectra」と書く
- GitHubは、リリースのファイル名のスペースを`.`に置き換える（例：`Sonar.Spectra_0.2.0_x64-setup.exe`）。READMEに書くファイル名は、T16-6のドラフトで実際の名前を確かめてから合わせる（T16-2・W16-2に足す）
- walk
  - W16-5 【エージェント】（新規）利用者に見える場所（ウィンドウのタイトル、アプリメニュー、インストーラー・`.app`・`.dmg`の名前、辞書、README）にアプリ名`sonar_spectra`が残っていない。変えないものの一覧（上の1）は`sonar_spectra`のまま。`bun run check`が通る
  - W16-3：`.dmg`の名前と、Finder・メニューバーのアプリの名前が「Sonar Spectra」
  - W16-4：「0.1.0の上から」を、READMEの案内どおり0.1.0をアンインストールしてから入れる手順に改め、設定と構成が引き継がれること、スタートメニューと「アプリと機能」の名前が「Sonar Spectra」で、`sonar_spectra`が残っていないことを確かめる（(b)を選んだ場合は、0.1.0の上から入れて、旧版が自動で消えることを確かめる）

## 影響するドキュメント

- `specs/`：プランアセットを全ファイルv9で作り、v8を`archived/`へ移す。中身を変えるのはSPEC（10節・11節）だけで、`tokens.css`・モック・`brand.md`・マスターSVGは版番号だけを上げる
- `planning_dialog/`：imple（1節のプロジェクトの概要、6節のリリース、7節の配布物の名前）・tasks（T16-7の追加、T16-1・T16-2・T16-4の追記、Phase 13の引き継ぎ）・walk（W16-5の追加、W16-3・W16-4の改め）を新しいタイムスタンプで作る
- `timeline.md`：プランアセットv9の行を足す

## 承認していただきたい点

1. 表示名「Sonar Spectra」で、変えるもの・変えないものの線引きを上の1のとおりにしてよいか（特に、実行ファイルの名前と構成ファイルの形式名は`sonar_spectra`のまま）
2. Windowsの0.1.0からの更新は、(a) 案内で先にアンインストールしてもらう【推奨】か、(b) インストーラーで旧版を自動で消すか
3. 実施をPhase 16の先頭（T16-7）に置いてよいか。Phase 14・15の実機の確認より前に名前を変えたい場合は、Phase 14の先頭に置く
