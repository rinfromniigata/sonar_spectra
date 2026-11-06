<script setup lang="ts">
// 部品ギャラリー（画面ID: PARTS）。開発時だけ開ける。各部品を状態ごとに並べる。
// ホバー・フォーカス・押下は、見比べられるよう is-hover・is-focus・is-pressing のクラスで固定して見せる
import { computed, ref, useTemplateRef } from "vue";
import { formatMultiplier, formatPercent } from "../i18n/format";
import { useT } from "../i18n/use_t";
import UiButton from "../components/ui/UiButton.vue";
import UiChip from "../components/ui/UiChip.vue";
import UiDrawer from "../components/ui/UiDrawer.vue";
import UiIconButton from "../components/ui/UiIconButton.vue";
import UiPaletteSwatch from "../components/ui/UiPaletteSwatch.vue";
import UiPopover from "../components/ui/UiPopover.vue";
import UiSegmented from "../components/ui/UiSegmented.vue";
import UiSelect from "../components/ui/UiSelect.vue";
import UiSlider from "../components/ui/UiSlider.vue";
import UiSwitch from "../components/ui/UiSwitch.vue";
import { useGalleryTheme } from "./use_gallery_theme";

const { t } = useT();

// テーマ：ダークとライトで見比べる（設定パネルへのつなぎ込みは T4-4）
const { theme, themeOptions } = useGalleryTheme();

// 見本のデータ（デバイス名はOSから来る値なので辞書に置かない）
const DEVICE_SHORT = "Speakers (Realtek High Definition Audio)";
const DEVICE_LONG = "Speakers (Focusrite Scarlett 2i2 USB Audio Interface 4th Gen) - Monitor Out 1/2";

const switchOn = ref(true);
const switchOff = ref(false);
const direction = ref<"up" | "right" | "down" | "left">("right");
const directionOptions = computed(() => [
  { value: "up" as const, label: t("instance.direction.up") },
  { value: "right" as const, label: t("instance.direction.right") },
  { value: "down" as const, label: t("instance.direction.down") },
  { value: "left" as const, label: t("instance.direction.left") },
]);
const split = ref(72);
const speed = ref(1);
const device = ref("default");
const deviceOptions = [
  { value: "default", label: DEVICE_SHORT },
  { value: "long", label: DEVICE_LONG },
];
const palette = ref("magenta");
const palettes = computed(() => [
  { id: "magenta", name: t("palette.preset_magenta"), colors: ["var(--color-neon-a)", "var(--color-neon-b)"] },
  { id: "cyan", name: t("palette.preset_cyan"), colors: ["var(--color-neon-b)", "var(--color-neon-a)"] },
  { id: "amber", name: t("palette.preset_amber"), colors: ["var(--color-neon-c)", "var(--color-neon-a)"] },
]);

const drawerOpen = ref(false);
const popoverOpen = ref(false);
const popoverAnchor = useTemplateRef<HTMLElement>("popoverAnchor");
</script>

<template>
  <div class="gallery">
    <header class="gallery-head">
      <div>
        <h1 class="gallery-title">{{ t("dev_gallery.title") }}</h1>
        <p class="gallery-hint">{{ t("dev_gallery.hint") }}</p>
      </div>
      <UiSegmented v-model="theme" :label="t('settings.theme')" :options="themeOptions" />
    </header>

    <section class="part-group">
      <h2>{{ t("dev_gallery.part_button") }}</h2>
      <div class="parts">
        <div class="part"><UiButton>{{ t("settings.title") }}</UiButton><span>{{ t("dev_gallery.state_default") }}</span></div>
        <div class="part"><UiButton class="is-hover">{{ t("settings.title") }}</UiButton><span>{{ t("dev_gallery.state_hover") }}</span></div>
        <div class="part"><UiButton class="is-focus">{{ t("settings.title") }}</UiButton><span>{{ t("dev_gallery.state_focus") }}</span></div>
        <div class="part"><UiButton class="is-pressing">{{ t("settings.title") }}</UiButton><span>{{ t("dev_gallery.state_pressing") }}</span></div>
        <div class="part"><UiButton :pressed="true">{{ t("title_bar.layout_edit") }}</UiButton><span>{{ t("dev_gallery.state_selected") }}</span></div>
        <div class="part"><UiButton disabled>{{ t("settings.title") }}</UiButton><span>{{ t("dev_gallery.state_disabled") }}</span></div>
        <div class="part"><UiButton variant="primary">{{ t("common.retry") }}</UiButton><span>{{ t("dev_gallery.state_primary") }}</span></div>
      </div>
    </section>

    <section class="part-group">
      <h2>{{ t("dev_gallery.part_icon_button") }}</h2>
      <div class="parts">
        <div class="part"><UiIconButton icon="settings" :label="t('title_bar.settings')" /><span>{{ t("dev_gallery.state_default") }}</span></div>
        <div class="part"><UiIconButton class="is-hover" icon="layout" :label="t('title_bar.layout_edit')" /><span>{{ t("dev_gallery.state_hover") }}</span></div>
        <div class="part"><UiIconButton class="is-focus" icon="fullscreen" :label="t('title_bar.fullscreen')" /><span>{{ t("dev_gallery.state_focus") }}</span></div>
        <div class="part"><UiIconButton class="is-pressing" icon="fullscreen_exit" :label="t('title_bar.fullscreen_exit')" /><span>{{ t("dev_gallery.state_pressing") }}</span></div>
        <div class="part"><UiIconButton icon="layout" :pressed="true" :label="t('title_bar.layout_edit')" /><span>{{ t("dev_gallery.state_selected") }}</span></div>
        <div class="part"><UiIconButton icon="settings" disabled :label="t('title_bar.settings')" /><span>{{ t("dev_gallery.state_disabled") }}</span></div>
        <div class="part"><UiIconButton icon="duplicate" size="sm" :label="t('common.duplicate')" /><span>{{ t("dev_gallery.state_default") }}</span></div>
        <div class="part"><UiIconButton class="is-hover" icon="delete" size="sm" :label="t('common.delete')" /><span>{{ t("dev_gallery.state_hover") }}</span></div>
        <div class="part"><UiIconButton class="is-focus" icon="close" size="sm" :label="t('common.close')" /><span>{{ t("dev_gallery.state_focus") }}</span></div>
        <div class="part"><UiIconButton icon="delete" size="sm" disabled :label="t('common.delete')" /><span>{{ t("dev_gallery.state_disabled") }}</span></div>
      </div>
    </section>

    <section class="part-group">
      <h2>{{ t("dev_gallery.part_switch") }}</h2>
      <div class="parts">
        <div class="part"><UiSwitch v-model="switchOn" :label="t('settings.scanline')" /><span>{{ t("dev_gallery.state_on") }}</span></div>
        <div class="part"><UiSwitch v-model="switchOff" :label="t('settings.always_on_top')" /><span>{{ t("dev_gallery.state_off") }}</span></div>
        <div class="part"><UiSwitch v-model="switchOn" class="is-hover" :label="t('settings.scanline')" /><span>{{ t("dev_gallery.state_hover") }}</span></div>
        <div class="part"><UiSwitch v-model="switchOn" class="is-focus" :label="t('settings.scanline')" /><span>{{ t("dev_gallery.state_focus") }}</span></div>
        <div class="part"><UiSwitch :model-value="true" disabled :label="t('settings.start_fullscreen')" /><span>{{ t("dev_gallery.state_disabled") }}</span></div>
      </div>
    </section>

    <section class="part-group">
      <h2>{{ t("dev_gallery.part_segmented") }}</h2>
      <div class="parts">
        <div class="part"><UiSegmented v-model="direction" :label="t('instance.direction.label')" :options="directionOptions" /><span>{{ t("dev_gallery.state_selected") }}</span></div>
        <div class="part"><UiSegmented v-model="direction" disabled :label="t('instance.direction.label')" :options="directionOptions" /><span>{{ t("dev_gallery.state_disabled") }}</span></div>
      </div>
    </section>

    <section class="part-group">
      <h2>{{ t("dev_gallery.part_slider") }}</h2>
      <div class="parts">
        <div class="part is-wide">
          <UiSlider v-model="split" :label="t('instance.waveform.split')" :min="0" :max="100" :value-text="formatPercent(split)" />
          <span>{{ t("dev_gallery.state_default") }}</span>
        </div>
        <div class="part is-wide">
          <UiSlider
            v-model="speed"
            :label="t('instance.speed')"
            :min="0.25"
            :max="3"
            :step="0.25"
            :value-text="t('common.speed_value', { value: formatMultiplier(speed) })"
          />
          <span>{{ t("dev_gallery.state_default") }}</span>
        </div>
        <div class="part is-wide">
          <UiSlider v-model="split" disabled :label="t('instance.waveform.split')" :min="0" :max="100" :value-text="formatPercent(split)" />
          <span>{{ t("dev_gallery.state_disabled") }}</span>
        </div>
      </div>
    </section>

    <section class="part-group">
      <h2>{{ t("dev_gallery.part_select") }}</h2>
      <div class="parts">
        <div class="part is-wide"><UiSelect v-model="device" :label="t('settings.source_device')" :options="deviceOptions" /><span>{{ t("dev_gallery.state_default") }}</span></div>
        <div class="part is-wide"><UiSelect :model-value="'long'" :label="t('settings.source_device')" :options="deviceOptions" /><span>{{ t("dev_gallery.state_long") }}</span></div>
        <div class="part is-wide"><UiSelect v-model="device" disabled :label="t('settings.source_device')" :options="deviceOptions" /><span>{{ t("dev_gallery.state_disabled") }}</span></div>
      </div>
    </section>

    <section class="part-group">
      <h2>{{ t("dev_gallery.part_swatch") }}</h2>
      <div class="parts">
        <div v-for="item in palettes" :key="item.id" class="part">
          <UiPaletteSwatch :name="item.name" :colors="item.colors" :selected="palette === item.id" @select="palette = item.id" />
          <span>{{ palette === item.id ? t("dev_gallery.state_selected") : t("dev_gallery.state_default") }}</span>
        </div>
        <div class="part">
          <UiPaletteSwatch class="is-hover" :name="t('palette.preset_cyan')" :colors="['var(--color-neon-b)', 'var(--color-neon-a)']" />
          <span>{{ t("dev_gallery.state_hover") }}</span>
        </div>
        <div class="part">
          <UiPaletteSwatch class="is-focus" :name="t('palette.preset_amber')" :colors="['var(--color-neon-c)', 'var(--color-neon-a)']" />
          <span>{{ t("dev_gallery.state_focus") }}</span>
        </div>
        <div class="part">
          <UiPaletteSwatch disabled :name="t('palette.preset_magenta')" :colors="['var(--color-neon-a)', 'var(--color-neon-b)']" />
          <span>{{ t("dev_gallery.state_disabled") }}</span>
        </div>
      </div>
    </section>

    <section class="part-group">
      <h2>{{ t("dev_gallery.part_chip") }}</h2>
      <div class="parts">
        <div class="part"><UiChip status="live" :label="t('title_bar.source')" :text="t('source.chip_live', { device: DEVICE_SHORT })" /><span>{{ t("dev_gallery.chip_live") }}</span></div>
        <div class="part"><UiChip status="silent" :label="t('title_bar.source')" :text="t('source.chip_silent')" /><span>{{ t("dev_gallery.chip_silent") }}</span></div>
        <div class="part"><UiChip status="unavailable" :label="t('title_bar.source')" :text="t('source.chip_unavailable')" /><span>{{ t("dev_gallery.chip_unavailable") }}</span></div>
        <div class="part"><UiChip class="is-hover" status="live" :label="t('title_bar.source')" :text="t('source.chip_live', { device: DEVICE_SHORT })" /><span>{{ t("dev_gallery.state_hover") }}</span></div>
        <div class="part"><UiChip class="is-focus" status="live" :label="t('title_bar.source')" :text="t('source.chip_live', { device: DEVICE_SHORT })" /><span>{{ t("dev_gallery.state_focus") }}</span></div>
        <div class="part"><UiChip status="live" :label="t('title_bar.source')" :text="t('source.chip_live', { device: DEVICE_LONG })" /><span>{{ t("dev_gallery.state_long") }}</span></div>
      </div>
    </section>

    <section class="part-group">
      <h2>{{ t("dev_gallery.part_overlays") }}</h2>
      <div class="stage">
        <div class="stage-actions">
          <UiButton :pressed="drawerOpen" @click="drawerOpen = !drawerOpen">{{ t("dev_gallery.open_drawer") }}</UiButton>
          <div ref="popoverAnchor" class="anchor">
            <UiIconButton icon="settings" size="sm" :pressed="popoverOpen" :label="t('layout_edit.open_instance_settings')" @click="popoverOpen = !popoverOpen" />
            <span>{{ t("dev_gallery.open_popover") }}</span>
          </div>
        </div>

        <UiDrawer v-if="drawerOpen" :title="t('settings.title')" @close="drawerOpen = false">
          <div class="row">
            <span>{{ t("settings.scanline") }}</span>
            <UiSwitch v-model="switchOn" :label="t('settings.scanline')" />
          </div>
          <div class="row">
            <span>{{ t("settings.always_on_top") }}</span>
            <UiSwitch v-model="switchOff" :label="t('settings.always_on_top')" />
          </div>
          <UiSelect v-model="device" :label="t('settings.source_device')" :options="deviceOptions" />
          <template #footer>
            <UiButton @click="drawerOpen = false">{{ t("common.close") }}</UiButton>
          </template>
        </UiDrawer>

        <UiPopover v-if="popoverOpen" :label="t('layout_edit.open_instance_settings')" :anchor="popoverAnchor" @close="popoverOpen = false">
          <span class="field-label">{{ t("instance.direction.label") }}</span>
          <UiSegmented v-model="direction" :label="t('instance.direction.label')" :options="directionOptions" />
          <span class="field-label">{{ t("instance.palette") }}</span>
          <div class="swatches">
            <UiPaletteSwatch
              v-for="item in palettes"
              :key="item.id"
              :name="item.name"
              :colors="item.colors"
              :selected="palette === item.id"
              @select="palette = item.id"
            />
          </div>
        </UiPopover>
      </div>
    </section>
  </div>
</template>

<style scoped>
.gallery {
  height: 100%;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: var(--space-5);
  padding: var(--space-5);
}
.gallery-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
}
.gallery-title {
  margin: 0;
  font-size: var(--font-size-lg);
}
.gallery-hint {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-sm);
}
.part-group {
  display: grid;
  gap: var(--space-3);
}
.part-group h2 {
  margin: 0;
  font-size: var(--font-size-sm);
  letter-spacing: var(--tracking-label);
  color: var(--color-text-muted);
}
.parts {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  gap: var(--space-5);
  padding: var(--space-5);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
}
.part {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
  min-width: 0;
  max-width: 100%;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
.part.is-wide {
  width: min(100%, calc(var(--drawer-width) * 0.75));
  justify-items: stretch;
}
.stage {
  position: relative;
  min-height: calc(var(--drawer-width) * 1.2);
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-lg);
  background: var(--color-bg);
  overflow: hidden;
}
.stage-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4);
}
.anchor {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3);
  border: var(--border-width) dashed var(--color-line);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.field-label {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  letter-spacing: var(--tracking-label);
}
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
</style>
