<script setup lang="ts">
// メーターの格子（12列×8行）。自動配置では、格子の大きさから画面比を求めて autoArrange で並べ直す
// （ウィンドウの大きさを変えるたび・全画面にしたとき）。手動配置では、各インスタンスの rect に置く。
//
// レイアウト編集中（editing。S03）：
// - 格子の点を見せ、モジュールを破線で囲む。選んでいるもの（selectedId）を強調する
// - モジュールのドラッグで移動、右下の角のドラッグで大きさ変更、境界線のドラッグで両側の大きさを同時に変える
//   （格子に吸着。計算は layout/edit_gesture と layout/manual の純粋関数）
// - 各モジュールに見出し（EditHead：つまみ・名前と番号・形の適合判定のバッジ・流れる方向の矢印）を重ねる。
//   適合判定には、枠の見た目の大きさを格子の大きさとマスの数から求めて渡す（frameSize）。
//   方向の矢印を押したら direction で知らせる（配置は変えない）。ただし自動配置の縦長の帯で、自動整列が方向を決める
//   もの（レベル）に、それと違う向きを選んだときは、選んだ向きを効かせるため、固定した配置に選んだ向きを入れて update で知らせる
// 編集を終えたとき（S03a）：飾りはすべて外れ、モックの表示と同じ 12×8 の格子（モジュールの間は細い線）に戻る。
// 手動配置で空いたマス（削除・無効・縮小のあと）は、格子の背景の線の色のままだと塊に見えるため、背景色で塗る（hole）。
// - キーボード：モジュールにフォーカスして矢印キーで1マス移動、Shift＋矢印キーで大きさを1マス変える。
//   境界線にフォーカスして矢印キーで1マス動かす（縦の線は左右、横の線は上下）
// - 配置を変えたら update で手動配置の並び（全インスタンス）を知らせる。自動配置のときは、その時点の自動整列の結果を
//   固定したもの（pinAutoLayout）を基準に操作するので、最初の操作で手動配置に固定される。保存は置く側が行う
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import type { GridRect, Instance } from "../config/types";
import { useT } from "../i18n/use_t";
import { autoArrange } from "../layout/auto_arrange";
import {
  cellAt,
  cellDelta,
  finishGesture,
  frameSize,
  instanceAt,
  lineAt,
  startGesture,
  updateGesture,
  type GestureState,
  type GridBox,
} from "../layout/edit_gesture";
import { GRID_COLUMNS, GRID_ROWS } from "../layout/grid";
import { instanceNumbers } from "../layout/instance_numbers";
import {
  arrowDelta,
  findEmptyRects,
  findSplitters,
  moveBy,
  moveSplitter,
  pinAutoLayout,
  resizeBy,
  setDirection,
  splitterStep,
  type Splitter,
} from "../layout/manual";
import type { Direction } from "../modules/options";
import { moduleRegistry, type ModuleRegistry } from "../modules/registry";
import type { AnyModuleDefinition } from "../modules/types";
import EditHead from "./EditHead.vue";
import ModuleFrame from "./ModuleFrame.vue";

const props = withDefaults(
  defineProps<{
    instances: readonly Instance[];
    mode: "auto" | "manual";
    registry?: ModuleRegistry;
    /** レイアウト編集中（S03） */
    editing?: boolean;
    /** レイアウト編集で選んでいるインスタンスのID */
    selectedId?: string | null;
  }>(),
  { registry: () => moduleRegistry, editing: false, selectedId: null },
);
const emit = defineEmits<{
  /** モジュールを選んだ */
  select: [id: string];
  /** 配置を変えた。手動配置にして、インスタンスの並びをこれに置き換える */
  update: [instances: Instance[]];
  /** 流れる方向を変えた（配置は変えない） */
  direction: [id: string, direction: Direction];
}>();

const { t } = useT();
const root = ref<HTMLElement | null>(null);
/** 格子の幅÷高さ。測るまでは 16:9 とみなす */
const aspect = ref(16 / 9);
let observer: ResizeObserver | null = null;

/** 格子の見た目の大きさ（編集中だけ測る。測るまでは null） */
const box = shallowRef<GridBox | null>(null);

function measure(): void {
  const rect = root.value?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) aspect.value = rect.width / rect.height;
  box.value = props.editing ? gridBox() : null;
}

onMounted(() => {
  measure();
  observer = new ResizeObserver(measure);
  if (root.value) observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());
// 編集を始めると余白とすき間が変わる（描き直したあとに測り直す）
watch(
  () => props.editing,
  async () => {
    await nextTick();
    measure();
  },
);

/**
 * 表示し、操作の基準にする配置（手動配置の形）。自動配置では、今の画面比での自動整列の結果を固定したもの
 * （自動整列が決めた方向〔縦長の帯のレベルなど〕も入る）
 */
const arranged = computed<readonly Instance[]>(() =>
  props.mode === "auto"
    ? pinAutoLayout(props.instances, autoArrange(props.instances, aspect.value, (kind) => props.registry.get(kind)?.shape ?? "free"))
    : props.instances,
);

interface Placed {
  instance: Instance;
  definition: AnyModuleDefinition;
  rect: GridRect;
}

const placed = computed<Placed[]>(() =>
  arranged.value.flatMap((instance) => {
    if (!instance.enabled || !instance.rect) return [];
    const definition = props.registry.get(instance.kind) as AnyModuleDefinition | undefined;
    return definition ? [{ instance, definition, rect: instance.rect }] : [];
  }),
);

/** 同じ種類の中での番号（無効なものも数える） */
const numbers = computed(() => instanceNumbers(props.instances));

/**
 * 枠の見た目の大きさ（適合判定に渡す）。測れていれば実寸、測れていなければ（最初の描画の前・DOMなし）、
 * 格子の画面比だけを使った大きさ（余白とすき間は無視）
 */
function sizeOf(rect: GridRect): { width: number; height: number } {
  return frameSize(box.value ?? { left: 0, top: 0, width: aspect.value * 100, height: 100, padding: 0, gap: 0 }, rect);
}

/** 空いたマス（編集中は格子の点を見せるので塗らない） */
const holes = computed<GridRect[]>(() => (props.editing ? [] : findEmptyRects(arranged.value)));

const splitters = computed<Splitter[]>(() => (props.editing ? findSplitters(arranged.value) : []));

function gridArea(rect: GridRect): string {
  return `${rect.r} / ${rect.c} / span ${rect.rs} / span ${rect.cs}`;
}

function splitterKey(splitter: Splitter): string {
  return `${splitter.axis}:${splitter.before.join(",")}|${splitter.after.join(",")}`;
}

function splitterStyle(splitter: Splitter): Record<string, number> {
  return { "--line": splitter.line, "--start": splitter.start, "--end": splitter.end };
}

// ---------------------------------------------------------------------------
// ドラッグ

interface Drag {
  pointerId: number;
  x: number;
  y: number;
  box: GridBox;
  state: GestureState;
  /** 移動・大きさ変更のときのインスタンス（つかんでいる見た目を付ける） */
  id: string | null;
}

let drag: Drag | null = null;
const draggingId = ref<string | null>(null);
const draggingSplitter = shallowRef<Splitter | null>(null);

/** 格子の今の見た目の大きさ */
function gridBox(): GridBox | null {
  const el = root.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    padding: Number.parseFloat(style.paddingLeft) || 0,
    gap: Number.parseFloat(style.columnGap) || 0,
  };
}

/**
 * ドラッグを始める。ポインタは格子の要素で捕まえる（境界線は、動かすと両側の組が変わって作り直されることがあり、
 * 境界線の要素で捕まえると途中で外れるため）
 */
function begin(event: PointerEvent, state: GestureState | null, id: string | null): void {
  const box = gridBox();
  if (!state || !box || !root.value) return;
  event.preventDefault();
  root.value.setPointerCapture(event.pointerId);
  drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, box, state, id };
  draggingId.value = id;
}

function onModulePointerDown(event: PointerEvent, id: string): void {
  if (!props.editing || event.button !== 0) return;
  const target = event.target as Element;
  // 見出しのボタンなど、ドラッグしない部分
  if (target.closest("[data-no-drag]")) return;
  emit("select", id);
  (event.currentTarget as HTMLElement).focus({ preventScroll: true });
  const kind = target.closest("[data-resize]") ? "resize" : "move";
  begin(event, startGesture(arranged.value, { kind, id }), id);
}

function onSplitterPointerDown(event: PointerEvent, splitter: Splitter): void {
  if (!props.editing || event.button !== 0) return;
  (event.currentTarget as HTMLElement).focus({ preventScroll: true });
  draggingSplitter.value = splitter;
  begin(event, startGesture(arranged.value, { kind: "splitter", splitter }), null);
}

/** つかんでいる境界線か（動かして両側の組が変わっても、同じ向きで、つかんだ両側の先頭を含むもの） */
function isGrabbed(splitter: Splitter, grabbed: Splitter | null): boolean {
  return (
    grabbed !== null &&
    splitter.axis === grabbed.axis &&
    splitter.before.includes(grabbed.before[0]) &&
    splitter.after.includes(grabbed.after[0])
  );
}

function onPointerMove(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const { dc, dr } = cellDelta(drag.box, event.clientX - drag.x, event.clientY - drag.y);
  const axis = drag.state.gesture.kind === "splitter" ? drag.state.gesture.splitter.axis : "v";
  const line = lineAt(drag.box, axis, event.clientX, event.clientY);
  const { state, next } = updateGesture(drag.state, { dc, dr, line });
  drag.state = state;
  if (next) emit("update", next);
}

function onPointerUp(event: PointerEvent): void {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const dropOn = instanceAt(drag.state.start, cellAt(drag.box, event.clientX, event.clientY));
  const next = finishGesture(drag.state, dropOn);
  if (next) emit("update", next);
  endDrag();
}

function endDrag(): void {
  drag = null;
  draggingId.value = null;
  draggingSplitter.value = null;
}

// ---------------------------------------------------------------------------
// キーボード

function onModuleKeydown(event: KeyboardEvent, id: string): void {
  if (!props.editing || event.target !== event.currentTarget) return;
  const delta = arrowDelta(event.key);
  if (!delta) return;
  event.preventDefault();
  const next = event.shiftKey ? resizeBy(arranged.value, id, delta.dc, delta.dr) : moveBy(arranged.value, id, delta.dc, delta.dr);
  if (next) emit("update", next);
}

async function onSplitterKeydown(event: KeyboardEvent, splitter: Splitter): Promise<void> {
  const step = splitterStep(splitter.axis, event.key);
  if (step === null) return;
  event.preventDefault();
  const next = moveSplitter(arranged.value, splitter, splitter.line + step);
  if (!next) return;
  emit("update", next);
  // 動かしたあとの境界線にフォーカスを戻す（同じ向きで、つかんでいた両側を含むもの）
  await nextTick();
  const moved = splitters.value.find((s) => isGrabbed(s, splitter));
  if (moved) root.value?.querySelector<HTMLElement>(`[data-splitter="${CSS.escape(splitterKey(moved))}"]`)?.focus();
}

/** 方向の矢印：選んだ向きを知らせる。自動整列が決める向きと違うときは、固定した配置に入れて手動配置にする */
function onDirection(id: string, direction: Direction): void {
  if (props.mode === "auto") {
    const trial = props.instances.map((i) => (i.id === id ? ({ ...i, direction } as Instance) : i));
    const forced = autoArrange(trial, aspect.value, (kind) => props.registry.get(kind)?.shape ?? "free").directions.get(id);
    if (forced !== undefined && forced !== direction) {
      const next = setDirection(arranged.value, id, direction);
      if (next) emit("update", next);
      return;
    }
  }
  emit("direction", id, direction);
}

function onModuleFocus(id: string): void {
  if (props.editing && props.selectedId !== id) emit("select", id);
}
</script>

<template>
  <div
    ref="root"
    class="meter-grid"
    :class="{ 'is-editing': editing }"
    :style="{ '--grid-columns': GRID_COLUMNS, '--grid-rows': GRID_ROWS }"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="endDrag"
    @lostpointercapture="endDrag"
  >
    <ModuleFrame
      v-for="item in placed"
      :key="item.instance.id"
      :instance="item.instance"
      :definition="item.definition"
      :editing="editing"
      :selected="item.instance.id === selectedId"
      :class="{ 'is-dragging': item.instance.id === draggingId }"
      :style="{ gridArea: gridArea(item.rect) }"
      :tabindex="editing ? 0 : undefined"
      :aria-current="editing && item.instance.id === selectedId ? 'true' : undefined"
      @pointerdown="onModulePointerDown($event, item.instance.id)"
      @keydown="onModuleKeydown($event, item.instance.id)"
      @focus="onModuleFocus(item.instance.id)"
    >
      <template v-if="editing">
        <EditHead
          :instance="item.instance"
          :definition="item.definition"
          :number="numbers.get(item.instance.id) ?? 1"
          :size="sizeOf(item.rect)"
          @direction="onDirection(item.instance.id, $event)"
        />
        <span class="resize-handle" data-resize aria-hidden="true" />
      </template>
    </ModuleFrame>
    <div v-for="hole in holes" :key="gridArea(hole)" class="hole" :style="{ gridArea: gridArea(hole) }" aria-hidden="true" />
    <div
      v-for="splitter in splitters"
      :key="splitterKey(splitter)"
      class="splitter"
      :class="[splitter.axis, { 'is-dragging': isGrabbed(splitter, draggingSplitter) }]"
      :style="splitterStyle(splitter)"
      :data-splitter="splitterKey(splitter)"
      role="separator"
      tabindex="0"
      :aria-orientation="splitter.axis === 'v' ? 'vertical' : 'horizontal'"
      :aria-label="t('layout_edit.splitter')"
      :aria-valuenow="splitter.line"
      :aria-valuemin="2"
      :aria-valuemax="splitter.axis === 'v' ? GRID_COLUMNS : GRID_ROWS"
      @pointerdown="onSplitterPointerDown($event, splitter)"
      @keydown="onSplitterKeydown($event, splitter)"
    />
  </div>
</template>

<style scoped>
.meter-grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(var(--grid-columns), minmax(0, 1fr));
  grid-template-rows: repeat(var(--grid-rows), minmax(0, 1fr));
  gap: var(--border-width);
  min-width: 0;
  min-height: 0;
  background: var(--color-line);
}

/* 空いたマスは背景色で塗る。線（すき間）の部分も背景色にして、空いた部分を線のない1つの面に見せる
   （影が格子の外にはみ出さないよう、編集中でないときは格子で切る） */
.meter-grid:not(.is-editing) {
  overflow: hidden;
}

.hole {
  background: var(--color-bg);
  box-shadow: 0 0 0 var(--border-width) var(--color-bg);
}

/* レイアウト編集：すき間を広げ、格子の点を見せる（モックの .stage[data-edit="on"] .grid） */
.meter-grid.is-editing {
  --pad: var(--edit-grid-gap);
  --gap: var(--edit-grid-gap);
  /* 1マス分の間隔。% は使う場所（横の値なら幅、縦の値なら高さ）に対して決まる */
  --pitch-x: calc((100% - 2 * var(--pad) + var(--gap)) / var(--grid-columns));
  --pitch-y: calc((100% - 2 * var(--pad) + var(--gap)) / var(--grid-rows));
  gap: var(--gap);
  padding: var(--pad);
  background-color: var(--color-bg);
  background-image: radial-gradient(var(--color-line) var(--edit-grid-dot), transparent var(--edit-grid-dot-fade));
  background-size: calc(100% / var(--grid-columns)) calc(100% / var(--grid-rows));
}

/* 右下の角（モックの .resize） */
.resize-handle {
  position: absolute;
  right: var(--resize-handle-inset);
  bottom: var(--resize-handle-inset);
  z-index: 3;
  width: var(--resize-handle-size);
  height: var(--resize-handle-size);
  border-right: var(--splitter-line) solid var(--color-neon-b);
  border-bottom: var(--splitter-line) solid var(--color-neon-b);
  cursor: nwse-resize;
}

/* 境界線（モックの .splitter）。線の位置は、すき間の真ん中 */
.splitter {
  position: absolute;
  z-index: 4;
  display: grid;
  place-items: center;
  touch-action: none;
}

.splitter.v {
  left: calc(var(--pad) + (var(--line) - 1) * var(--pitch-x) - var(--gap) / 2);
  top: calc(var(--pad) + (var(--start) - 1) * var(--pitch-y));
  width: var(--splitter-hit);
  height: calc((var(--end) - var(--start)) * var(--pitch-y) - var(--gap));
  margin-left: calc(var(--splitter-hit) / -2);
  cursor: col-resize;
}

.splitter.h {
  top: calc(var(--pad) + (var(--line) - 1) * var(--pitch-y) - var(--gap) / 2);
  left: calc(var(--pad) + (var(--start) - 1) * var(--pitch-x));
  width: calc((var(--end) - var(--start)) * var(--pitch-x) - var(--gap));
  height: var(--splitter-hit);
  margin-top: calc(var(--splitter-hit) / -2);
  cursor: row-resize;
}

.splitter::before {
  content: "";
  border-radius: var(--radius-sm);
  background: var(--color-neon-b);
  opacity: var(--splitter-idle-opacity);
  transition:
    opacity var(--motion-fast) var(--motion-ease),
    box-shadow var(--motion-fast) var(--motion-ease);
}

.splitter.v::before {
  width: var(--splitter-line);
  height: 100%;
}

.splitter.h::before {
  width: 100%;
  height: var(--splitter-line);
}

.splitter::after {
  content: "";
  position: absolute;
  border-radius: var(--radius-sm);
  background: var(--color-neon-b);
}

.splitter.v::after {
  width: var(--splitter-grip-width);
  height: var(--splitter-grip-length);
}

.splitter.h::after {
  width: var(--splitter-grip-length);
  height: var(--splitter-grip-width);
}

.splitter:hover::before,
.splitter.is-dragging::before,
.splitter:focus-visible::before {
  opacity: 1;
  box-shadow: var(--glow-line-b);
}

.splitter:focus-visible {
  outline: none;
}
</style>
