<script setup lang="ts" generic="T extends string">
import type { ChoiceOption } from "./types";

// セレクト。OS標準の一覧を使う（キーボード操作と読み上げをそのまま使えるため）。label は読み上げ用の名前
defineProps<{ label: string; options: readonly ChoiceOption<T>[]; disabled?: boolean }>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div class="ui-select" :class="{ 'is-disabled': disabled }">
    <select v-model="model" class="native ui-focusable" :aria-label="label" :disabled="disabled">
      <option v-for="option in options" :key="option.value" :value="option.value" :disabled="option.disabled">
        {{ option.label }}
      </option>
    </select>
    <span class="chevron" aria-hidden="true" />
  </div>
</template>

<style scoped>
.ui-select {
  position: relative;
  display: flex;
  min-width: 0;
}
.native {
  appearance: none;
  width: 100%;
  min-width: 0;
  padding: var(--space-2) calc(var(--space-3) * 2 + var(--space-2)) var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font-size: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.native:hover {
  border-color: var(--color-neon-b);
}
.native option {
  background: var(--color-surface);
  color: var(--color-text);
}
.chevron {
  position: absolute;
  top: 50%;
  right: var(--space-3);
  width: var(--space-2);
  height: var(--space-2);
  border-right: var(--border-width) solid var(--color-text-muted);
  border-bottom: var(--border-width) solid var(--color-text-muted);
  transform: translateY(-75%) rotate(45deg);
  pointer-events: none;
}
.is-disabled {
  opacity: 0.4;
}
.is-disabled .native {
  cursor: not-allowed;
}
</style>
