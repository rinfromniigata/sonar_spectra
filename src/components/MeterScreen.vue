<script setup lang="ts">
// メーター画面（S01）：タイトル帯・メーターの格子・状態の表示を組み立て、起動と同時に取得を始める。
// - 起動の順序：source-status を listen し、準備ができてから start_stream を呼ぶ（起動直後の Opening を取りこぼさない）
// - 描画ループを provide し、格子の中の ModuleFrame が自分を登録する
// - インスタンスと配置の種類は、構成のストア（useConfigStore）の今の構成から取る。入力源の状態は実行中の状態のストア
//   （useRuntimeStore）の source に書き込む
// - 走査線と周辺減光（CrtOverlay）は画面全体に重ねる。表示するかは設定の display.scanline（既定でオン）
// - テーマは main.ts が bindTheme（theme/apply_theme.ts）で文書の data-theme に反映する
// - 設定パネル（S02）は、実行中の状態のストアのドロワーが settings のときに重ねる（タイトル帯の下から）
// - タイトル帯のボタンと「設定」は、まだつながない（設定を開くのは T4-5、全画面は T4-6、レイアウト編集は Phase 5）
import { computed, onMounted } from "vue";
import type { Channel } from "@tauri-apps/api/core";
import { useRuntimeStore } from "../app/runtime_store";
import { useAppVersion } from "../app/use_app_version";
import { useConfigStore } from "../config/config_store";
import { FrameClient, startFrameStream } from "../frame_client";
import { moduleRegistry } from "../modules";
import { provideRenderLoop } from "../render/use_render_loop";
import { useSourceStatus } from "../source";
import CrtOverlay from "./CrtOverlay.vue";
import MeterGrid from "./MeterGrid.vue";
import SettingsDrawer from "./SettingsDrawer.vue";
import StatusOverlay from "./StatusOverlay.vue";
import TitleBar from "./TitleBar.vue";

const client = new FrameClient();
const config = useConfigStore();
const runtime = useRuntimeStore();
const layout = computed(() => config.current.value.layout);
const drawer = computed(() => runtime.drawer.value);
const scanline = computed(() => config.current.value.display.scanline);
const version = useAppVersion();
const source = useSourceStatus(runtime.source);

provideRenderLoop({ source: client, instances: () => layout.value.instances, registry: moduleRegistry });

/** 受信を続ける間、Channel を持っておく */
let channel: Channel<ArrayBuffer> | null = null;

onMounted(async () => {
  try {
    await source.ready;
    channel = await startFrameStream(client);
  } catch (error) {
    // Tauri の外で開いたときなど。状態の表示は「起動中」のまま残る
    console.error(error);
  }
});

defineExpose({ client, channel: () => channel });
</script>

<template>
  <div class="meter-screen">
    <TitleBar :version="version" :source="source.event.value" />
    <MeterGrid class="grid" :instances="layout.instances" :mode="layout.mode" :registry="moduleRegistry" />
    <StatusOverlay :source="source.event.value" />
    <SettingsDrawer v-if="drawer === 'settings'" />
    <CrtOverlay :enabled="scanline" />
  </div>
</template>

<style scoped>
/* 画面の幅を基準にタイトル帯の高さ（--title-h の cqi）を決めるため、この要素を container にする */
.meter-screen {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--color-bg);
  container-type: inline-size;
  /* 重ねるパネル（ドロワー）は、タイトル帯の下から始める */
  --drawer-top: var(--title-h);
}

.meter-screen > :deep(.title-bar) {
  flex: none;
}

.grid {
  flex: 1 1 auto;
}
</style>
