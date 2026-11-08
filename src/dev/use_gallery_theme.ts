// 開発用ギャラリーのテーマ切り替え：ダークとライトで見比べる（設定の theme とは別に、ギャラリーの中だけで切り替える）。
// 文書の data-theme を付け外しし、ギャラリーを閉じたら元に戻す。

import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useT } from "../i18n/use_t";

export type GalleryTheme = "dark" | "light" | "system";

export function useGalleryTheme() {
  const { t } = useT();
  const theme = ref<GalleryTheme>((document.documentElement.dataset.theme as GalleryTheme | undefined) ?? "system");
  const themeOptions = computed(() => [
    { value: "dark" as const, label: t("settings.theme_dark") },
    { value: "light" as const, label: t("settings.theme_light") },
    { value: "system" as const, label: t("settings.theme_system") },
  ]);
  const initialTheme = document.documentElement.dataset.theme;
  watch(
    theme,
    (value) => {
      if (value === "system") delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = value;
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    if (initialTheme) document.documentElement.dataset.theme = initialTheme;
    else delete document.documentElement.dataset.theme;
  });
  return { theme, themeOptions };
}
