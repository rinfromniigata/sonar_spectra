<script setup lang="ts">
// タイトル帯：SONAR/SPECTRA とバージョン、出力系統のチップ、レイアウト編集・設定・ボーダレスフルスクリーンのボタン。
// 高さは --title-h（画面の幅に応じて変わる）。置く側が container-type: inline-size を持つこと。
// ボタンの動作はここでは持たず、イベントで知らせる（設定とチップは MeterScreen が設定パネルを開く。全画面は MeterScreen がウィンドウの扱いにつなぐ。レイアウト編集は Phase 5 でつなぐ）。
import { computed } from "vue";
import { useT } from "../i18n/use_t";
import { chipView, type SourceStatusEvent } from "../source";
import UiChip from "./ui/UiChip.vue";
import UiIconButton from "./ui/UiIconButton.vue";

const props = withDefaults(
  defineProps<{
    /** アプリのバージョン（"0.1.0" など）。空なら表示しない */
    version?: string;
    /** 入力源の状態。まだ届いていなければ null（起動中として表示する） */
    source: SourceStatusEvent | null;
    /** レイアウト編集中か（ボタンを押された状態にする） */
    layoutEditing?: boolean;
    /** ボーダレスフルスクリーン中か（アイコンと読み上げの名前を終了用に変える） */
    fullscreen?: boolean;
  }>(),
  { version: "", layoutEditing: false, fullscreen: false },
);
defineEmits<{ source: []; layoutEdit: []; settings: []; fullscreen: [] }>();

const { t } = useT();

/** ロゴタイプ。翻訳する文言ではない（スラッシュだけ副色で光らせる） */
const BRAND = ["SONAR", "/", "SPECTRA"] as const;

const chip = computed(() => {
  const view = chipView(props.source);
  const text =
    view.messageKey === "source.chip_live" ? t("source.chip_live", { device: view.device ?? "" }) : t(view.messageKey);
  return { status: view.status, text };
});
</script>

<template>
  <header class="title-bar">
    <p class="mark">
      <template v-for="(part, index) in BRAND" :key="index">
        <span v-if="part === '/'" class="slash">{{ part }}</span>
        <template v-else>{{ part }}</template>
      </template>
    </p>
    <span v-if="version" class="version">{{ t("app.version", { version }) }}</span>
    <div class="controls">
      <UiChip :status="chip.status" :text="chip.text" :label="t('title_bar.source')" @click="$emit('source')" />
      <UiIconButton
        icon="layout"
        :label="t('title_bar.layout_edit')"
        :pressed="layoutEditing"
        @click="$emit('layoutEdit')"
      />
      <UiIconButton icon="settings" :label="t('title_bar.settings')" @click="$emit('settings')" />
      <UiIconButton
        :icon="fullscreen ? 'fullscreen_exit' : 'fullscreen'"
        :label="fullscreen ? t('title_bar.fullscreen_exit') : t('title_bar.fullscreen')"
        @click="$emit('fullscreen')"
      />
    </div>
  </header>
</template>

<style scoped>
.title-bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  height: var(--title-h);
  padding-inline: clamp(var(--space-2), 1cqi, var(--space-4));
  background: var(--color-bg);
  border-bottom: var(--border-width) solid var(--color-line);
}

.mark {
  flex: none;
  margin: 0;
  color: var(--color-neon-b);
  font-family: var(--font-display);
  font-size: calc(var(--title-h) * 0.38);
  font-weight: 700;
  letter-spacing: 0.1em;
  text-shadow: var(--glow-line-b);
  white-space: nowrap;
}

.slash {
  color: var(--color-neon-a);
  text-shadow: var(--glow-line-a);
}

.version {
  color: var(--color-text-muted);
  font-family: var(--font-numeric);
  font-size: calc(var(--title-h) * 0.3);
  white-space: nowrap;
}

/* ボタンとチップは、タイトル帯の高さに合わせて縮む（モックと同じ割合） */
.controls {
  --control-height: calc(var(--title-h) * 0.72);
  --chip-height: calc(var(--title-h) * 0.72);
  --icon-size-md: calc(var(--title-h) * 0.34);
  display: flex;
  align-items: center;
  gap: clamp(var(--space-1), 0.5cqi, var(--space-2));
  min-width: 0;
  margin-left: auto;
}

.controls :deep(.ui-chip) {
  max-width: min(40cqi, var(--chip-max-width));
  font-size: clamp(var(--chip-font-min), 0.85cqi, var(--font-size-xs));
}
</style>
