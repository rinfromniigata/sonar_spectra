<script setup lang="ts">
// 配色の見本。colors は CSS の色の式（標準の配色は var(--color-neon-a) などのトークン、自分で作った配色は保存した値）
withDefaults(defineProps<{ name: string; colors: readonly string[]; selected?: boolean; disabled?: boolean }>(), {
  selected: false,
  disabled: false,
});
defineEmits<{ select: [] }>();
</script>

<template>
  <button
    type="button"
    class="ui-palette-swatch ui-focusable"
    :aria-pressed="selected"
    :disabled="disabled"
    @click="$emit('select')"
  >
    <span class="chips" aria-hidden="true">
      <i v-for="(color, index) in colors" :key="index" class="chip" :style="{ background: color }" />
    </span>
    <span class="name">{{ name }}</span>
  </button>
</template>

<style scoped>
.ui-palette-swatch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  max-width: 100%;
  padding: var(--space-1) var(--space-2);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: var(--color-text);
  font-size: var(--font-size-sm);
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease);
}
.ui-palette-swatch:hover,
.ui-palette-swatch.is-hover {
  border-color: var(--color-neon-b);
}
.ui-palette-swatch:active {
  background: var(--color-surface-raised);
}
.ui-palette-swatch[aria-pressed="true"] {
  border-color: var(--color-neon-b);
  box-shadow: inset 0 0 0 var(--border-width) var(--color-neon-b);
}
.ui-palette-swatch:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.chips {
  display: inline-flex;
  flex: none;
  gap: var(--space-1);
}
.chip {
  width: var(--swatch-size);
  height: var(--swatch-size);
  border-radius: var(--radius-sm);
}
.name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
