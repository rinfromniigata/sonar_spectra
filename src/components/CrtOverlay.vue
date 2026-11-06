<script setup lang="ts">
// 走査線と周辺減光（モックの .crt）：画面全体に重ねる、見た目だけの層。
// - 走査線：横に細い線を一定の間隔で並べる。周辺減光：中央は透明で、周辺に向けて暗くする
// - 色はテーマごとのトークン（--color-scanline・--color-vignette）から取り、ライトでは薄くなる
// - 操作をさえぎらない（pointer-events: none）。タイトル帯・状態の表示・設定パネルより上に重なる
// - 表示するかは、設定の display.scanline（既定でオン）。切り替えの UI は設定パネルを作る Phase 4 でつなぐ
withDefaults(defineProps<{ enabled?: boolean }>(), { enabled: true });
</script>

<template>
  <div v-if="enabled" class="crt-overlay" aria-hidden="true" />
</template>

<style scoped>
.crt-overlay {
  position: absolute;
  inset: 0;
  z-index: 7;
  pointer-events: none;
  background:
    repeating-linear-gradient(
      to bottom,
      transparent 0 var(--scanline-gap),
      var(--color-scanline) var(--scanline-gap) calc(var(--scanline-gap) + var(--scanline-width))
    ),
    radial-gradient(ellipse at center, transparent var(--vignette-clear), var(--color-vignette) 100%);
}
</style>
