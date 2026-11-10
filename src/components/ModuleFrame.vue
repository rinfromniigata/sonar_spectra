<script setup lang="ts">
// モジュールの枠：見出しと Canvas を持ち、流れる方向に合わせて Canvas の座標系を回す。
// 描画側（ModuleRenderer）は常に既定の向きで描けばよく、目盛りや文字も座標系と一緒に回る。
// 見出しは枠の左上に置いたまま回さない（モックと同じ）。
// 描画ループ（src/render）が provide されていれば、マウント時に自分を登録し、ループが毎フレーム draw() を呼ぶ。
// 描画の層（v4。共有の WebGL2 キャンバス。MeterGrid と開発用のギャラリーが provide する）があれば、Canvas は文字の層になり、
// 地は透明にする（地の色は描画の層が塗る）。図形は描画の層の受け口（ShapeSink）へ出す。描画の層を作れない・失っているときは
// 描かない（Canvas 2D の描き方へは戻さない）。描画の層がないとき（部品だけを組み立てたとき）は、地をこの枠が塗り、図形は捨てる。
// レイアウト編集中は描画を薄くする：文字の層は CSS の opacity で、図形は描画の層に同じ濃さ（--edit-dim-opacity）を渡して、
// 枠の図形をまとめて薄くする。
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { findCustomPalette, resolvePaletteColors } from "../config/palettes";
import type { Instance, Palette } from "../config/types";
import { useT } from "../i18n/use_t";
import { directionTransform, logicalSize, quarterTurns } from "../modules/direction";
import type { ModuleKind, ModuleOptions } from "../modules/options";
import type { AnyModuleDefinition, FrameDrawInput, Geometry, ModuleRenderer, PaletteColors } from "../modules/types";
import { DISCARD_SINK } from "../render/gl/shape_batch";
import { canvasPixels } from "../render/gl/transform";
import { SHAPE_LAYER_KEY } from "../render/gl/use_shape_layer";
import { RENDER_LOOP_KEY } from "../render/use_render_loop";
import type { CanvasColors } from "../theme/canvas_colors";

const props = withDefaults(
  defineProps<{
    instance: Instance;
    definition: AnyModuleDefinition;
    /** レイアウト編集中（破線の枠で囲み、描画を薄くする） */
    editing?: boolean;
    /** レイアウト編集で選んでいる */
    selected?: boolean;
    /** 自分で作った配色（今の構成の customPalettes） */
    customPalettes?: readonly Palette[];
  }>(),
  { editing: false, selected: false, customPalettes: () => [] },
);
defineSlots<{ default?(): unknown }>();

const { t } = useT();
const label = computed(() => t(props.definition.labelKey));

const loop = inject(RENDER_LOOP_KEY, null);
const shapeLayer = inject(SHAPE_LAYER_KEY, null);
/** 描画の層で描いている（地を透明にする） */
const onSharedLayer = computed(() => shapeLayer?.status.value === "ready");
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

// 配色は、インスタンスの配色ID・色の組・（自分で作った配色なら）その3色が変わったときだけ当て直す
// （ライトでは自分で作った配色からライト用の色を計算するため、毎フレームは計算しない）
let paletteCache: { key: string; colors: CanvasColors; result: PaletteColors } | null = null;
function paletteColors(colors: CanvasColors): PaletteColors {
  const paletteId = props.instance.paletteId;
  const custom = findCustomPalette(paletteId, props.customPalettes);
  const key = custom ? `${paletteId}|${custom.main}|${custom.sub}|${custom.accent}` : paletteId;
  if (!paletteCache || paletteCache.key !== key || paletteCache.colors !== colors) {
    paletteCache = { key, colors, result: resolvePaletteColors(paletteId, colors, props.customPalettes) };
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
  const pixelWidth = canvasPixels(rect.width, dpr);
  const pixelHeight = canvasPixels(rect.height, dpr);
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

/** レイアウト編集中の図形の濃さ（文字の層の CSS と同じ --edit-dim-opacity。編集を始めたときに読む） */
let editOpacity = 1;
function readEditOpacity(): number {
  const el = root.value;
  if (!el) return 1;
  const value = Number.parseFloat(getComputedStyle(el).getPropertyValue("--edit-dim-opacity"));
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}

/** 1回分を描く（描画ループから呼ぶ） */
function draw(input: FrameDrawInput): void {
  if (!renderer || !context || !geometry || !props.instance.enabled) return;
  // 描画の層があるのに描けない（作れない・失っている）ときは描かない
  if (shapeLayer && !onSharedLayer.value) return;
  context.setTransform(...directionTransform(geometry.quarterTurns, boxWidth, boxHeight, geometry.devicePixelRatio));
  const shapes = shapeLayer ? shapeLayer.sink(props.instance.id, geometry, props.editing ? editOpacity : 1) : DISCARD_SINK;
  renderer.draw(input.frame, input.histories, props.instance.options, paletteColors(input.colors), input.dt, { shapes, text: context });
}

/** 文字の層を消す（描画の層を失ったとき、前の絵を残さない） */
function clearText(): void {
  const cv = canvas.value;
  if (!context || !cv) return;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, cv.width, cv.height);
}

watch(onSharedLayer, (ready) => {
  if (!ready) clearText();
});

defineExpose({ draw });

onMounted(() => {
  context = canvas.value?.getContext("2d") ?? null;
  if (!context) return;
  renderer = props.definition.createRenderer({ ctx: context, translate: t }) as AnyRenderer;
  if (props.editing) editOpacity = readEditOpacity();
  updateGeometry();
  observer = new ResizeObserver(updateGeometry);
  if (root.value) observer.observe(root.value);
  unregister = loop?.register({ draw }) ?? null;
});

watch(() => props.instance.direction, updateGeometry);
watch(
  () => props.editing,
  (editing) => {
    if (editing) editOpacity = readEditOpacity();
  },
  { flush: "post" },
);

onBeforeUnmount(() => {
  unregister?.();
  observer?.disconnect();
  renderer?.dispose();
  renderer = null;
  context = null;
});
</script>

<template>
  <section
    ref="root"
    class="module-frame"
    :class="{ 'is-editing': editing, 'is-selected': editing && selected, 'on-shared-layer': onSharedLayer }"
    :data-kind="instance.kind"
    :aria-label="label"
  >
    <span class="tag" aria-hidden="true">{{ label }}</span>
    <canvas ref="canvas" aria-hidden="true" />
    <!-- レイアウト編集の飾り（見出し・右下の角）。置く側が入れる -->
    <slot />
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

/* 地の色は、後ろの描画の層（共有キャンバス）が塗る */
.module-frame.on-shared-layer {
  background: transparent;
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

/* レイアウト編集（モックの .stage[data-edit="on"] .mod） */
.module-frame.is-editing {
  outline: var(--border-width) dashed var(--color-neon-b);
  outline-offset: calc(-1 * var(--border-width));
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.module-frame.is-editing canvas {
  opacity: var(--edit-dim-opacity);
}

.module-frame.is-selected {
  z-index: 1;
  outline: var(--selected-outline-width) solid var(--color-neon-a);
  outline-offset: calc(-1 * var(--selected-outline-width));
  box-shadow: var(--glow-selected);
}

.module-frame.is-editing:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-neon-b);
  outline-offset: calc(-1 * var(--focus-ring-width));
}

.module-frame.is-editing.is-dragging {
  cursor: grabbing;
}
</style>
