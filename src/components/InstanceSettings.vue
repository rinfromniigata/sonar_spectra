<script setup lang="ts">
// インスタンスの設定の中身（S03。モックの .inspector）。ポップオーバー（UiPopover）の中に入れる。
// 見出し（選択中：名前と番号）と、種類を問わない項目：
// - 入力源：初版の選択肢は既定の1系統だけ。セレクトに1つだけ出し、注記を添える（sourceId は変えない）
// - 配色：標準の配色（マゼンタ主・シアン主・アンバー主）の見本。自分で作った配色と「＋ 配色を作る」は Phase 7（T7-2）
// - 流れる速さ：流れるモジュール（定義の flows）だけ。×0.25〜×3.00、刻み0.05
// 種類ごとの項目（定義の inspectorFields）は T6-2、「既定に戻す」は T6-3 で加える。
// 値は持たず、変えたら palette・speed で知らせる（書き込みは置く側）
import { computed, useId } from "vue";
import { PRESET_PALETTES, presetSwatchColors } from "../config/palettes";
import { SPEED_MAX, SPEED_MIN, SPEED_STEP } from "../config/instance_settings";
import type { Instance } from "../config/types";
import { formatMultiplier } from "../i18n/format";
import { useT } from "../i18n/use_t";
import type { AnyModuleDefinition } from "../modules/types";
import UiPaletteSwatch from "./ui/UiPaletteSwatch.vue";
import UiSelect from "./ui/UiSelect.vue";
import UiSlider from "./ui/UiSlider.vue";
import type { ChoiceOption } from "./ui/types";

const props = defineProps<{
  instance: Instance;
  definition: AnyModuleDefinition;
  /** 見出しの名前（「波形 2」） */
  name: string;
}>();
const emit = defineEmits<{ palette: [paletteId: string]; speed: [speed: number] }>();

const { t } = useT();
const paletteLabelId = useId();

/** 入力源：初版は既定の1系統だけ */
const sourceOptions = computed<ChoiceOption<"default">[]>(() => [{ value: "default", label: t("instance.source_default") }]);
const source = computed({
  get: () => props.instance.sourceId,
  set: () => {
    // 選択肢が1つなので変わらない
  },
});

const palettes = computed(() =>
  PRESET_PALETTES.map((palette) => ({ id: palette.id, name: t(palette.labelKey), colors: presetSwatchColors(palette) })),
);

/** 流れる速さ。流れるモジュールでなければ null */
const speed = computed<number | null>(() => {
  if (!props.definition.flows) return null;
  const value = (props.instance.options as { speed?: unknown }).speed;
  return typeof value === "number" ? value : null;
});
const speedModel = computed({
  get: () => speed.value ?? 1,
  set: (value: number) => emit("speed", value),
});
const speedText = computed(() => t("common.speed_value", { value: formatMultiplier(speedModel.value) }));
</script>

<template>
  <div class="instance-settings">
    <h3 class="title">{{ t("layout_edit.selected", { name }) }}</h3>

    <div class="field">
      <span class="label" aria-hidden="true">{{ t("instance.source") }}</span>
      <UiSelect v-model="source" :label="t('instance.source')" :options="sourceOptions" />
      <span class="note">{{ t("instance.source_note") }}</span>
    </div>

    <div class="field">
      <span :id="paletteLabelId" class="label">{{ t("instance.palette") }}</span>
      <div class="swatches" role="group" :aria-labelledby="paletteLabelId">
        <UiPaletteSwatch
          v-for="item in palettes"
          :key="item.id"
          :name="item.name"
          :colors="item.colors"
          :selected="instance.paletteId === item.id"
          @select="emit('palette', item.id)"
        />
      </div>
    </div>

    <div v-if="speed !== null" class="field">
      <span class="label" aria-hidden="true">{{ t("instance.speed") }}</span>
      <UiSlider
        v-model="speedModel"
        :label="t('instance.speed')"
        :min="SPEED_MIN"
        :max="SPEED_MAX"
        :step="SPEED_STEP"
        :value-text="speedText"
      />
    </div>
  </div>
</template>

<style scoped>
.instance-settings {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

/* 見出し（モックの .ins-title）。右上の×と重ならないよう、余白はポップオーバー側が取る */
.title {
  min-width: 0;
  margin: 0;
  font-size: inherit;
  font-weight: 700;
  overflow-wrap: anywhere;
}

/* 項目（モックの .ins-field・.ins-label・.ins-note） */
.field {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  letter-spacing: var(--tracking-label);
}

.note {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}
</style>
