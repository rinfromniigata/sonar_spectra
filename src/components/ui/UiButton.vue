<script setup lang="ts">
// 文字のボタン。文言は呼び出し側が useT() で引いてスロットに入れる
withDefaults(
  defineProps<{
    variant?: "default" | "primary";
    /** 切り替えボタンのときの選択状態（aria-pressed）。普通のボタンでは指定しない */
    pressed?: boolean;
    wide?: boolean;
    disabled?: boolean;
  }>(),
  { variant: "default", pressed: undefined, wide: false, disabled: false },
);
defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <button
    type="button"
    class="ui-button ui-focusable"
    :class="{ 'is-primary': variant === 'primary', 'is-wide': wide }"
    :aria-pressed="pressed"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<style scoped>
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
  min-width: var(--control-height);
  min-height: var(--control-height);
  padding: 0 var(--space-3);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-scrim);
  color: var(--color-text);
  font-size: var(--font-size-xs);
  line-height: 1.3;
  cursor: pointer;
  backdrop-filter: blur(var(--backdrop-blur));
  transition:
    border-color var(--motion-fast) var(--motion-ease),
    box-shadow var(--motion-fast) var(--motion-ease),
    background-color var(--motion-fast) var(--motion-ease);
}
.ui-button:hover,
.ui-button.is-hover {
  border-color: var(--color-neon-b);
  box-shadow: var(--glow-soft-b);
}
.ui-button:active,
.ui-button.is-pressing {
  background: var(--color-surface-raised);
  box-shadow: none;
}
.ui-button[aria-pressed="true"] {
  border-color: var(--color-neon-a);
  color: var(--color-neon-a);
  box-shadow: var(--glow-soft-a);
}
.ui-button.is-primary {
  border-color: var(--color-neon-a);
  box-shadow: var(--glow-soft-a);
}
.ui-button.is-wide {
  width: 100%;
}
.ui-button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  box-shadow: none;
  border-color: var(--color-line);
  color: var(--color-text);
}
</style>
