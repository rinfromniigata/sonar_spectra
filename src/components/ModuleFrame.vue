<script setup lang="ts">
// モジュールの枠：見出しと Canvas を持ち、流れる方向に合わせて Canvas の座標系を回す。
// 描画側（ModuleRenderer）は常に既定の向きで描けばよく、目盛りや文字も座標系と一緒に回る。
// 見出しは枠の左上に置いたまま回さない（モックと同じ）。
// 描画ループ（src/render）が provide されていれば、マウント時に自分を登録し、ループが毎フレーム draw() を呼ぶ。
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { resolvePaletteColors } from "../config/palettes";
import type { Instance } from "../config/types";
import { useT } from "../i18n/use_t";
import { directionTransform, logicalSize, quarterTurns } from "../modules/direction";
import type { ModuleKind, ModuleOptions } from "../modules/options";
import type { AnyModuleDefinition, FrameDrawInput, Geometry, ModuleRenderer, PaletteColors } from "../modules/types";
import { RENDER_LOOP_KEY } from "../render/use_render_loop";
import type { CanvasColors } from "../theme/canvas_colors";

const props = defineProps<{ instance: Instance; definition: AnyModuleDefinition }>();

const { t } = useT();
const label = computed(() => t(props.definition.labelKey));

const loop = inject(RENDER_LOOP_KEY, null);
let unregister: (() => void) | null = null;

const root = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);

type AnyRenderer = ModuleRenderer<ModuleOptions[ModuleKind]>;
let context: CanvasRenderingContext2D | null = null;
let renderer: AnyRenderer | null = null;
let observer: ResizeObserver | null = null;
/** 枠の大きさ（CSS ピクセル、回す前） */
let boxWidth = 0;
let boxHeight = 0;
let geometry: Geometry | null = null;

// 配色はインスタンスと色の組が変わったときだけ当て直す
let paletteCache: { paletteId: string; colors: CanvasColors; result: PaletteColors } | null = null;
function paletteColors(colors: CanvasColors): PaletteColors {
  const paletteId = props.instance.paletteId;
  if (!paletteCache || paletteCache.paletteId !== paletteId || paletteCache.colors !== colors) {
    paletteCache = { paletteId, colors, result: resolvePaletteColors(paletteId, colors) };
  }
  return paletteCache.result;
}

/** 大きさ・向き・DPR を読み直し、変わっていたらキャンバスを作り直して描画側に知らせる */
function updateGeometry(): void {
  const el = root.value;
  const cv = canvas.value;
  if (!el || !cv || !renderer || !context) return;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const turns = quarterTurns(props.definition.baseDirection, props.instance.direction);
  const size = logicalSize(rect.width, rect.height, turns);
  const next: Geometry = { width: size.width, height: size.height, devicePixelRatio: dpr, quarterTurns: turns };
  if (
    geometry &&
    geometry.width === next.width &&
    geometry.height === next.height &&
    geometry.devicePixelRatio === next.devicePixelRatio &&
    geometry.quarterTurns === next.quarterTurns
  ) {
    return;
  }
  boxWidth = rect.width;
  boxHeight = rect.height;
  // 幅・高さを設定し直すとキャンバスは消える。大きさが同じで向きだけ変わったときは明示的に消す
  const pixelWidth = Math.max(1, Math.round(rect.width * dpr));
  const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
  if (cv.width !== pixelWidth || cv.height !== pixelHeight) {
    cv.width = pixelWidth;
    cv.height = pixelHeight;
  } else {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, cv.width, cv.height);
  }
  geometry = next;
  renderer.resize(next);
}

/** 1回分を描く（描画ループから呼ぶ） */
function draw(input: FrameDrawInput): void {
  if (!renderer || !context || !geometry || !props.instance.enabled) return;
  context.setTransform(...directionTransform(geometry.quarterTurns, boxWidth, boxHeight, geometry.devicePixelRatio));
  renderer.draw(input.frame, input.histories, props.instance.options, paletteColors(input.colors), input.dt);
}

defineExpose({ draw });

onMounted(() => {
  context = canvas.value?.getContext("2d") ?? null;
  if (!context) return;
  renderer = props.definition.createRenderer({ ctx: context, translate: t }) as AnyRenderer;
  updateGeometry();
  observer = new ResizeObserver(updateGeometry);
  if (root.value) observer.observe(root.value);
  unregister = loop?.register({ draw }) ?? null;
});

watch(() => props.instance.direction, updateGeometry);

onBeforeUnmount(() => {
  unregister?.();
  observer?.disconnect();
  renderer?.dispose();
  renderer = null;
  context = null;
});
</script>

<template>
  <section ref="root" class="module-frame" :data-kind="instance.kind" :aria-label="label">
    <span class="tag" aria-hidden="true">{{ label }}</span>
    <canvas ref="canvas" aria-hidden="true" />
  </section>
</template>

<style scoped>
.module-frame {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--color-bg);
  container-type: inline-size;
}

.module-frame canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}

.tag {
  position: absolute;
  top: var(--space-1);
  left: var(--space-2);
  z-index: 1;
  color: var(--color-text-muted);
  font-family: var(--font-numeric);
  font-size: clamp(var(--module-tag-min-size), var(--module-tag-fluid-size), var(--font-size-xs));
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  white-space: nowrap;
  pointer-events: none;
}
</style>
