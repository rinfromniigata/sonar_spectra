import { createApp } from "vue";
import "./theme/fonts";
import "./theme/tokens.css";
import "./theme/component_metrics.css";
import "./theme/base.css";
import "./theme/focus_ring.css";
import App from "./App.vue";
import { flushOnClose } from "./app/flush_on_close";
import { setupStores } from "./app/stores";
import { i18n, initLocale } from "./i18n";

// ロケールを確定し（<html lang> を合わせ）、保存された構成を復元してからマウントする
void (async () => {
  await initLocale();
  const app = createApp(App).use(i18n);
  const { config } = await setupStores(app);
  app.mount("#app");
  // 閉じるときに、間を置いている保存を済ませる（Tauri の外では使えないので、失敗は記録だけする）
  flushOnClose(config.flush).catch((error: unknown) => console.error(error));
})();
