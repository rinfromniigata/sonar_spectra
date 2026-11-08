import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Vite の設定（vue-i18n の機能フラグなど）を引き継いで、単体テストを動かす
export default defineConfig((env) =>
  mergeConfig(viteConfig(env), {
    test: {
      include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
      environment: "node",
      // 部品の寸法（?raw で文字として読み、部品が参照する寸法が定義されているかを確かめるテストがある）
      css: { include: [/component_metrics\.css/, /theme[\\/]tokens\.css/] },
    },
  }),
);
