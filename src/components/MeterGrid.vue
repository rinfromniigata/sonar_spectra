<script setup lang="ts">
// メーターの格子（12列×8行）。自動配置では、格子の大きさから画面比を求めて autoArrange で並べ直す
// （ウィンドウの大きさを変えるたび・全画面にしたとき）。手動配置では、各インスタンスの rect に置く。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import type { GridRect, Instance } from "../config/types";
import { autoArrange } from "../layout/auto_arrange";
import { GRID_COLUMNS, GRID_ROWS } from "../layout/grid";
import { moduleRegistry, type ModuleRegistry } from "../modules/registry";
import type { AnyModuleDefinition } from "../modules/types";
import ModuleFrame from "./ModuleFrame.vue";

const props = withDefaults(
  defineProps<{
    instances: readonly Instance[];
    mode: "auto" | "manual";
    registry?: ModuleRegistry;
  }>(),
  { registry: () => moduleRegistry },
);

const root = ref<HTMLElement | null>(null);
/** 格子の幅÷高さ。測るまでは 16:9 とみなす */
const aspect = ref(16 / 9);
let observer: ResizeObserver | null = null;

function measure(): void {
  const rect = root.value?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) aspect.value = rect.width / rect.height;
}

onMounted(() => {
  measure();
  observer = new ResizeObserver(measure);
  if (root.value) observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());

interface Placed {
  instance: Instance;
  definition: AnyModuleDefinition;
  rect: GridRect;
}

const placed = computed<Placed[]>(() => {
  const layout = props.mode === "auto" ? autoArrange(props.instances, aspect.value, (kind) => props.registry.get(kind)?.shape ?? "free") : null;
  return props.instances.flatMap((instance) => {
    if (!instance.enabled) return [];
    const definition = props.registry.get(instance.kind) as AnyModuleDefinition | undefined;
    const rect = layout ? layout.rects.get(instance.id) : instance.rect;
    if (!definition || !rect) return [];
    // 自動整列が方向を決めるもの（縦長の帯のレベル）は、その方向で描く
    const direction = layout?.directions.get(instance.id);
    const shown = direction && direction !== instance.direction ? ({ ...instance, direction } as Instance) : instance;
    return [{ instance: shown, definition, rect }];
  });
});

function gridArea(rect: GridRect): string {
  return `${rect.r} / ${rect.c} / span ${rect.rs} / span ${rect.cs}`;
}
</script>

<template>
  <div
    ref="root"
    class="meter-grid"
    :style="{ '--grid-columns': GRID_COLUMNS, '--grid-rows': GRID_ROWS }"
  >
    <ModuleFrame
      v-for="item in placed"
      :key="item.instance.id"
      :instance="item.instance"
      :definition="item.definition"
      :style="{ gridArea: gridArea(item.rect) }"
    />
  </div>
</template>

<style scoped>
.meter-grid {
  display: grid;
  grid-template-columns: repeat(var(--grid-columns), minmax(0, 1fr));
  grid-template-rows: repeat(var(--grid-rows), minmax(0, 1fr));
  gap: var(--border-width);
  min-width: 0;
  min-height: 0;
  background: var(--color-line);
}
</style>
