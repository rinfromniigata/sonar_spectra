<script setup lang="ts">
// インスタンスの設定の中身（S03。モックの .inspector）。ポップオーバー（UiPopover）の中に入れる。
// 見出し（選択中：名前と番号）と、種類を問わない項目：
// - 入力源：初版の選択肢は既定の1系統だけ。セレクトに1つだけ出し、注記を添える（sourceId は変えない）
// - 配色：標準の配色（マゼンタ主・シアン主・アンバー主）の見本。自分で作った配色と「＋ 配色を作る」は Phase 7（T7-2）
// - 流れる速さ：流れるモジュール（定義の flows）だけ。×0.25〜×3.00、刻み0.05
// - 種類ごとの項目：定義の inspectorFields（波形・スペクトラム・位相）を、選択肢はセグメント、オン／オフはスイッチ、数値は
//   スライダーで出す。出すかどうかは visibleWhen で決まる（modules/inspector_fields）。選んでいる選択肢の注記を下に添える
// - 「既定に戻す」（見出しの横）：方向・配色・種類ごとの設定をまとめて戻す。すでに既定のままなら押せない。
//   押したあとは、ボタンが押せなくなってフォーカスが失われる（Esc で閉じられなくなる）ため、見出しへフォーカスを移す
// 値は持たず、変えたら palette・speed・option・reset で知らせる（書き込みは置く側）
import { computed, nextTick, ref, useId } from "vue";
import { PRESET_PALETTES, presetSwatchColors } from "../config/palettes";
import { SPEED_MAX, SPEED_MIN, SPEED_STEP, isDefaultInstance } from "../config/instance_settings";
import type { Instance } from "../config/types";
import { formatMultiplier, formatPercent } from "../i18n/format";
import { useT, type MessageKey } from "../i18n/use_t";
import { visibleFields } from "../modules/inspector_fields";
import type { AnyModuleDefinition, InspectorField } from "../modules/types";
import UiButton from "./ui/UiButton.vue";
import UiIcon from "./ui/UiIcon.vue";
import UiPaletteSwatch from "./ui/UiPaletteSwatch.vue";
import UiSegmented from "./ui/UiSegmented.vue";
import UiSelect from "./ui/UiSelect.vue";
import UiSlider from "./ui/UiSlider.vue";
import UiSwitch from "./ui/UiSwitch.vue";
import type { ChoiceOption } from "./ui/types";

const props = defineProps<{
  instance: Instance;
  definition: AnyModuleDefinition;
  /** 見出しの名前（「波形 2」） */
  name: string;
}>();
const emit = defineEmits<{
  palette: [paletteId: string];
  speed: [speed: number];
  /** 種類ごとの項目（設定 options の1項目）を変えた */
  option: [key: string, value: string | number | boolean];
  /** 方向・配色・種類ごとの設定を既定に戻す */
  reset: [];
}>();

const { t } = useT();
/** 動的な辞書キー（定義が持つ）を引く。プレースホルダの有無は定義と辞書で決まるため、型の検査はここでは行わない */
const translate = t as unknown as (key: MessageKey, params?: Record<string, string | number>) => string;
const paletteLabelId = useId();
const titleElement = ref<HTMLElement | null>(null);

/** 方向・配色・種類ごとの設定がすべて既定のままか */
const isDefault = computed(() => isDefaultInstance(props.instance, props.definition));

async function reset(): Promise<void> {
  emit("reset");
  // 押せなくなったボタンからフォーカスが外れるので、見出しに移す
  await nextTick();
  titleElement.value?.focus();
}

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

// --- 種類ごとの項目 ---

type OptionValues = Record<string, unknown>;

/** 画面に出す項目 1 つ分（文言と今の値を引いたもの） */
type FieldView =
  | { type: "choice"; key: string; label: string; options: ChoiceOption<string>[]; value: string; note: string | null }
  | { type: "switch"; key: string; label: string; value: boolean }
  | {
      type: "slider";
      key: string;
      label: string;
      min: number;
      max: number;
      step: number;
      value: number;
      valueText: string;
      note: string | null;
    };

function formatSlider(field: Extract<InspectorField<OptionValues>, { type: "slider" }>, value: number): string {
  return field.format === "percent" ? formatPercent(value) : String(value);
}

const fields = computed<FieldView[]>(() => {
  const options = props.instance.options as OptionValues;
  const all = props.definition.inspectorFields as readonly InspectorField<OptionValues>[];
  return visibleFields(all, options).map((field): FieldView => {
    const label = t(field.labelKey);
    const current = options[field.key];
    if (field.type === "switch") return { type: "switch", key: field.key, label, value: current === true };
    if (field.type === "choice") {
      const selected = field.choices.find((choice) => choice.value === current);
      return {
        type: "choice",
        key: field.key,
        label,
        options: field.choices.map((choice) => ({ value: choice.value, label: t(choice.labelKey) })),
        value: typeof current === "string" ? current : "",
        note: selected?.noteKey ? t(selected.noteKey) : null,
      };
    }
    const value = typeof current === "number" ? current : field.min;
    // 注記には、その項目の既定値を整形して渡す（例：「既定は72%」）
    const initial = props.definition.defaultOptions as OptionValues;
    const initialValue = typeof initial[field.key] === "number" ? (initial[field.key] as number) : value;
    return {
      type: "slider",
      key: field.key,
      label,
      min: field.min,
      max: field.max,
      step: field.step,
      value,
      valueText: formatSlider(field, value),
      note: field.noteKey ? translate(field.noteKey, { value: formatSlider(field, initialValue) }) : null,
    };
  });
});
</script>

<template>
  <div class="instance-settings">
    <div class="head">
      <h3 ref="titleElement" class="title" tabindex="-1">{{ t("layout_edit.selected", { name }) }}</h3>
      <UiButton class="reset" :disabled="isDefault" @click="reset">
        <UiIcon name="reset" size="sm" />
        {{ t("common.reset_default") }}
      </UiButton>
    </div>

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

    <template v-for="field in fields" :key="field.key">
      <div v-if="field.type === 'switch'" class="row" :data-field="field.key">
        <span class="row-label">{{ field.label }}</span>
        <UiSwitch :model-value="field.value" :label="field.label" @update:model-value="emit('option', field.key, $event)" />
      </div>
      <div v-else class="field" :data-field="field.key">
        <span class="label" aria-hidden="true">{{ field.label }}</span>
        <UiSegmented
          v-if="field.type === 'choice'"
          :model-value="field.value"
          :label="field.label"
          :options="field.options"
          @update:model-value="emit('option', field.key, $event)"
        />
        <UiSlider
          v-else
          :model-value="field.value"
          :label="field.label"
          :min="field.min"
          :max="field.max"
          :step="field.step"
          :value-text="field.valueText"
          @update:model-value="emit('option', field.key, $event)"
        />
        <span v-if="field.note" class="note">{{ field.note }}</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.instance-settings {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
}

/* 見出しと「既定に戻す」（モックの .ins-head・.ins-reset）。右上の×と重ならないよう、余白はポップオーバー側が取る */
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
}

.title {
  min-width: 0;
  margin: 0;
  font-size: inherit;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.title:focus {
  outline: none;
}

.instance-settings .reset {
  min-width: 0;
  min-height: 0;
  padding: var(--space-1) var(--space-2);
  font-size: var(--font-size-xs);
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

/* スイッチの行（モックの .row）：名前を左、スイッチを右に */
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  min-width: 0;
}

.row-label {
  min-width: 0;
  overflow-wrap: anywhere;
}

.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  min-width: 0;
}
</style>
