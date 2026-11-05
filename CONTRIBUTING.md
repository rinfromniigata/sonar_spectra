# sonar_spectra 開発ガイド

不具合の報告はIssueで受け付けます。プルリクエストは、事前にIssueで相談してください。

## 開発環境

初版はWindows x64だけに対応しています（出力音声の取得にWASAPIのループバックを使うため）。

- Windows 10／11（x64）
- [Bun](https://bun.sh/)：ランタイムとパッケージマネージャ
- [Rust](https://www.rust-lang.org/tools/install)：stable。edition 2024を使うため、1.85以降
- Microsoft C++ Build Tools：「C++によるデスクトップ開発」のワークロード
- Microsoft Edge WebView2 Runtime：Windows 11には同梱されています

Tauriの前提条件の詳細は、[Tauriの公式ドキュメント](https://tauri.app/start/prerequisites/)を参照してください。

主な依存は次のとおりです。版は`package.json`と`src-tauri/Cargo.toml`で固定しています。

- Tauri 2（2.12系）
- Vue 3（3.5系）、Vite（8.3系）、TypeScript

## セットアップ

```sh
git clone https://github.com/rinfromniigata/sonar_spectra.git
cd sonar_spectra
bun install
```

開発版を起動します（初回はRust側のビルドに数分かかります）。

```sh
bun run tauri dev
```
