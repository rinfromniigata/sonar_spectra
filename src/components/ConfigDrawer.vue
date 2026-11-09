<script setup lang="ts">
// 構成の管理（S02b）。設定パネルと同じ位置に重ねて開く（モックの presetDrawerHtml）。
// - 説明 → 一覧 →「名前を付けて保存」「ファイルから読み込む」の順
// - 一覧の行：名前（押すとその構成に切り替える）、使用中の印、配置の種類・モジュール数（有効なもの）・保存日（Intl で整形）、
//   書き出し・複製・削除のボタン。使用中の構成は削除できない（ボタンを押せなくする）
// - 変更があるときの切り替えは、一覧の下に確認を出す（上書き・別の名前で保存・破棄・キャンセル）。
//   別の名前で保存と「名前を付けて保存」は、名前の入力を出す。確認と名前の入力の Esc は、それだけを閉じる
// - 書き出し・読み込みの結果は、下にお知らせとして出す
// - 見出しのボタン：戻る先（設定パネル）があれば「戻る」、なければ「閉じる」
// 操作と途中の状態は config_manager が持つ
import { computed, nextTick, ref, useId, watch } from "vue";
import { useRuntimeStore } from "../app/runtime_store";
import { useConfigStore } from "../config/config_store";
import type { ConfigFileIo } from "../config/config_file";
import { CONFIG_NAME_MAX_LENGTH } from "../config/saved_configs";
import type { SavedConfig } from "../config/types";
import { formatDate, formatInteger } from "../i18n/format";
import { useT } from "../i18n/use_t";
import { createConfigManager, type ConfigManager } from "./config_manager";
import UiButton from "./ui/UiButton.vue";
import UiDrawer from "./ui/UiDrawer.vue";
import UiIconButton from "./ui/UiIconButton.vue";

const props = defineProps<{
  /** ファイルの読み書きの呼び出し口（テスト用。省けば Tauri のプラグイン） */
  io?: ConfigFileIo;
  /** 操作と途中の状態（テスト用。省けばここで作る） */
  manager?: ConfigManager;
}>();

const { t } = useT();
const config = useConfigStore();
const runtime = useRuntimeStore();
const manager =
  props.manager ??
  createConfigManager({
    config,
    io: props.io,
    names: {
      copy: (name) => t("config.copy_name", { name }),
      filterName: () => t("config.file_filter"),
      fallbackFileName: () => t("config.file_fallback_name"),
    },
  });
const confirmId = useId();
const nameId = useId();

const backLabel = computed(() => (runtime.drawerBack.value ? t("common.back") : undefined));

function meta(saved: SavedConfig): string {
  return t("config.meta", {
    layout_mode: saved.layout.mode === "auto" ? t("layout_edit.mode_auto") : t("layout_edit.mode_manual"),
    count: formatInteger(saved.layout.instances.filter((i) => i.enabled).length),
    date: formatDate(saved.savedAt),
  });
}

const rows = computed(() =>
  config.state.value.savedConfigs.map((saved) => ({
    id: saved.id,
    name: saved.name,
    meta: meta(saved),
    active: saved.id === config.state.value.activeConfigId,
    removable: config.canRemoveConfig(saved.id),
  })),
);

const pendingName = computed(() => {
  const pending = manager.pendingSwitch.value;
  return pending ? (config.state.value.savedConfigs.find((c) => c.id === pending.id)?.name ?? "") : "";
});
const activeName = computed(() => config.activeConfig.value?.name ?? "");

// 名前の入力：開いたら初めの値を入れて、入力欄へフォーカスを移す
const nameText = ref("");
const nameInput = ref<HTMLInputElement | null>(null);
const nameFormElement = ref<HTMLElement | null>(null);
const confirmTitle = ref<HTMLElement | null>(null);
const noticeElement = ref<HTMLElement | null>(null);
const nameValid = computed(() => nameText.value.trim() !== "");
watch(
  () => manager.nameForm.value,
  async (form) => {
    if (!form) return;
    nameText.value = form.initial;
    await nextTick();
    nameInput.value?.focus();
    nameInput.value?.select();
    nameFormElement.value?.scrollIntoView?.({ block: "nearest" });
  },
  { immediate: true },
);

// 確認・名前の入力・お知らせは一覧の下に出るため、出たら見える位置までスクロールする（低い画面で、押しても
// 何も起きていないように見えないように）。確認は、その文へフォーカスを移す（読み上げで伝わり、決定のボタンを
// 誤って Enter で押さないように）
watch(
  () => manager.pendingSwitch.value !== null && manager.nameForm.value === null,
  (showing) => {
    if (!showing) return;
    confirmTitle.value?.focus?.({ preventScroll: true });
    confirmTitle.value?.parentElement?.scrollIntoView?.({ block: "nearest" });
  },
  { immediate: true, flush: "post" },
);
watch(
  () => manager.notice.value,
  (value) => {
    if (value) noticeElement.value?.scrollIntoView?.({ block: "nearest" });
  },
  { flush: "post" },
);

function submitName(): void {
  manager.submitName(nameText.value);
}

/** 確認・名前の入力の中の Esc は、それだけを閉じる（ドロワーは閉じない） */
function onInlineKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  event.stopPropagation();
  manager.cancel();
}

const notice = computed(() => {
  const value = manager.notice.value;
  if (!value) return null;
  switch (value.kind) {
    case "exported":
      return { text: t("config.exported", { name: value.name }), error: false };
    case "imported":
      return { text: t("config.imported", { name: value.name }), error: false };
    case "export_failed":
      return { text: t("config.export_failed"), error: true };
    case "import_failed":
      return { text: t("config.import_failed"), error: true };
    default:
      return null;
  }
});

// 設定パネルから開いたときの最初の操作（名前の入力・切り替えの確認）
const intent = runtime.takeConfigIntent();
if (intent?.kind === "saveAs") manager.startSaveAs();
else if (intent?.kind === "switch") manager.requestSwitch(intent.id);

defineExpose({ manager });
</script>

<template>
  <UiDrawer class="config-drawer" :title="t('config.title')" :close-label="backLabel" @close="runtime.backDrawer()">
    <p class="hint">{{ t("config.hint") }}</p>

    <ul class="rows">
      <li
        v-for="row in rows"
        :key="row.id"
        class="cfg-row"
        :class="{ 'is-picked': row.active }"
        :data-config-id="row.id"
        :aria-current="row.active ? 'true' : undefined"
      >
        <span class="row-main">
          <span class="row-head">
            <button
              type="button"
              class="row-name ui-focusable"
              :aria-label="t('config.switch_to', { name: row.name })"
              @click="manager.requestSwitch(row.id)"
            >
              {{ row.name }}
            </button>
            <span v-if="row.active" class="badge">{{ t("config.in_use") }}</span>
          </span>
          <span class="meta">{{ row.meta }}</span>
        </span>
        <span class="tools">
          <UiIconButton icon="export" size="sm" :label="t('config.export')" @click="manager.exportConfig(row.id)" />
          <UiIconButton icon="duplicate" size="sm" :label="t('common.duplicate')" @click="manager.duplicate(row.id)" />
          <UiIconButton
            icon="delete"
            size="sm"
            :label="t('common.delete')"
            :disabled="!row.removable"
            @click="manager.remove(row.id)"
          />
        </span>
      </li>
    </ul>

    <section
      v-if="manager.pendingSwitch.value && !manager.nameForm.value"
      class="inline confirm"
      role="group"
      :aria-labelledby="confirmId"
      @keydown="onInlineKeydown"
    >
      <p :id="confirmId" ref="confirmTitle" class="inline-title" tabindex="-1">
        {{ t("config.confirm_switch", { name: pendingName }) }}
      </p>
      <div class="button-column">
        <UiButton @click="manager.resolveSwitch('overwrite')">{{ t("config.confirm_overwrite", { name: activeName }) }}</UiButton>
        <UiButton @click="manager.startSwitchSaveAs()">{{ t("config.confirm_save_as") }}</UiButton>
        <UiButton @click="manager.resolveSwitch('discard')">{{ t("config.confirm_discard") }}</UiButton>
        <UiButton @click="manager.cancel()">{{ t("common.cancel") }}</UiButton>
      </div>
    </section>

    <form
      v-if="manager.nameForm.value"
      ref="nameFormElement"
      class="inline name-form"
      @submit.prevent="submitName"
      @keydown="onInlineKeydown"
    >
      <label class="label" :for="nameId">{{ t("config.name") }}</label>
      <input
        :id="nameId"
        ref="nameInput"
        v-model="nameText"
        class="text ui-focusable"
        type="text"
        :maxlength="CONFIG_NAME_MAX_LENGTH"
        autocomplete="off"
        spellcheck="false"
      />
      <div class="button-row">
        <UiButton :disabled="!nameValid" @click="submitName">{{ t("common.save") }}</UiButton>
        <UiButton @click="manager.cancel()">{{ t("common.cancel") }}</UiButton>
      </div>
    </form>

    <div class="button-row">
      <UiButton @click="manager.startSaveAs()">{{ t("config.save_as") }}</UiButton>
      <UiButton @click="manager.importConfig()">{{ t("config.import") }}</UiButton>
    </div>

    <p v-if="notice" ref="noticeElement" class="notice" :class="{ 'is-error': notice.error }" role="status">{{ notice.text }}</p>
  </UiDrawer>
</template>

<style scoped>
.hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9em;
}

.rows {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 行（モックの .mod-row） */
.cfg-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-bg);
}

.cfg-row.is-picked {
  border-color: var(--color-neon-a);
}

.row-main {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.row-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.row-name {
  min-width: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 700;
  text-align: start;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.badge {
  flex: none;
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-pill);
  color: var(--color-text-muted);
  font-size: 0.8em;
}

.meta {
  color: var(--color-text-muted);
  font-size: 0.9em;
}

.tools {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

/* 切り替えの確認と名前の入力（モックの .inspector に合わせた囲み） */
.inline {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: var(--space-3);
  border: var(--border-width) solid var(--color-neon-a);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  box-shadow: 0 0 var(--space-3) var(--color-glow-a);
}

.inline-title {
  margin: 0;
  outline: none;
  font-weight: 700;
  overflow-wrap: anywhere;
}

.button-column {
  display: grid;
  gap: var(--space-2);
}

.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
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

.notice {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9em;
}

.notice.is-error {
  color: var(--color-label-c);
}
</style>
