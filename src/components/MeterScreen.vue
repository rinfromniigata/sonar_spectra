<script setup lang="ts">
// メーター画面（S01）：タイトル帯・メーターの格子・状態の表示を組み立て、起動と同時に取得を始める。
// - 起動の順序：source-status を listen し、準備ができてから start_stream を呼ぶ（起動直後の Opening を取りこぼさない）
// - 描画ループを provide し、格子の中の ModuleFrame が自分を登録する
// - インスタンスは、レジストリに登録されたモジュールから既定の構成を作る（構成の保存と復元はストアを作る T4-2 で置き換える）
// - 走査線と周辺減光（CrtOverlay）は画面全体に重ねる。表示するかは scanline（設定の display.scanline。既定でオン）で、
//   設定につなぐのは T4-4
// - タイトル帯のボタンと「設定」は、まだつながない（設定・全画面は Phase 4、レイアウト編集は Phase 5）
import { onMounted, shallowRef } from "vue";
import type { Channel } from "@tauri-apps/api/core";
import { useAppVersion } from "../app/use_app_version";
import { createDefaultInstances } from "../config/default_instances";
import type { Instance } from "../config/types";
import { FrameClient, startFrameStream } from "../frame_client";
import { moduleRegistry } from "../modules";
import { provideRenderLoop } from "../render/use_render_loop";
import { useSourceStatus } from "../source";
import CrtOverlay from "./CrtOverlay.vue";
import MeterGrid from "./MeterGrid.vue";
import StatusOverlay from "./StatusOverlay.vue";
import TitleBar from "./TitleBar.vue";

withDefaults(defineProps<{ scanline?: boolean }>(), { scanline: true });

const client = new FrameClient();
const instances = shallowRef<Instance[]>(createDefaultInstances(moduleRegistry));
const version = useAppVersion();
const source = useSourceStatus();

provideRenderLoop({ source: client, instances: () => instances.value, registry: moduleRegistry });

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
    <MeterGrid class="grid" :instances="instances" mode="auto" :registry="moduleRegistry" />
    <StatusOverlay :source="source.event.value" />
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
}

.meter-screen > :deep(.title-bar) {
  flex: none;
}

.grid {
  flex: 1 1 auto;
}
</style>
