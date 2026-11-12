import { createApp } from "vue";
import "./theme/fonts";
import "./theme/tokens.css";
import "./theme/theme_aliases.css";
import "./theme/component_metrics.css";
import "./theme/base.css";
import "./theme/focus_ring.css";
import App from "./App.vue";
import { beforeClose } from "./app/before_close";
import { setupStores } from "./app/stores";
import { i18n, initLocale } from "./i18n";
import { globalT } from "./i18n/use_t";
import { getPlatform, installAppMenu } from "./platform";
import { bindTheme } from "./theme/apply_theme";
import { WINDOW_CONTROLLER_KEY, createWindowController, tauriWindowApi } from "./window";

// ロケールを確定し（<html lang> を合わせ）、保存された構成を復元してからマウントする
void (async () => {
  await initLocale();
  const app = createApp(App).use(i18n);
  const { config, runtime } = await setupStores(app);
  // OSの種類で、タイトル帯の形と全画面の方式を選ぶ（Tauri の外では "other"）
  const platform = await getPlatform();
  runtime.platform.value = platform;
  // macOS のメニューバー（アプリメニューと「編集」）を辞書の文言で組む。組めなければ Tauri の既定のメニューのまま
  if (platform === "macos") installAppMenu(globalT()).catch((error: unknown) => console.error(error));
  // 保存されたテーマを、最初の表示の前に反映する
  bindTheme(config);
  // 常に最前面と起動時の全画面を、最初の表示の前に反映する（Tauri の外では失敗を記録するだけで、先へ進む）
  const windowController = createWindowController({ api: tauriWindowApi(platform), config, runtime });
  app.provide(WINDOW_CONTROLLER_KEY, windowController);
  await windowController.start();
  app.mount("#app");
  // 閉じる前に、間を置いている保存を済ませ、全画面なら終える（Tauri の外では使えないので、失敗は記録だけする）
  beforeClose(() => Promise.all([config.flush(), windowController.leaveFullscreenForClose()]).then(() => undefined)).catch(
    (error: unknown) => console.error(error),
  );
})();
