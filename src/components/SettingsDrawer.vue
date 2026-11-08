<script setup lang="ts">
// 設定パネル（S02）。メーターを動かしたまま、タイトル帯の下・右側に重ねて開く。
// 欄の並びはモックのとおり：構成 → 入力源 → テーマ → 配色 → レイアウト → 表示。
// - テーマと表示の切り替えは、構成のストアの今の構成に書く（「保存後に変更あり」になる）。
//   書いた値を画面とウィンドウに効かせるのは T4-4（テーマ・走査線）と T4-6（常に最前面・起動時の全画面）
// - 閉じる（「閉じる」・Esc）は、実行中の状態のストアのドロワーを閉じる
// - 次の操作は、イベントで知らせるだけにする：出力デバイスの選択（selectDevice。MeterScreen が保存して切り替える）、
//   構成の切り替え・名前を付けて保存・構成を管理（switchConfig・saveAs・manageConfigs。Phase 7）、
//   配色を管理（managePalettes。Phase 7）、レイアウトを編集（editLayout。MeterScreen がこのパネルを閉じて編集を始める）
// - 入力源は、出力音声（ループバック）だけを選べる。入力デバイスは「今後対応」で無効にする
import { computed, onMounted, shallowRef, useId } from "vue";
import { useRuntimeStore } from "../app/runtime_store";
import { useConfigStore } from "../config/config_store";
import type { DisplaySettings, ThemeSetting } from "../config/types";
import { useT } from "../i18n/use_t";
import {
  DEFAULT_DEVICE_VALUE,
  deviceChoices,
  deviceIdFromValue,
  listOutputDevices,
  type DeviceChoice,
  type DeviceInfo,
} from "../source";
import type { ChoiceOption } from "./ui/types";
import UiButton from "./ui/UiButton.vue";
import UiDrawer from "./ui/UiDrawer.vue";
import UiSegmented from "./ui/UiSegmented.vue";
import UiSelect from "./ui/UiSelect.vue";
import UiSwitch from "./ui/UiSwitch.vue";

const emit = defineEmits<{
  selectDevice: [deviceId: string | null];
  switchConfig: [configId: string];
  saveAs: [];
  manageConfigs: [];
  managePalettes: [];
  editLayout: [];
}>();

const { t } = useT();
const config = useConfigStore();
const runtime = useRuntimeStore();
const sourceGroup = useId();

// 構成
const configOptions = computed<ChoiceOption<string>[]>(() =>
  config.state.value.savedConfigs.map((c) => ({ value: c.id, label: c.name })),
);
const activeConfigId = computed({
  get: () => config.state.value.activeConfigId,
  set: (id: string) => emit("switchConfig", id),
});

// 入力源：開いたときに出力デバイスの一覧を読む（読めなければ「既定のデバイス」だけ）
const devices = shallowRef<DeviceInfo[]>([]);
onMounted(() => {
  listOutputDevices()
    .then((list) => {
      devices.value = list;
    })
    .catch((error: unknown) => console.error(error));
});

function deviceLabel(choice: DeviceChoice): string {
  switch (choice.kind) {
    case "default":
      return choice.defaultName === null
        ? t("settings.source_device_default_plain")
        : t("settings.source_device_default", { device: choice.defaultName });
    case "device":
      return choice.name;
    case "missing":
      return t("settings.source_device_missing");
  }
}

const deviceOptions = computed<ChoiceOption<string>[]>(() =>
  deviceChoices(devices.value, config.deviceId.value).map((c) => ({ value: c.value, label: deviceLabel(c) })),
);
const deviceValue = computed({
  get: () => config.deviceId.value ?? DEFAULT_DEVICE_VALUE,
  set: (value: string) => emit("selectDevice", deviceIdFromValue(value)),
});

// テーマ
const themeOptions = computed<ChoiceOption<ThemeSetting>[]>(() => [
  { value: "dark", label: t("settings.theme_dark") },
  { value: "light", label: t("settings.theme_light") },
  { value: "system", label: t("settings.theme_system") },
]);
const theme = computed({
  get: () => config.current.value.theme,
  set: (value: ThemeSetting) =>
    config.updateCurrent((c) => {
      c.theme = value;
    }),
});

// 表示
type DisplayKey = keyof DisplaySettings;
const displayRows = computed<{ key: DisplayKey; label: string }[]>(() => [
  { key: "scanline", label: t("settings.scanline") },
  { key: "alwaysOnTop", label: t("settings.always_on_top") },
  { key: "startFullscreen", label: t("settings.start_fullscreen") },
]);

function setDisplay(key: DisplayKey, value: boolean): void {
  if (config.current.value.display[key] === value) return;
  config.updateCurrent((c) => {
    c.display[key] = value;
  });
}

function close(): void {
  runtime.closeDrawer();
}
</script>

<template>
  <UiDrawer class="settings-drawer" :title="t('settings.title')" @close="close">
    <fieldset class="field">
      <legend class="legend">{{ t("config.section") }}</legend>
      <UiSelect v-model="activeConfigId" :label="t('config.section')" :options="configOptions" />
      <p v-if="config.dirty.value" class="note is-modified">{{ t("config.modified") }}</p>
      <div class="button-row">
        <UiButton @click="emit('saveAs')">{{ t("config.save_as") }}</UiButton>
        <UiButton @click="emit('manageConfigs')">{{ t("config.manage") }}</UiButton>
      </div>
    </fieldset>

    <fieldset class="field">
      <legend class="legend">{{ t("settings.source") }}</legend>
      <label class="option is-checked">
        <input class="radio ui-focusable" type="radio" :name="sourceGroup" checked />
        <span class="option-main">
          <span class="option-title">{{ t("settings.source_loopback") }}</span>
          <span class="option-desc">{{ t("settings.source_loopback_desc") }}</span>
        </span>
      </label>
      <UiSelect v-model="deviceValue" class="device" :label="t('settings.source_device')" :options="deviceOptions" />
      <label class="option is-disabled">
        <input class="radio" type="radio" :name="sourceGroup" disabled />
        <span class="option-main">
          <span class="option-title">
            {{ t("settings.source_input") }}
            <span class="badge">{{ t("settings.coming_soon") }}</span>
          </span>
          <span class="option-desc">{{ t("settings.source_input_desc") }}</span>
        </span>
      </label>
    </fieldset>

    <fieldset class="field">
      <legend class="legend">{{ t("settings.theme") }}</legend>
      <UiSegmented v-model="theme" :label="t('settings.theme')" :options="themeOptions" />
    </fieldset>

    <fieldset class="field">
      <legend class="legend">{{ t("settings.palette") }}</legend>
      <p class="note">{{ t("settings.palette_note") }}</p>
      <UiButton wide @click="emit('managePalettes')">{{ t("settings.manage_palette") }}</UiButton>
    </fieldset>

    <fieldset class="field">
      <legend class="legend">{{ t("settings.layout") }}</legend>
      <UiButton wide @click="emit('editLayout')">{{ t("settings.edit_layout") }}</UiButton>
    </fieldset>

    <fieldset class="field">
      <legend class="legend">{{ t("settings.display") }}</legend>
      <div v-for="row in displayRows" :key="row.key" class="row" :data-setting="row.key">
        <span class="row-label">{{ row.label }}</span>
        <UiSwitch
          :model-value="config.current.value.display[row.key]"
          :label="row.label"
          @update:model-value="setDisplay(row.key, $event)"
        />
      </div>
    </fieldset>

    <template #footer>
      <UiButton @click="close">{{ t("common.close") }}</UiButton>
    </template>
  </UiDrawer>
</template>

<style scoped>
.field {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.legend {
  padding: 0;
  margin-bottom: var(--space-2);
  color: var(--color-text-muted);
  font-size: 0.85em;
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
}
.note {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 0.9em;
}
.button-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* 入力源の選択肢（ラジオのカード） */
.option {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: start;
  gap: var(--space-1) var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  cursor: pointer;
}
.option.is-checked {
  border-color: var(--color-neon-b);
  box-shadow:
    inset 0 0 0 var(--border-width) var(--color-neon-b),
    0 0 var(--space-3) var(--color-glow-b);
}
.option.is-disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.radio {
  margin: 0.3em 0 0;
  accent-color: var(--color-neon-b);
}
.option-main {
  display: grid;
  min-width: 0;
}
.option-desc {
  color: var(--color-text-muted);
  font-size: 0.9em;
}
.badge {
  display: inline-block;
  margin-left: var(--space-2);
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-pill);
  color: var(--color-text-muted);
  font-size: 0.8em;
}

/* 表示の切り替え */
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.row-label {
  min-width: 0;
}
</style>
