<script setup lang="ts">
import { defineAsyncComponent, onBeforeUnmount, onMounted, ref } from "vue";

// メーター画面は T2-14 で組み立てる。ここでは雛形の枠と、開発時だけ開ける部品ギャラリーを置く

/** 開発時だけ読み込む（公開版のビルドでは import.meta.env.DEV が false になり、ギャラリーごと除かれる） */
const PartsGallery = import.meta.env.DEV ? defineAsyncComponent(() => import("./dev/PartsGallery.vue")) : null;
const GALLERY_HASH = "#parts";

const showGallery = ref(false);

function syncWithHash(): void {
  showGallery.value = PartsGallery !== null && location.hash === GALLERY_HASH;
}

function onKeydown(event: KeyboardEvent): void {
  // Ctrl+Shift+P：メーター画面と部品ギャラリーを切り替える
  if (!PartsGallery || !event.ctrlKey || !event.shiftKey || event.code !== "KeyP") return;
  event.preventDefault();
  location.hash = showGallery.value ? "" : GALLERY_HASH;
}

onMounted(() => {
  syncWithHash();
  window.addEventListener("hashchange", syncWithHash);
  if (PartsGallery) window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener("hashchange", syncWithHash);
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <component :is="PartsGallery" v-if="PartsGallery && showGallery" />
  <main v-else class="app-root"></main>
</template>
