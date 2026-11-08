import { createApp } from "vue";
import "./theme/fonts";
import "./theme/tokens.css";
import "./theme/component_metrics.css";
import "./theme/base.css";
import "./theme/focus_ring.css";
import App from "./App.vue";
import { beforeClose } from "./app/before_close";
import { setupStores } from "./app/stores";
import { i18n, initLocale } from "./i18n";
import { bindTheme } from "./theme/apply_theme";
import { WINDOW_CONTROLLER_KEY, createWindowController, tauriWindowApi } from "./window";

// ロケールを確定し（<html lang> を合わせ）、保存された構成を復元してからマウントする
void (async () => {
  await initLocale();
  const app = createApp(App).use(i18n);
  const { config, runtime } = await setupStores(app);
  // 保存されたテーマを、最初の表示の前に反映する
  bindTheme(config);
  // 常に最前面と起動時の全画面を、最初の表示の前に反映する（Tauri の外では失敗を記録するだけで、先へ進む）
  const windowController = createWindowController({ api: tauriWindowApi(), config, runtime });
  app.provide(WINDOW_CONTROLLER_KEY, windowController);
  await windowController.start();
  app.mount("#app");
  // 閉じる前に、間を置いている保存を済ませ、全画面なら終える（Tauri の外では使えないので、失敗は記録だけする）
  beforeClose(() => Promise.all([config.flush(), windowController.leaveFullscreenForClose()]).then(() => undefined)).catch(
    (error: unknown) => console.error(error),
  );
})();
