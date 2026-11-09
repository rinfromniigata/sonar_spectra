<script setup lang="ts">
// 配色の管理（S02a）。設定パネルと同じ位置に重ねて開く（モックの paletteDrawerHtml）。
// - 一覧：標準の配色（「標準」の印。複製だけできる）と、自分で作った配色（複製・削除できる。名前を押すと編集する）。
//   編集している行は強調する。下に「＋ 配色を作る」
// - 編集（一覧の下。モックの .inspector）：「編集中：{name}」、名前、主色・副色・強調色（ダーク用の値。OS の色の選択を使う）、
//   ライトテーマでの色の注記。色は選ぶそばから書く（使っているモジュールにすぐ効く）。名前は確定したときに書き、空なら元に戻す
// - 見出しのボタン：戻る先（設定パネル）があれば「戻る」、なければ「閉じる」。Esc も同じ
// - 構成への書き込みはイベントで知らせるだけにする（MeterScreen が palette_actions で書く）
import { computed, useId } from "vue";
import { useRuntimeStore } from "../app/runtime_store";
import { useConfigStore } from "../config/config_store";
import { PALETTE_NAME_MAX_LENGTH, normalizePaletteName, type PalettePatch } from "../config/custom_palettes";
import { PRESET_PALETTES, customSwatchColors, findCustomPalette, presetSwatchColors } from "../config/palettes";
import { useT, type MessageKey } from "../i18n/use_t";
import UiButton from "./ui/UiButton.vue";
import UiDrawer from "./ui/UiDrawer.vue";
import UiIconButton from "./ui/UiIconButton.vue";

const emit = defineEmits<{
  create: [];
  duplicate: [id: string];
  remove: [id: string];
  update: [id: string, patch: PalettePatch];
}>();

const { t } = useT();
const config = useConfigStore();
const runtime = useRuntimeStore();
const listId = useId();
const editorId = useId();
const editorTitleId = useId();
const nameId = useId();

const customPalettes = computed(() => config.current.value.customPalettes);

const presetRows = computed(() =>
  PRESET_PALETTES.map((palette) => ({ id: palette.id, name: t(palette.labelKey), colors: presetSwatchColors(palette) })),
);
const customRows = computed(() =>
  customPalettes.value.map((palette) => ({
    id: palette.id,
    name: palette.name,
    colors: customSwatchColors(palette),
    editing: palette.id === runtime.editingPaletteId.value,
  })),
);

/** 編集している配色。選んでいない・消えたときは null */
const editing = computed(() => {
  const id = runtime.editingPaletteId.value;
  return id === null ? null : (findCustomPalette(id, customPalettes.value) ?? null);
});

const ROLES = [
  { key: "main", labelKey: "palette.role_main" },
  { key: "sub", labelKey: "palette.role_sub" },
  { key: "accent", labelKey: "palette.role_accent" },
] as const satisfies readonly { key: "main" | "sub" | "accent"; labelKey: MessageKey }[];

const backLabel = computed(() => (runtime.drawerBack.value ? t("common.back") : undefined));

function onName(event: Event): void {
  const target = event.target as HTMLInputElement;
  const palette = editing.value;
  if (!palette) return;
  const name = normalizePaletteName(target.value);
  if (name === null) {
    // 空の名前は受け付けず、元の名前に戻す
    target.value = palette.name;
    return;
  }
  target.value = name;
  emit("update", palette.id, { name });
}

function onColor(key: "main" | "sub" | "accent", event: Event): void {
  const palette = editing.value;
  if (!palette) return;
  emit("update", palette.id, { [key]: (event.target as HTMLInputElement).value });
}
</script>

<template>
  <UiDrawer class="palette-drawer" :title="t('palette.title')" :close-label="backLabel" @close="runtime.backDrawer()">
    <section class="list" :aria-labelledby="listId">
      <h3 :id="listId" class="legend">{{ t("palette.list") }}</h3>
      <ul class="rows">
        <li v-for="row in presetRows" :key="row.id" class="pal-row" :data-palette-id="row.id">
          <span class="row-name">
            <span class="chips" aria-hidden="true">
              <i v-for="(color, index) in row.colors" :key="index" class="chip" :style="{ background: color }" />
            </span>
            <span class="name-text">{{ row.name }}</span>
            <span class="badge">{{ t("palette.builtin") }}</span>
          </span>
          <span class="tools">
            <UiIconButton icon="duplicate" size="sm" :label="t('common.duplicate')" @click="emit('duplicate', row.id)" />
          </span>
        </li>
        <li
          v-for="row in customRows"
          :key="row.id"
          class="pal-row"
          :class="{ 'is-picked': row.editing }"
          :data-palette-id="row.id"
          :aria-current="row.editing ? 'true' : undefined"
        >
          <button
            type="button"
            class="row-name is-button ui-focusable"
            :aria-controls="row.editing ? editorId : undefined"
            @click="runtime.editPalette(row.id)"
          >
            <span class="chips" aria-hidden="true">
              <i v-for="(color, index) in row.colors" :key="index" class="chip" :style="{ background: color }" />
            </span>
            <span class="name-text">{{ row.name }}</span>
          </button>
          <span class="tools">
            <UiIconButton icon="duplicate" size="sm" :label="t('common.duplicate')" @click="emit('duplicate', row.id)" />
            <UiIconButton icon="delete" size="sm" :label="t('common.delete')" @click="emit('remove', row.id)" />
          </span>
        </li>
      </ul>
      <UiButton wide @click="emit('create')">{{ t("palette.new") }}</UiButton>
    </section>

    <section v-if="editing" :id="editorId" :key="editing.id" class="editor" :aria-labelledby="editorTitleId">
      <h3 :id="editorTitleId" class="editor-title">{{ t("palette.editing", { name: editing.name }) }}</h3>
      <div class="field">
        <label class="label" :for="nameId">{{ t("palette.name") }}</label>
        <input
          :id="nameId"
          class="text ui-focusable"
          type="text"
          :value="editing.name"
          :maxlength="PALETTE_NAME_MAX_LENGTH"
          autocomplete="off"
          spellcheck="false"
          @change="onName"
        />
      </div>
      <div v-for="role in ROLES" :key="role.key" class="row" :data-role="role.key">
        <span class="row-label" aria-hidden="true">{{ t(role.labelKey) }}</span>
        <label class="color-pick">
          <input
            class="color ui-focusable"
            type="color"
            :value="editing[role.key]"
            :aria-label="t(role.labelKey)"
            @input="onColor(role.key, $event)"
          />
          <code class="code">{{ editing[role.key] }}</code>
        </label>
      </div>
      <p class="note">{{ t("palette.light_note") }}</p>
    </section>
  </UiDrawer>
</template>

<style scoped>
.list {
  display: grid;
  gap: var(--space-2);
}

.legend {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.85em;
  font-weight: 400;
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}

.rows {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 行（モックの .mod-row） */
.pal-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-bg);
}

.pal-row.is-picked {
  border-color: var(--color-neon-a);
}

.row-name {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  font-weight: 700;
}

.row-name.is-button {
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 700;
  text-align: start;
  cursor: pointer;
}

.name-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

/* 見本（モックの .swatch-mini） */
.chips {
  display: inline-flex;
  flex: none;
  gap: var(--space-1);
}

.chip {
  width: var(--swatch-size);
  height: var(--swatch-size);
  border-radius: var(--radius-sm);
}

.badge {
  flex: none;
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-pill);
  color: var(--color-text-muted);
  font-size: 0.8em;
  font-weight: 400;
}

.tools {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

/* 編集（モックの .inspector） */
.editor {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3);
  border: var(--border-width) solid var(--color-neon-a);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  box-shadow: 0 0 var(--space-3) var(--color-glow-a);
}

.editor-title {
  margin: 0;
  font-size: inherit;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.field {
  display: grid;
  gap: var(--space-1);
}

.label {
  color: var(--color-text-muted);
  font-size: 0.85em;
  letter-spacing: var(--tracking-label);
}

.text {
  min-width: 0;
  min-height: var(--control-height);
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font: inherit;
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}

.row-label {
  min-width: 0;
}

/* 色（モックの .color-pick）。OS の色の選択を開く入力を、見本の四角として見せる */
.color-pick {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-sm);
  background: var(--color-surface-raised);
  cursor: pointer;
}

.color {
  width: var(--swatch-size);
  height: var(--swatch-size);
  padding: 0;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  cursor: pointer;
  appearance: none;
}

.color::-webkit-color-swatch-wrapper {
  padding: 0;
}

.color::-webkit-color-swatch {
  border: 0;
  border-radius: var(--radius-sm);
}

.code {
  font-family: var(--font-numeric);
  font-size: 0.9em;
}

.note {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.85em;
}
</style>
