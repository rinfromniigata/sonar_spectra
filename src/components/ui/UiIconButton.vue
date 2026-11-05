<script setup lang="ts">
import UiIcon from "./UiIcon.vue";
import type { IconName } from "./icons";

// アイコンだけのボタン。label は読み上げ用の名前（とツールチップ）で、必ず辞書から引いて渡す
withDefaults(
  defineProps<{
    icon: IconName;
    label: string;
    /** md：タイトル帯などの大きさ（文字のボタンと同じ高さ）、sm：一覧の行などの小さいボタン */
    size?: "sm" | "md";
    pressed?: boolean;
    disabled?: boolean;
  }>(),
  { size: "md", pressed: undefined, disabled: false },
);
defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <button
    type="button"
    class="ui-icon-button ui-focusable"
    :class="`is-${size}`"
    :aria-label="label"
    :title="label"
    :aria-pressed="pressed"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <UiIcon :name="icon" :size="size" />
  </button>
</template>

<style scoped>
.ui-icon-button {
  display: inline-grid;
  place-items: center;
  flex: none;
  padding: 0;
  border: var(--border-width) solid var(--color-line);
  color: var(--color-text-muted);
  cursor: pointer;
  transition:
    border-color var(--motion-fast) var(--motion-ease),
    box-shadow var(--motion-fast) var(--motion-ease),
    color var(--motion-fast) var(--motion-ease);
}
.is-md {
  width: var(--control-height);
  height: var(--control-height);
  border-radius: var(--radius-md);
  background: var(--color-scrim);
  color: var(--color-text);
  backdrop-filter: blur(var(--backdrop-blur));
}
.is-sm {
  width: var(--icon-button-size);
  height: var(--icon-button-size);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}
.ui-icon-button:hover,
.ui-icon-button.is-hover {
  color: var(--color-text);
  border-color: var(--color-neon-b);
}
.is-md:hover,
.is-md.is-hover {
  box-shadow: var(--glow-soft-b);
}
.ui-icon-button:active,
.ui-icon-button.is-pressing {
  background: var(--color-surface-raised);
  box-shadow: none;
}
.ui-icon-button[aria-pressed="true"] {
  border-color: var(--color-neon-a);
  color: var(--color-neon-a);
  box-shadow: var(--glow-soft-a);
}
.ui-icon-button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  box-shadow: none;
  border-color: var(--color-line);
  color: var(--color-text-muted);
}
</style>
