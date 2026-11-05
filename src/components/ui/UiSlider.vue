<script setup lang="ts">
// スライダー。valueText は今の値を整形した文字列（Intl で整形して渡す）。読み上げにも使う
withDefaults(
  defineProps<{ label: string; min: number; max: number; step?: number; valueText: string; disabled?: boolean }>(),
  { step: 1, disabled: false },
);
const model = defineModel<number>({ required: true });
</script>

<template>
  <div class="ui-slider" :class="{ 'is-disabled': disabled }">
    <input
      v-model.number="model"
      class="range ui-focusable"
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :aria-label="label"
      :aria-valuetext="valueText"
      :disabled="disabled"
    />
    <output class="value" aria-hidden="true">{{ valueText }}</output>
  </div>
</template>

<style scoped>
.ui-slider {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}
.range {
  flex: 1;
  min-width: 0;
  margin: 0;
  accent-color: var(--color-neon-a);
  cursor: pointer;
}
.value {
  flex: none;
  min-width: var(--slider-value-min-width);
  font-family: var(--font-numeric);
  font-size: var(--font-size-sm);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.is-disabled {
  opacity: 0.4;
}
.is-disabled .range {
  cursor: not-allowed;
}
</style>
