// 書体はアプリに同梱する（ネットワーク通信をしないため）。
// 読み込む字重は、モックで使っているものに限る。
// ロケールごとの --font-ui の切り替えは tokens.css の :lang() が受け持つ。

// 表示用（ロゴ・見出し）
import "@fontsource/syncopate/400.css";
import "@fontsource/syncopate/700.css";

// 数値
import "@fontsource/azeret-mono/400.css";
import "@fontsource/azeret-mono/600.css";

// UI（日本語）
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/500.css";
import "@fontsource/zen-kaku-gothic-new/700.css";
