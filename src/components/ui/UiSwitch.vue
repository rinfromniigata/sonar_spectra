<script setup lang="ts">
// オン／オフのスイッチ。label は読み上げ用の名前（見出しの文字を横に置く場合も、同じ文言を渡す）
defineProps<{ label: string; disabled?: boolean }>();
const model = defineModel<boolean>({ required: true });
</script>

<template>
  <button
    type="button"
    role="switch"
    class="ui-switch ui-focusable"
    :aria-checked="model"
    :aria-label="label"
    :disabled="disabled"
    @click="model = !model"
  />
</template>

<style scoped>
.ui-switch {
  position: relative;
  flex: none;
  width: var(--switch-width);
  height: var(--switch-height);
  padding: 0;
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-pill);
  background: var(--color-surface-raised);
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease);
}
.ui-switch::after {
  content: "";
  position: absolute;
  top: var(--switch-inset);
  left: var(--switch-inset);
  width: var(--switch-knob);
  height: var(--switch-knob);
  border-radius: 50%;
  background: var(--color-text-muted);
  transition:
    transform var(--motion-fast) var(--motion-ease),
    background-color var(--motion-fast) var(--motion-ease);
}
.ui-switch:hover,
.ui-switch.is-hover {
  border-color: var(--color-neon-b);
}
.ui-switch[aria-checked="true"] {
  border-color: var(--color-neon-a);
}
.ui-switch[aria-checked="true"]::after {
  /* つまみの移動量 = 幅 − 枠線2本 − 内側の余白2つ − つまみ */
  transform: translateX(
    calc(var(--switch-width) - 2 * var(--border-width) - 2 * var(--switch-inset) - var(--switch-knob))
  );
  background: var(--color-neon-a);
  box-shadow: var(--glow-line-a);
}
.ui-switch:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
