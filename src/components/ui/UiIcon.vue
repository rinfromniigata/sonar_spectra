<script setup lang="ts">
import { computed } from "vue";
import { ICONS, type IconName, type IconShape } from "./icons";

// 飾りのアイコン。読み上げ用の名前は、アイコンを置くボタンの側に付ける
const props = withDefaults(defineProps<{ name: IconName; size?: "sm" | "md" }>(), { size: "md" });
const shapes = computed<IconShape[]>(() => ICONS[props.name]);
</script>

<template>
  <svg class="ui-icon" :class="`is-${size}`" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <template v-for="(shape, index) in shapes" :key="index">
      <path v-if="shape.tag === 'path'" :d="shape.d" />
      <circle v-else-if="shape.tag === 'circle'" :cx="shape.cx" :cy="shape.cy" :r="shape.r" />
      <rect v-else :x="shape.x" :y="shape.y" :width="shape.width" :height="shape.height" />
    </template>
  </svg>
</template>

<style scoped>
.ui-icon {
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.is-sm {
  width: var(--icon-size-sm);
  height: var(--icon-size-sm);
  stroke-width: var(--icon-stroke-sm);
}
.is-md {
  width: var(--icon-size-md);
  height: var(--icon-size-md);
  stroke-width: var(--icon-stroke-md);
}
</style>
