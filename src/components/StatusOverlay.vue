<script setup lang="ts">
// 入力源の状態の表示（メーターの上に重ねる）。
// - 無音（S01b）：メーターを隠さない細い表示。脈動する点と「音を待っています」
// - 入力源が使えない（S01c）：説明と、「再試行」「設定」のボタン
// - 起動中・切り替え中（S01d）：スピナーと「入力源を開いています」。切り替えが一瞬で終わるときにちらつかないよう、少し待ってから出す
// タイトル帯の下から始まる（--title-h）。「再試行」は入力源を開き直す。「設定」は openSettings で知らせ、MeterScreen が設定パネルを開く
import { computed } from "vue";
import { useT } from "../i18n/use_t";
import { overlayMode, retrySource, type SourceStatusEvent } from "../source";
import UiButton from "./ui/UiButton.vue";

const props = defineProps<{
  /** 入力源の状態。まだ届いていなければ null（起動中として表示する） */
  source: SourceStatusEvent | null;
}>();
defineEmits<{ openSettings: [] }>();

const { t } = useT();
const mode = computed(() => overlayMode(props.source));

function retry(): void {
  retrySource().catch((error: unknown) => console.error(error));
}
</script>

<template>
  <div
    v-if="mode !== 'none'"
    class="status-overlay"
    :class="`is-${mode}`"
    :role="mode === 'unavailable' ? 'alert' : 'status'"
  >
    <template v-if="mode === 'silent'">
      <span class="pulse" aria-hidden="true" />
      <p class="body">{{ t("status.silent") }}</p>
    </template>
    <template v-else-if="mode === 'opening'">
      <span class="spinner" aria-hidden="true" />
      <p class="body">{{ t("status.opening") }}</p>
    </template>
    <template v-else>
      <p class="title">{{ t("status.unavailable_title") }}</p>
      <p class="body">{{ t("status.unavailable_body") }}</p>
      <div class="actions">
        <UiButton variant="primary" @click="retry">{{ t("common.retry") }}</UiButton>
        <UiButton @click="$emit('openSettings')">{{ t("status.open_settings") }}</UiButton>
      </div>
    </template>
  </div>
</template>

<style scoped>
.status-overlay {
  position: absolute;
  inset: var(--title-h) 0 0 0;
  z-index: 4;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: var(--space-3);
  padding: var(--space-5);
  background: var(--color-scrim);
  text-align: center;
  container-type: inline-size;
}

/* 無音：メーターを隠さず、操作もさえぎらない */
.is-silent {
  background: transparent;
  pointer-events: none;
}

/* 起動中・切り替え中：少し待ってから出す */
.is-opening {
  animation: fade-in var(--motion-base) var(--motion-ease) var(--overlay-opening-delay) backwards;
}

.title {
  margin: 0;
  color: var(--color-danger);
  font-family: var(--font-ui);
  font-size: clamp(var(--overlay-title-min), 2.2cqi, 1.5rem);
  font-weight: 700;
  text-wrap: balance;
}

.body {
  max-width: 52ch;
  margin: 0;
  color: var(--color-text-muted);
  font-size: clamp(var(--overlay-body-min), 1.4cqi, var(--font-size-md));
}

.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-2);
}

.pulse {
  width: var(--pulse-size);
  height: var(--pulse-size);
  border-radius: 50%;
  background: var(--color-neon-a);
  box-shadow: var(--glow-line-a);
  animation: pulse 1.6s var(--motion-ease) infinite;
}

.spinner {
  width: var(--spinner-size);
  height: var(--spinner-size);
  border: var(--spinner-border) solid var(--color-line);
  border-top-color: var(--color-neon-b);
  border-radius: 50%;
  box-shadow: var(--glow-soft-b);
  animation: spin 0.9s linear infinite;
}

@keyframes pulse {
  50% {
    opacity: 0.25;
    transform: scale(0.7);
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes fade-in {
  from {
    opacity: 0;
  }
}

/* 動きを減らす設定のときは、動かさない（待ちもなくして、すぐ出す） */
@media (prefers-reduced-motion: reduce) {
  .pulse,
  .spinner,
  .is-opening {
    animation: none;
  }
}
</style>
