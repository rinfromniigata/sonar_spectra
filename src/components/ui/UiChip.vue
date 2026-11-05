<script setup lang="ts">
import type { ChipStatus } from "./types";

// 状態つきのチップ（タイトル帯の出力系統など）。text は表示する文言で、押すと click を出す。
// label を渡すと、読み上げ用の名前は「label」になり、text は説明（title）に回る
defineProps<{ status: ChipStatus; text: string; label?: string }>();
defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <button
    type="button"
    class="ui-chip ui-focusable"
    :aria-label="label || undefined"
    :aria-description="label ? text : undefined"
    :title="text"
    @click="$emit('click', $event)"
  >
    <span class="dot" :class="`is-${status}`" aria-hidden="true" />
    <span class="text">{{ text }}</span>
  </button>
</template>

<style scoped>
.ui-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  max-width: var(--chip-max-width);
  height: var(--chip-height);
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-pill);
  background: var(--color-scrim);
  color: var(--color-text);
  font-size: var(--font-size-xs);
  cursor: pointer;
  backdrop-filter: blur(var(--backdrop-blur));
  transition: border-color var(--motion-fast) var(--motion-ease);
}
.ui-chip:hover,
.ui-chip.is-hover {
  border-color: var(--color-neon-b);
}
.ui-chip:active {
  background: var(--color-surface-raised);
}
.dot {
  flex: none;
  width: var(--chip-dot);
  height: var(--chip-dot);
  border-radius: 50%;
}
.dot.is-live {
  background: var(--color-neon-b);
  box-shadow: var(--glow-line-b);
}
.dot.is-silent {
  background: var(--color-text-muted);
}
.dot.is-unavailable {
  background: var(--color-danger);
  box-shadow: 0 0 var(--space-2) var(--color-danger);
}
.text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
