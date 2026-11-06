<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref } from "vue";
import MeterScreen from "./components/MeterScreen.vue";

// メーター画面を常に表示する。開発時だけ、部品ギャラリー（#parts）とモジュールギャラリー（#modules）に切り替えられる。
// ドロワー・レイアウト編集などの重ねる画面は、作る Phase で MeterScreen に加える

/** 開発時だけ読み込む（公開版のビルドでは import.meta.env.DEV が false になり、ギャラリーごと除かれる） */
const PartsGallery = import.meta.env.DEV ? defineAsyncComponent(() => import("./dev/PartsGallery.vue")) : null;
const ModuleGallery = import.meta.env.DEV ? defineAsyncComponent(() => import("./dev/ModuleGallery.vue")) : null;
const PARTS_HASH = "#parts";
const MODULES_HASH = "#modules";

/** 今開いているギャラリー。なければ null（メーター画面） */
const gallery = ref<"parts" | "modules" | null>(null);

function syncWithHash(): void {
  if (PartsGallery && location.hash === PARTS_HASH) gallery.value = "parts";
  else if (ModuleGallery && location.hash === MODULES_HASH) gallery.value = "modules";
  else gallery.value = null;
}

function onKeydown(event: KeyboardEvent): void {
  // Ctrl+Shift+P：メーター画面と部品ギャラリー、Ctrl+Shift+M：メーター画面とモジュールギャラリーを切り替える
  if (!event.ctrlKey || !event.shiftKey) return;
  const target = event.code === "KeyP" ? "parts" : event.code === "KeyM" ? "modules" : null;
  if (!target) return;
  event.preventDefault();
  location.hash = gallery.value === target ? "" : target === "parts" ? PARTS_HASH : MODULES_HASH;
}

onMounted(() => {
  syncWithHash();
  window.addEventListener("hashchange", syncWithHash);
  if (PartsGallery || ModuleGallery) window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener("hashchange", syncWithHash);
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <component :is="PartsGallery" v-if="PartsGallery && gallery === 'parts'" />
  <component :is="ModuleGallery" v-else-if="ModuleGallery && gallery === 'modules'" />
  <MeterScreen v-else />
</template>
