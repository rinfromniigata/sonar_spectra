<script setup lang="ts" generic="T extends string">
import type { ChoiceOption } from "./types";

// セグメント切り替え（どれか1つを選ぶ）。label はグループの読み上げ用の名前
defineProps<{ label: string; options: readonly ChoiceOption<T>[]; disabled?: boolean }>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div class="ui-segmented" role="group" :aria-label="label">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      class="segment ui-focusable"
      :aria-pressed="model === option.value"
      :disabled="disabled || option.disabled"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.ui-segmented {
  display: inline-flex;
  flex-wrap: wrap;
  max-width: 100%;
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.segment {
  min-width: 0;
  padding: var(--space-1) var(--space-3);
  border: 0;
  background: var(--color-surface);
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
  cursor: pointer;
}
.segment + .segment {
  border-left: var(--border-width) solid var(--color-line);
}
.segment:hover {
  color: var(--color-text);
}
.segment:active {
  background: var(--color-surface-raised);
}
.segment[aria-pressed="true"] {
  background: var(--color-surface-raised);
  color: var(--color-text);
  box-shadow: inset 0 calc(-1 * var(--indicator-width)) 0 var(--color-neon-b);
}
.segment.ui-focusable:focus-visible {
  /* 枠の外にはみ出すと overflow で切れるため、内側に描く */
  outline-offset: calc(-1 * var(--focus-ring-width));
}
.segment:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
