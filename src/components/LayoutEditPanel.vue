<script setup lang="ts">
// レイアウト編集のパネル（S03。モックの .edit-panel）：見出しと自動配置／手動配置のバッジ、操作の説明、
// 置いたモジュールの一覧（T5-5 でスロットに入れる）、「自動整列」「完了」。
// メーターを見ながら編集するので、モーダルにはしない。開くと中へフォーカスを移し、Esc でも完了する（useDismiss）。
// 上端の位置は --drawer-top で指定する（既定は0）。格子は、このパネルの幅だけ右を空ける（置く側）
import { ref, useId } from "vue";
import type { LayoutMode } from "../config/types";
import { useT } from "../i18n/use_t";
import UiButton from "./ui/UiButton.vue";
import { useDismiss } from "./ui/use_dismiss";

defineProps<{ mode: LayoutMode }>();
const emit = defineEmits<{ autoArrange: []; done: [] }>();
defineSlots<{ default?(): unknown }>();

const { t } = useT();
const root = ref<HTMLElement | null>(null);
const titleId = useId();
useDismiss(root, () => emit("done"));
</script>

<template>
  <aside ref="root" class="layout-edit-panel" :aria-labelledby="titleId" tabindex="-1">
    <header class="head">
      <h2 :id="titleId" class="title">{{ t("layout_edit.title") }}</h2>
      <span class="mode-badge" :class="{ 'is-manual': mode === 'manual' }">
        {{ mode === "manual" ? t("layout_edit.mode_manual") : t("layout_edit.mode_auto") }}
      </span>
    </header>
    <div class="body">
      <p class="hint">{{ t("layout_edit.hint") }}</p>
      <slot />
    </div>
    <footer class="foot">
      <UiButton :disabled="mode === 'auto'" @click="emit('autoArrange')">{{ t("layout_edit.auto_arrange") }}</UiButton>
      <UiButton variant="primary" @click="emit('done')">{{ t("layout_edit.done") }}</UiButton>
    </footer>
  </aside>
</template>

<style scoped>
.layout-edit-panel {
  position: absolute;
  top: var(--drawer-top, 0);
  right: 0;
  bottom: 0;
  z-index: 6;
  display: grid;
  grid-template-rows: auto 1fr auto;
  width: min(var(--edit-panel-width), var(--edit-panel-max-ratio));
  min-width: 0;
  background: var(--color-surface);
  border-left: var(--border-width) solid var(--color-line);
  font-size: var(--font-size-sm);
}

.layout-edit-panel:focus {
  outline: none;
}

.head,
.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
}

.head {
  border-bottom: var(--border-width) solid var(--color-line);
}

.foot {
  justify-content: flex-end;
  border-top: var(--border-width) solid var(--color-line);
}

.title {
  min-width: 0;
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: 700;
}

/* 自動配置・手動配置のバッジ（モックの .badge・.badge.mode-manual）。手動配置の文字は、ライトでは --color-text */
.mode-badge {
  padding: 0 var(--space-2);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-pill);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  white-space: nowrap;
}

.mode-badge.is-manual {
  border-color: var(--color-neon-c);
  color: var(--color-label-c);
}

.body {
  display: grid;
  align-content: start;
  gap: var(--space-2);
  min-height: 0;
  padding: var(--space-3) var(--space-4);
  overflow: auto;
}

.hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
</style>
