<script setup lang="ts">
// 編集中のモジュールの見出し（S03。モックの .edit-head）：つまみ、名前と番号、推奨の形との適合判定のバッジ、
// 流れる方向の矢印（4方向。方向を持つモジュールだけ）。モジュールの枠の上端に重ねる。
// - つまみ・名前はドラッグの取っ手に見えるが、ドラッグは枠のどこをつかんでも始まる（MeterGrid）。
//   矢印は押すだけなので、ドラッグを始めないよう data-no-drag を付ける
// - 適合判定は枠の見た目の大きさ（size）と流れる方向から shapeFit で求める。ライトでは、バッジの文字を --color-label-b・
//   --color-label-c（= --color-text）にし、枠線だけ発光色を残す（theme/theme_aliases.css）
// - 歯車ボタン（インスタンスの設定を開く）は Phase 6（T6-4）で加える
import { computed } from "vue";
import type { Instance } from "../config/types";
import { useT, type MessageKey } from "../i18n/use_t";
import { fitProfileOf, shapeFit, type ShapeFit } from "../layout/shape_fit";
import type { Direction } from "../modules/options";
import type { AnyModuleDefinition } from "../modules/types";

const props = defineProps<{
  instance: Instance;
  definition: AnyModuleDefinition;
  /** 同じ種類の中での番号（1始まり） */
  number: number;
  /** 枠の見た目の大きさ（比だけを使う） */
  size: { width: number; height: number };
}>();
const emit = defineEmits<{ direction: [direction: Direction] }>();

const { t } = useT();

/** 方向の並びと矢印（モックの ARROW）と読み上げの名前。矢印は記号で、翻訳する文言ではない */
const DIRECTIONS: readonly { value: Direction; arrow: string; labelKey: MessageKey }[] = [
  { value: "up", arrow: "↑", labelKey: "instance.direction.up" },
  { value: "right", arrow: "→", labelKey: "instance.direction.right" },
  { value: "down", arrow: "↓", labelKey: "instance.direction.down" },
  { value: "left", arrow: "←", labelKey: "instance.direction.left" },
];

/** 適合判定の結果の文言（辞書のキーは、使われていることを検査で見つけられるよう、文字列で書く） */
const FIT_KEYS: Record<ShapeFit, MessageKey> = {
  good: "shape_fit.good",
  warn_short: "shape_fit.warn_short",
  warn_axis: "shape_fit.warn_axis",
  warn_long: "shape_fit.warn_long",
  warn_tall: "shape_fit.warn_tall",
};

const name = computed(() => t(props.definition.labelKey));
const hasDirection = computed(() => props.definition.baseDirection !== null);

const fit = computed(() => {
  const result = shapeFit(fitProfileOf(props.instance, props.definition.shape), props.instance.direction, props.size.width, props.size.height);
  return { result, good: result === "good", text: t(FIT_KEYS[result]) };
});
</script>

<template>
  <div class="edit-head">
    <span class="grip" aria-hidden="true" />
    <span class="name">{{ name }} {{ number }}</span>
    <span class="fit" :class="fit.good ? 'is-good' : 'is-warn'" :data-fit="fit.result">{{ fit.text }}</span>
    <span v-if="hasDirection" class="dirs" role="group" data-no-drag :aria-label="t('instance.direction.label')">
      <button
        v-for="item in DIRECTIONS"
        :key="item.value"
        type="button"
        class="dir-button"
        :aria-pressed="instance.direction === item.value"
        :aria-label="t(item.labelKey)"
        :title="t(item.labelKey)"
        @click="emit('direction', item.value)"
      >
        {{ item.arrow }}
      </button>
    </span>
  </div>
</template>

<style scoped>
.edit-head {
  position: absolute;
  inset: 0 0 auto 0;
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--edit-head-gap);
  padding: var(--edit-head-padding-y) var(--edit-head-padding-x);
  background: var(--color-scrim);
  font-size: clamp(var(--edit-head-font-min), var(--edit-head-font-fluid), var(--edit-head-font-max));
  line-height: 1.5;
}

.grip {
  flex: none;
  width: var(--grip-size);
  height: var(--grip-size);
  background: radial-gradient(var(--color-text-muted) var(--grip-dot), transparent var(--grip-dot-fade)) 0 0 / var(--grip-dot-pitch)
    var(--grip-dot-pitch);
}

.name {
  font-weight: 700;
  white-space: nowrap;
}

/* 適合判定のバッジ。適は副色、それ以外は注意色。枠線は発光色、文字はライトでは --color-text */
.fit {
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-pill);
  white-space: nowrap;
}

.fit.is-good {
  border-color: var(--color-neon-b);
  color: var(--color-label-b);
}

.fit.is-warn {
  border-color: var(--color-neon-c);
  color: var(--color-label-c);
}

/* 流れる方向の矢印（モックの .dirs） */
.dirs {
  display: inline-flex;
  overflow: hidden;
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-sm);
}

.dir-button {
  width: var(--direction-button-width);
  padding: 0;
  border: 0;
  background: var(--color-surface);
  color: var(--color-text-muted);
  font: inherit;
  line-height: 1.5;
  cursor: pointer;
}

.dir-button[aria-pressed="true"] {
  background: var(--color-surface-raised);
  color: var(--color-neon-a);
  box-shadow: inset 0 calc(-1 * var(--indicator-width)) 0 var(--color-neon-a);
}

.dir-button:focus-visible {
  outline: var(--focus-ring-width) solid var(--color-neon-b);
  outline-offset: calc(-1 * var(--focus-ring-width));
}
</style>
