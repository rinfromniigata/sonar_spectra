<script setup lang="ts">
import { ref, useId } from "vue";
import { useT } from "../../i18n/use_t";
import UiButton from "./UiButton.vue";
import { useDismiss } from "./use_dismiss";

// 右から重ねて開くパネル（設定など）。メーターは動かしたまま開くため、モーダルにはしない。
// 使う側は v-if で出し入れし、close を受けて閉じる。上端の位置は --drawer-top で指定する（既定は0）。
// 見出しの横のボタン（と Esc）は close を出す。ボタンの文言は closeLabel で替えられる（別のドロワーへ戻るときの「戻る」など）
defineProps<{ title: string; closeLabel?: string }>();
const emit = defineEmits<{ close: [] }>();
defineSlots<{ default(): unknown; footer?(): unknown }>();

const { t } = useT();
const root = ref<HTMLElement | null>(null);
const titleId = useId();
useDismiss(root, () => emit("close"));
</script>

<template>
  <aside ref="root" class="ui-drawer" role="dialog" :aria-labelledby="titleId" tabindex="-1">
    <header class="head">
      <h2 :id="titleId" class="title">{{ title }}</h2>
      <UiButton @click="emit('close')">{{ closeLabel ?? t("common.close") }}</UiButton>
    </header>
    <div class="body">
      <slot />
    </div>
    <footer v-if="$slots.footer" class="foot">
      <slot name="footer" />
    </footer>
  </aside>
</template>

<style scoped>
.ui-drawer {
  position: absolute;
  top: var(--drawer-top, 0);
  right: 0;
  bottom: 0;
  z-index: 6;
  display: grid;
  grid-template-rows: auto 1fr auto;
  width: min(var(--drawer-width), var(--drawer-max-ratio));
  min-width: 0;
  background: var(--color-surface);
  border-left: var(--border-width) solid var(--color-line);
  box-shadow: var(--shadow-panel);
  font-size: var(--font-size-sm);
}
.ui-drawer:focus {
  outline: none;
}
.head,
.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
.body {
  display: grid;
  align-content: start;
  gap: var(--space-4);
  min-height: 0;
  padding: var(--space-3) var(--space-4);
  overflow: auto;
}
</style>
