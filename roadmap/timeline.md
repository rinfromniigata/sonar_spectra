# sonar_spectra 時系列の索引

- 261105134103 プランアセット v1：プロジェクト・スタート（遡及。初期化は261105125859に実施し、プロジェクト・スタートの合意内容を9節に反映済み）← specs/sonar_spectra_SPEC_v1.md
- 261106105053 プランアセット v2：マスターSVGをApple環境向けアイコン（Liquid Glass）前提のレイヤー構成にし、余白ルールを形式ごとの展開に改める。claude.aiの改訂版を取り込み ← development/261106052155_change_icon_layer_structure.md
- 261109115456 プランアセット v3：構成と自分で作った配色の名前の重複を認めずサフィックスを付け、設定パネルに「上書き保存」を足す ← development/261109114953_change_config_name_unique_and_overwrite.md
- 261110134022 プランアセット v4：フレームレートの上限（60／45／30fps）を設け、図形の描画をWebGL2へ移し、発光をT9-1の推奨案(a)の方式にする ← development/261110124814_change_frame_limit_and_webgl.md
- 261111033238 プランアセット v5：描画を開始できない表示と、入力源の状態の表示（S01b〜S01d）が重ならないよう、中央に1つだけ出す（無音では描画を開始できない表示、使えない・開いている途中では入力源の表示） ← development/261111033031_change_render_unavailable_priority.md
- 261112015333 リリース準備 0.1.0（プランアセット v5）← CHANGELOG.md
- 261113032840 プランアセット v6：macOS（Apple Silicon、macOS 26以降）に対応し、0.2.0として配布する（出力音声の取得、信号機ボタンとタイトル帯〔S09〕、新しい操作スペースを作らない全画面〔S09a〕、録音の許可がないときの表示〔S09b〕、Liquid Glassのアイコン、M1での負荷の確かめ方）。claude.aiの改訂版を取り込み ← development/261113031351_change_macos_support.md
- 261113042727 プランアセット v7：macOSで録音の許可を判定せず、許可がないときの表示（S09b）を取りやめる（許可がないときは無音として見え、無音のあいだの作り直しで許可後に自動で回復する）。Process Tapと集約デバイスを自前で作り、cpalで開く ← development/261113041903_change_macos_permission_and_tap.md
- 261113063837 プランアセット v8：macOSのタイトル帯のダブルクリックを拡大・戻すだけにし（システム設定の「しまう」「何もしない」には従わない）、信号機ボタンを中央にそろえるのは既定の大きさ以上のウィンドウとする。Escで全画面を終える動きは求めない ← development/261113063530_change_macos_title_double_click_and_esc.md
- 261113070700 プランアセット v9：アプリの表示名を「Sonar Spectra」と定め（リポジトリ名・識別子は`sonar_spectra`のまま）、Windowsで0.1.0から更新するときはインストーラーが旧版を自動で取り除く ← development/261113065821_change_app_display_name.md
