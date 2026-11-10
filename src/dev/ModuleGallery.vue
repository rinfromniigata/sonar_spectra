<script setup lang="ts">
// モジュールギャラリー（画面ID: MODULES）。開発時だけ開ける。各モジュールの表示方式を、同じ合成信号で並べて見比べる。
// - スペクトラムの4方式とピークの残像（S05）、波形の履歴の色とチャンネル（S06）、
//   位相のリサージュの点描と周波数別の定位のモーションブラー（S08）
// - 追加のモジュール（VU・クロマ・重心と変化量）の見本（S07）。設定項目のないものは、推奨の形を添える
// - 本物の描画の経路（ModuleFrame・描画ループ・描画の層）をそのまま使う。入力は音声の取得ではなく合成信号（synthetic_signal.ts）
//   なので、Tauri の外でも動く。テーマを切り替えて、ダークとライトでも見比べられる
// - 描画の層（共有の WebGL2 キャンバス）は、画面全体に固定して内容の後ろに敷く。枠の範囲は、毎回の描画で枠の要素を測って
//   求める（スクロールに追従する。開発用なので、配置の状態から求める MeterGrid の方式は取らない）。画面の外の枠は描かない
import { onBeforeUnmount, onMounted, provide, ref } from "vue";
import ModuleFrame from "../components/ModuleFrame.vue";
import UiSegmented from "../components/ui/UiSegmented.vue";
import { createInstance } from "../config/default_instances";
import type { Instance } from "../config/types";
import { FrameClient } from "../frame_client";
import { encodeTestFrame } from "../frame_client/test_frames";
import { useT } from "../i18n/use_t";
import { centroidModule } from "../modules/centroid";
import { chromaModule } from "../modules/chroma";
import type { SpecOptions, StereoOptions, WaveOptions } from "../modules/options";
import { specModule } from "../modules/spec";
import { stereoModule } from "../modules/stereo";
import type { AnyModuleDefinition } from "../modules/types";
import { vuModule } from "../modules/vu";
import { waveModule } from "../modules/wave";
import type { DeviceRect } from "../render/gl/frame_rects";
import { provideShapeLayer } from "../render/gl/use_shape_layer";
import { RenderLoop } from "../render/render_loop";
import { RENDER_LOOP_KEY } from "../render/use_render_loop";
import { readDocumentCanvasColors, watchCanvasColors } from "../theme/canvas_colors";
import { syntheticSections } from "./synthetic_signal";
import { useGalleryTheme } from "./use_gallery_theme";

const { t } = useT();
const { theme, themeOptions } = useGalleryTheme();

// --- 合成信号と描画ループ（約60回/秒で信号を届け、描画はリフレッシュに合わせる） ---
const client = new FrameClient();
let colors = readDocumentCanvasColors();
const loop = new RenderLoop(client, () => colors);
provide(RENDER_LOOP_KEY, loop);

// --- 描画の層：画面全体に固定した共有キャンバスと、枠の要素を測った範囲 ---
const root = ref<HTMLElement | null>(null);
const layerCanvas = ref<HTMLCanvasElement | null>(null);

/** 今の枠の範囲（共有キャンバスのデバイスピクセル）。端は画面上のデバイスピクセルに丸める。画面の外の枠は入れない */
function deviceFrames(): Map<string, DeviceRect> {
  const frames = new Map<string, DeviceRect>();
  const canvas = layerCanvas.value;
  if (!canvas || !root.value) return frames;
  const dpr = window.devicePixelRatio || 1;
  const origin = canvas.getBoundingClientRect();
  const snap = (v: number) => Math.round(v * dpr);
  for (const element of root.value.querySelectorAll<HTMLElement>("[data-instance-id]")) {
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= origin.top || rect.top >= origin.bottom || rect.right <= origin.left || rect.left >= origin.right) continue;
    const x = snap(rect.left) - snap(origin.left);
    const y = snap(rect.top) - snap(origin.top);
    const width = snap(rect.right) - snap(origin.left) - x;
    const height = snap(rect.bottom) - snap(origin.top) - y;
    if (element.dataset.instanceId) frames.set(element.dataset.instanceId, { x, y, width, height });
  }
  return frames;
}
provideShapeLayer({ canvas: layerCanvas, frames: deviceFrames, loop });

const FEED_INTERVAL_MS = 1000 / 60;
let seq = 0;
let startedAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let stopColors: (() => void) | null = null;

onMounted(() => {
  startedAt = performance.now();
  stopColors = watchCanvasColors((next) => {
    colors = next;
  });
  loop.start();
  timer = setInterval(() => {
    const time = (performance.now() - startedAt) / 1000;
    client.receive(encodeTestFrame({ seq: seq++, sections: syntheticSections(time) }));
  }, FEED_INTERVAL_MS);
});
onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer);
  loop.stop();
  stopColors?.();
});

// --- 並べる見本 ---
/** 見本1つ：枠と、枠の下に付ける説明（主と副。副は「項目：状態」の形） */
interface Sample {
  instance: Instance;
  definition: AnyModuleDefinition;
  title: string;
  detail: string;
}

let nextId = 0;
function sample(
  instance: Instance,
  definition: AnyModuleDefinition,
  title: string,
  option: string,
  state: string,
): Sample {
  return { instance, definition, title, detail: t("dev_gallery.caption_option", { option, state }) };
}

const onOff = (on: boolean) => (on ? t("dev_gallery.state_on") : t("dev_gallery.state_off"));

function spec(options: Partial<SpecOptions>): Instance {
  return createInstance(specModule, { enabled: true, options }, `gallery-${nextId++}`) as unknown as Instance;
}
function wave(options: Partial<WaveOptions>): Instance {
  return createInstance(waveModule, { enabled: true, options }, `gallery-${nextId++}`) as unknown as Instance;
}
function centroid(speed: number): Instance {
  return createInstance(centroidModule, { enabled: true, options: { speed } }, `gallery-${nextId++}`) as unknown as Instance;
}
/** 設定項目のないモジュールの見本 */
function plain(definition: AnyModuleDefinition): Instance {
  return createInstance(definition as never, { enabled: true }, `gallery-${nextId++}`) as unknown as Instance;
}
function stereo(options: Partial<StereoOptions>): Instance {
  return createInstance(stereoModule, { enabled: true, options }, `gallery-${nextId++}`) as unknown as Instance;
}

const specDefinition = specModule as unknown as AnyModuleDefinition;
const waveDefinition = waveModule as unknown as AnyModuleDefinition;
const stereoDefinition = stereoModule as unknown as AnyModuleDefinition;

const ghost = t("instance.spectrum.peak_ghost");
const spectrumSamples: Sample[] = [
  sample(spec({ mode: "fill" }), specDefinition, t("instance.spectrum.mode_fill"), ghost, onOff(true)),
  sample(spec({ mode: "bars" }), specDefinition, t("instance.spectrum.mode_bars"), ghost, onOff(true)),
  sample(spec({ mode: "mirror" }), specDefinition, t("instance.spectrum.mode_mirror"), ghost, onOff(true)),
  sample(spec({ mode: "radial" }), specDefinition, t("instance.spectrum.mode_radial"), ghost, onOff(true)),
  sample(spec({ mode: "fill", ghost: false }), specDefinition, t("instance.spectrum.mode_fill"), ghost, onOff(false)),
];

const channel = t("instance.waveform.channel");
const stereoLabel = t("instance.waveform.channel_stereo");
const monoLabel = t("instance.waveform.channel_mono");
const waveSamples: Sample[] = [
  sample(wave({ histColor: "solid", channel: "stereo" }), waveDefinition, t("instance.waveform.history_color_solid"), channel, stereoLabel),
  sample(wave({ histColor: "bands", channel: "stereo" }), waveDefinition, t("instance.waveform.history_color_bands"), channel, stereoLabel),
  sample(wave({ histColor: "solid", channel: "mono" }), waveDefinition, t("instance.waveform.history_color_solid"), channel, monoLabel),
  sample(wave({ histColor: "bands", channel: "mono" }), waveDefinition, t("instance.waveform.history_color_bands"), channel, monoLabel),
];

const dotsName = t("instance.phase.dots");
const dotsLabel: [StereoOptions["dots"], string][] = [
  ["none", t("instance.phase.dots_none")],
  ["size", t("instance.phase.dots_size")],
  ["bright", t("instance.phase.dots_bright")],
  ["both", t("instance.phase.dots_both")],
];
const blurName = t("instance.phase.motion_blur");
const phaseSamples: Sample[] = [
  ...dotsLabel.map(([dots, label]) =>
    sample(stereo({ mode: "lissajous", dots }), stereoDefinition, t("instance.phase.mode_lissajous"), dotsName, label),
  ),
  sample(stereo({ mode: "pan", blur: true }), stereoDefinition, t("instance.phase.mode_pan"), blurName, onOff(true)),
  sample(stereo({ mode: "pan", blur: false }), stereoDefinition, t("instance.phase.mode_pan"), blurName, onOff(false)),
];

const vuDefinition = vuModule as unknown as AnyModuleDefinition;
const chromaDefinition = chromaModule as unknown as AnyModuleDefinition;
const centroidDefinition = centroidModule as unknown as AnyModuleDefinition;

/** 設定項目のないモジュールの見本：説明には推奨の形を出す */
const shapeNote = (definition: AnyModuleDefinition): Sample => ({
  instance: plain(definition),
  definition,
  title: t(definition.labelKey),
  detail: t(`module_shape.${definition.shape}` as "module_shape.compact"),
});
const vuSamples: Sample[] = [shapeNote(vuDefinition)];
const chromaSamples: Sample[] = [shapeNote(chromaDefinition)];

const speedName = t("instance.speed");
const centroidSamples: Sample[] = [1, 2].map((speed) => ({
  instance: centroid(speed),
  definition: centroidDefinition,
  title: t("modules.centroid"),
  detail: t("dev_gallery.caption_option", { option: speedName, state: t("common.speed_value", { value: speed }) }),
}));

/** 画面ごとの見本の並び（見出しは本物のモジュール名） */
const groups = [
  { screen: "S05", heading: t("modules.spectrum"), shape: "is-wide", samples: spectrumSamples },
  { screen: "S06", heading: t("modules.waveform"), shape: "is-wide", samples: waveSamples },
  { screen: "S08", heading: t("modules.phase"), shape: "is-square", samples: phaseSamples },
  { screen: "S07", heading: t("modules.vu"), shape: "is-square", samples: vuSamples },
  { screen: "S07", heading: t("modules.chroma"), shape: "is-square", samples: chromaSamples },
  { screen: "S07", heading: t("modules.centroid"), shape: "is-wide", samples: centroidSamples },
];
</script>

<template>
  <main ref="root" class="gallery">
    <!-- 描画の層（画面全体に固定し、内容の後ろに敷く） -->
    <canvas ref="layerCanvas" class="shape-layer" aria-hidden="true" />
    <header class="gallery-head">
      <div>
        <h1 class="gallery-title">{{ t("dev_gallery.modules_title") }}</h1>
        <p class="gallery-hint">{{ t("dev_gallery.modules_hint") }}</p>
      </div>
      <UiSegmented v-model="theme" :label="t('settings.theme')" :options="themeOptions" />
    </header>

    <section v-for="group in groups" :key="group.heading" class="group" :data-screen="group.screen">
      <h2>{{ group.heading }}</h2>
      <div class="samples" :class="group.shape">
        <figure v-for="item in group.samples" :key="item.instance.id" class="sample">
          <div class="frame">
            <ModuleFrame :instance="item.instance" :definition="item.definition" :data-instance-id="item.instance.id" />
          </div>
          <figcaption>
            <span>{{ item.title }}</span>
            <span>{{ item.detail }}</span>
          </figcaption>
        </figure>
      </div>
    </section>
  </main>
</template>

<style scoped>
.gallery {
  /* 描画の層を、内容の後ろ・このページの地の上に重ねる */
  isolation: isolate;
  height: 100%;
  overflow: auto;
  display: grid;
  align-content: start;
  gap: var(--space-5);
  padding: var(--space-5);
}
.shape-layer {
  position: fixed;
  inset: 0;
  z-index: -1;
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
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
.group {
  display: grid;
  gap: var(--space-3);
}
.group h2 {
  margin: 0;
  font-size: var(--font-size-sm);
  letter-spacing: var(--tracking-label);
  color: var(--color-text-muted);
}
.samples {
  display: grid;
  gap: var(--space-5);
}
.samples.is-wide {
  grid-template-columns: repeat(auto-fill, minmax(calc(var(--drawer-width) * 1.1), 1fr));
}
.samples.is-square {
  grid-template-columns: repeat(auto-fill, minmax(calc(var(--drawer-width) * 0.6), 1fr));
}
.sample {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  min-width: 0;
}
.frame {
  display: grid;
  border: var(--border-width) solid var(--color-line);
  border-radius: var(--radius-md);
  overflow: hidden;
}
.is-wide .frame {
  aspect-ratio: 2 / 1;
}
.is-square .frame {
  aspect-ratio: 1 / 1;
}
figcaption {
  display: grid;
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}
</style>
