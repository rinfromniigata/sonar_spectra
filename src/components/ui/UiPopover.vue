<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useT } from "../../i18n/use_t";
import UiIconButton from "./UiIconButton.vue";
import { readCssLength } from "./css_length";
import { type Box, type PopoverPlacement, placePopover } from "./popover_position";
import { useDismiss } from "./use_dismiss";

// 元（モジュールなど）の横に浮かべて開くパネル（インスタンスの設定）。×で閉じる。
// 使う側は v-if で出し入れする。位置は、自分の offsetParent を領域として計算する。
// 開いたまま元や中身が変わったとき（別のモジュールに移る・配置が変わる）は、置き直す（anchor・revision の変化）
const props = defineProps<{
  /** 読み上げ用の名前 */
  label: string;
  anchor: HTMLElement | null;
  /** これより右には出さない（offsetParent の左端からの距離）。編集パネルの左端など */
  limitRight?: number;
  /** これより右には出さない要素（その左端まで）。置くたびに測るので、大きさの変わるパネルに使う。limitRight より優先 */
  boundary?: HTMLElement | null;
  /** 変わったら置き直す値（元の位置や中身の高さが変わったことを知らせる） */
  revision?: unknown;
}>();
const emit = defineEmits<{ close: [] }>();

const { t } = useT();
const root = ref<HTMLElement | null>(null);
const position = ref({ left: 0, top: 0, width: 0 });
useDismiss(root, () => emit("close"));

function relativeBox(element: Element, container: Element): Box {
  const a = element.getBoundingClientRect();
  const c = container.getBoundingClientRect();
  return { left: a.left - c.left, top: a.top - c.top, right: a.right - c.left, bottom: a.bottom - c.top };
}

/** 今の高さで置く場所を求める（元と領域は、呼ぶたびに測り直す） */
function compute(el: HTMLElement, container: Element, anchor: HTMLElement): PopoverPlacement {
  return placePopover({
    anchor: relativeBox(anchor, container),
    containerWidth: container.clientWidth,
    containerHeight: container.clientHeight,
    limitRight: props.boundary ? relativeBox(props.boundary, container).left : props.limitRight,
    popoverHeight: el.offsetHeight,
    maxWidth: readCssLength(el, "--popover-max-width"),
    gap: readCssLength(el, "--space-2"),
  });
}

/**
 * 2回に分けて置く。開いた直後は幅が 0 で、文が1文字ずつ折り返して高さが上限まで伸びているため、そのまま置くと
 * 下のほうのモジュールでは、実際より高いものとして上へ押し上げてしまう。幅を決めてから、高さを測り直して置く
 */
async function place(): Promise<void> {
  const el = root.value;
  const container = el?.offsetParent;
  const anchor = props.anchor;
  if (!el || !container || !anchor) return;
  position.value = compute(el, container, anchor);
  await nextTick();
  // 待つ間に閉じた・元や領域が変わったときは、置き直しに任せる
  if (root.value !== el || el.offsetParent !== container || props.anchor !== anchor) return;
  position.value = compute(el, container, anchor);
}

const onResize = (): void => void place();
onMounted(async () => {
  window.addEventListener("resize", onResize);
  await nextTick();
  await place();
});
onBeforeUnmount(() => window.removeEventListener("resize", onResize));
watch(
  () => [props.anchor, props.limitRight, props.boundary, props.revision],
  () => void nextTick(place),
);
</script>

<template>
  <div
    ref="root"
    class="ui-popover"
    role="dialog"
    :aria-label="label"
    tabindex="-1"
    :style="{ left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px` }"
  >
    <slot />
    <UiIconButton class="close" icon="close" size="sm" :label="t('common.close')" @click="emit('close')" />
  </div>
</template>

<style scoped>
.ui-popover {
  position: absolute;
  z-index: 8;
  display: grid;
  gap: var(--space-2);
  max-height: var(--popover-max-height);
  padding: var(--space-3);
  padding-right: calc(var(--space-3) + var(--icon-button-size));
  overflow: auto;
  border: var(--border-width) solid var(--color-neon-a);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  box-shadow: var(--shadow-panel), var(--glow-panel-a);
  font-size: var(--font-size-sm);
}
.ui-popover:focus {
  outline: none;
}
.close {
  position: absolute;
  top: var(--space-2);
  right: var(--space-2);
}
</style>
