<script setup lang="ts">
// 置いたモジュールの一覧（S03。モックの .edit-panel の .mod-row と「＋ モジュールを追加」）。
// レイアウト編集のパネル（LayoutEditPanel）のスロットに入れる。
// - 行：名前と番号（押すとそのモジュールを選ぶ。無効なものは選べない）、複製・削除のボタン、有効／無効のスイッチ。
//   選んでいる行は強調し、無効な行は薄くする
// - 「＋ モジュールを追加」を押すと、その下に登録済みの種類の一覧（推奨の形の説明つき）を開き、選ぶと加える。
//   もう1度押す・Esc で閉じる
// - 操作はイベントで知らせるだけにする（MeterScreen が layout_edit_actions でストアに書く）
import { computed, ref, useId } from "vue";
import type { Instance } from "../config/types";
import { useT, type MessageKey } from "../i18n/use_t";
import { instanceNumbers } from "../layout/instance_numbers";
import type { ModuleKind } from "../modules/options";
import type { ModuleRegistry } from "../modules/registry";
import { addableKinds } from "./layout_edit_actions";
import UiButton from "./ui/UiButton.vue";
import UiIconButton from "./ui/UiIconButton.vue";
import UiSwitch from "./ui/UiSwitch.vue";

const props = defineProps<{
  instances: readonly Instance[];
  registry: ModuleRegistry;
  selectedId: string | null;
  /** 一覧の下に出すお知らせ。なければ null */
  notice: MessageKey | null;
}>();
const emit = defineEmits<{
  select: [id: string];
  duplicate: [id: string];
  remove: [id: string];
  toggle: [id: string, enabled: boolean];
  add: [kind: ModuleKind];
}>();

const { t } = useT();
const headingId = useId();
const kindsId = useId();

const rows = computed(() => {
  const numbers = instanceNumbers(props.instances);
  return props.instances.flatMap((instance) => {
    const definition = props.registry.get(instance.kind);
    if (!definition) return [];
    return [{ instance, name: `${t(definition.labelKey)} ${numbers.get(instance.id) ?? 1}`, selected: instance.id === props.selectedId }];
  });
});

const kinds = computed(() =>
  addableKinds(props.registry).map((item) => ({ kind: item.kind, name: t(item.labelKey), shape: t(item.shapeKey) })),
);

const picking = ref(false);

function choose(kind: ModuleKind): void {
  picking.value = false;
  emit("add", kind);
}

function onKindsKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  // パネルの Esc（編集を終える）より先に、種類の一覧だけを閉じる
  event.stopPropagation();
  picking.value = false;
}
</script>

<template>
  <section class="instance-list" :aria-labelledby="headingId">
    <h3 :id="headingId" class="legend">{{ t("layout_edit.instances") }}</h3>
    <ul class="rows">
      <li
        v-for="row in rows"
        :key="row.instance.id"
        class="mod-row"
        :class="{ 'is-off': !row.instance.enabled, 'is-picked': row.selected }"
        :aria-current="row.selected ? 'true' : undefined"
      >
        <button type="button" class="row-name ui-focusable" :disabled="!row.instance.enabled" @click="emit('select', row.instance.id)">
          {{ row.name }}
        </button>
        <span class="tools">
          <UiIconButton icon="duplicate" size="sm" :label="t('common.duplicate')" @click="emit('duplicate', row.instance.id)" />
          <UiIconButton icon="delete" size="sm" :label="t('common.delete')" @click="emit('remove', row.instance.id)" />
          <UiSwitch
            :model-value="row.instance.enabled"
            :label="row.name"
            @update:model-value="emit('toggle', row.instance.id, $event)"
          />
        </span>
      </li>
    </ul>
    <UiButton wide :aria-expanded="picking" :aria-controls="kindsId" @click="picking = !picking">
      {{ t("layout_edit.add_module") }}
    </UiButton>
    <ul v-if="picking" :id="kindsId" class="kinds" :aria-label="t('layout_edit.add_choose')" @keydown="onKindsKeydown">
      <li v-for="item in kinds" :key="item.kind">
        <button type="button" class="kind ui-focusable" @click="choose(item.kind)">
          <span class="kind-name">{{ item.name }}</span>
          <span class="kind-shape">{{ item.shape }}</span>
        </button>
      </li>
    </ul>
    <p v-if="notice" class="notice" role="status">{{ t(notice) }}</p>
  </section>
</template>

<style scoped>
.instance-list {
  display: grid;
  gap: var(--space-2);
}

.legend {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-weight: 400;
  letter-spacing: var(--tracking-label);
}

.rows,
.kinds {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

/* 行（モックの .mod-row） */
.mod-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-1) var(--space-2);
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-bg);
}

.mod-row.is-off {
  opacity: var(--row-off-opacity);
}

.mod-row.is-picked {
  border-color: var(--color-neon-a);
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

.row-name:disabled {
  cursor: default;
}

.tools {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
}

/* 追加する種類（推奨の形の説明つき） */
.kind {
  display: grid;
  gap: var(--space-1);
  width: 100%;
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: border-color var(--motion-fast) var(--motion-ease);
}

.kind:hover {
  border-color: var(--color-neon-b);
}

.kind-name {
  font-weight: 700;
}

.kind-shape {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}

.notice {
  margin: 0;
  color: var(--color-label-c);
  font-size: var(--font-size-xs);
}
</style>
