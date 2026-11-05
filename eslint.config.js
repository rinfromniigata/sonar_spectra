// ESLint の設定（フラットコンフィグ）。主な目的は、UIの文字列の直書きと、辞書を経由しない翻訳の検出。
import pluginVue from "eslint-plugin-vue";
import vueI18n from "@intlify/eslint-plugin-vue-i18n";
import tseslint from "typescript-eslint";

// 日本語・中国語などの文字（ひらがな・カタカナ・CJK統合漢字・全角記号）
const CJK = "[\\u3000-\\u30ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uff00-\\uffef]";

// スクリプト内の直書き：CJK文字を含む文字列リテラルとテンプレートリテラル
const noRawTextInScript = [
  {
    selector: `Literal[value=/${CJK}/]`,
    message: "UIの文字列を直書きしないでください。辞書（src/i18n/locales/ja.ts）に置き、useT() の t で参照します。",
  },
  {
    selector: `TemplateElement[value.raw=/${CJK}/]`,
    message: "UIの文字列を直書きしないでください。辞書（src/i18n/locales/ja.ts）に置き、useT() の t で参照します。",
  },
];

// 辞書を経由しない翻訳：vue-i18n の直接の使用と、注入しない $t などの参照
const noDirectI18n = {
  paths: [
    {
      name: "vue-i18n",
      message: "文言は src/i18n/use_t.ts の useT() から引いてください（キーとプレースホルダを型検査するため）。",
    },
  ],
};
const noGlobalTranslators = {
  selector: "Identifier[name=/^\\$(t|tc|te|tm|rt|d|n)$/]",
  message: "$t などは使えません（注入していません）。useT() の t を使ってください。",
};

export default tseslint.config(
  {
    ignores: ["dist/**", "src-tauri/**", "node_modules/**", "roadmap/**", "docs/**", "**/*.json", "**/*.json5", "**/*.yaml", "**/*.yml"],
  },
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/essential"],
  ...vueI18n.configs["flat/base"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: { parser: tseslint.parser, extraFileExtensions: [".vue"] },
    },
  },
  {
    settings: {
      "vue-i18n": {
        // 辞書はTypeScriptで書いているため、辞書ファイルを読む規則（キーの有無など）は使わない。
        // キーの有無とプレースホルダは vue-tsc（useT の型）と scripts/i18n_check.ts で検査する
        localeDir: undefined,
        messageSyntaxVersion: "^11.0.0",
      },
    },
    rules: {
      "@intlify/vue-i18n/no-raw-text": [
        "error",
        {
          // 読み上げ用の名前や説明も、辞書から引く
          attributes: { "/.+/": ["aria-label", "aria-description", "title", "placeholder", "alt"] },
          // 記号・数字だけの文字列は対象外
          ignorePattern: "^[\\s\\-–—/·×+=:;.,…|()\\[\\]%#0-9]+$",
        },
      ],
      "@intlify/vue-i18n/no-missing-keys": "off",
      "@intlify/vue-i18n/no-dynamic-keys": "off",
      "@intlify/vue-i18n/no-v-html": "error",
      "no-restricted-imports": ["error", noDirectI18n],
      "no-restricted-syntax": ["error", ...noRawTextInScript, noGlobalTranslators],
      "vue/no-restricted-syntax": ["error", noGlobalTranslators],
    },
  },
  {
    // 辞書と i18n の基盤だけは、vue-i18n の直接の使用と日本語の文字列を許す
    files: ["src/i18n/**/*.ts"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  },
  {
    // 検査用スクリプトとテストは、メッセージや試験データに日本語を使う
    files: ["scripts/**/*.ts", "**/*.test.ts", "eslint.config.js"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
);
