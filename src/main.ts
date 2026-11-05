import { createApp } from "vue";
import "./theme/fonts";
import "./theme/tokens.css";
import "./theme/base.css";
import App from "./App.vue";
import { i18n, initLocale } from "./i18n";

// ロケールを確定してから（<html lang> を合わせてから）マウントする
void initLocale().then(() => {
  createApp(App).use(i18n).mount("#app");
});
