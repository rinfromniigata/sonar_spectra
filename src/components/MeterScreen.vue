<script setup lang="ts">
// メーター画面（S01）：タイトル帯・メーターの格子・状態の表示を組み立て、起動と同時に取得を始める。
// - 起動の順序：source-status を listen し、準備ができてから start_stream を呼ぶ（起動直後の Opening を取りこぼさない）。
//   保存された出力デバイス（source.deviceId）があれば、start_stream の前に select_output_device で選んでおく
//   （Rust の入力源は、まだ開いていなければ start_stream で開くが、そのときのデバイスは選ばれているものになる）
// - 描画ループを provide し、格子の中の ModuleFrame が自分を登録する
// - インスタンスと配置の種類は、構成のストア（useConfigStore）の今の構成から取る。入力源の状態は実行中の状態のストア
//   （useRuntimeStore）の source に書き込む
// - 走査線と周辺減光（CrtOverlay）は画面全体に重ねる。表示するかは設定の display.scanline（既定でオン）
// - テーマは main.ts が bindTheme（theme/apply_theme.ts）で文書の data-theme に反映する
// - 設定パネル（S02）は、実行中の状態のストアのドロワーが settings のときに重ねる（タイトル帯の下から）。
//   タイトル帯の設定ボタン（開いていれば閉じる）・出力系統のチップと、S01c の「設定」で開く
// - 設定パネルで出力デバイスを選んだら、source.deviceId を保存して select_output_device で切り替える。
//   切り替え中は Rust が Opening を通知するので、状態の表示が S01d（スピナー）、チップが消灯になる
// - タイトル帯の全画面ボタンは、ウィンドウの扱い（useWindowController）の toggleFullscreen を呼ぶ。全画面中かどうかは
//   実行中の状態のストアの fullscreen（実際のウィンドウの状態）で、ボタンのアイコンと読み上げの名前が変わる
// - レイアウト編集（S03）：タイトル帯のレイアウト編集ボタン（編集中ならもう1度押すと終える）と、設定パネルの
//   「レイアウトを編集」で始める（設定パネルは閉じる）。編集中は格子の右にパネル（LayoutEditPanel）を置き、格子はその分だけ狭くなる。
//   格子で配置を変えたら手動配置として構成に書く（自動配置なら、その時点の自動整列の結果がそのまま固定される）。
//   「自動整列」で自動配置に戻し、「完了」で編集を終える。選んでいるインスタンスは実行中の状態のストアに持つ。
//   編集中は状態の表示（StatusOverlay）を出さない（入力源が開けないときの幕で、格子を編集できなくならないように）
import { computed, onMounted } from "vue";
import type { Channel } from "@tauri-apps/api/core";
import { useRuntimeStore } from "../app/runtime_store";
import { useAppVersion } from "../app/use_app_version";
import { useConfigStore } from "../config/config_store";
import type { Instance } from "../config/types";
import { FrameClient, startFrameStream } from "../frame_client";
import { returnToAuto, setDirection } from "../layout/manual";
import type { Direction } from "../modules/options";
import { moduleRegistry } from "../modules";
import { provideRenderLoop } from "../render/use_render_loop";
import { useWindowController } from "../window";
import { createDeviceSelection, useSourceStatus } from "../source";
import CrtOverlay from "./CrtOverlay.vue";
import LayoutEditPanel from "./LayoutEditPanel.vue";
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
const devices = createDeviceSelection(config);
const windowController = useWindowController();

provideRenderLoop({ source: client, instances: () => layout.value.instances, registry: moduleRegistry });

/** 受信を続ける間、Channel を持っておく */
let channel: Channel<ArrayBuffer> | null = null;

onMounted(async () => {
  try {
    await source.ready;
    await devices.restore();
    channel = await startFrameStream(client);
  } catch (error) {
    // Tauri の外で開いたときなど。状態の表示は「起動中」のまま残る
    console.error(error);
  }
});

function openSettings(): void {
  runtime.openDrawer("settings");
}

function toggleFullscreen(): void {
  void windowController.toggleFullscreen();
}

function toggleSettings(): void {
  if (drawer.value === "settings") runtime.closeDrawer();
  else openSettings();
}

const editing = computed(() => runtime.layoutEditing.value);

function startLayoutEdit(): void {
  runtime.closeDrawer();
  runtime.setLayoutEditing(true);
}

function finishLayoutEdit(): void {
  runtime.setLayoutEditing(false);
}

function toggleLayoutEdit(): void {
  if (editing.value) finishLayoutEdit();
  else startLayoutEdit();
}

/** 格子で配置を変えた：手動配置にして、インスタンスの並びを置き換える */
function applyLayout(instances: Instance[]): void {
  config.updateCurrent((draft) => {
    draft.layout = { mode: "manual", instances };
  });
}

/** 流れる方向の矢印：そのインスタンスの方向だけを変える（配置の種類は変えない） */
function changeDirection(id: string, direction: Direction): void {
  // 変わらないときは書かない（「保存後に変更あり」にしない）
  if (!setDirection(layout.value.instances, id, direction)) return;
  config.updateCurrent((draft) => {
    const next = setDirection(draft.layout.instances, id, direction);
    if (next) draft.layout.instances = next;
  });
}

/** 「自動整列」：自動配置に戻す */
function arrangeAutomatically(): void {
  if (layout.value.mode === "auto") return;
  config.updateCurrent((draft) => {
    draft.layout = returnToAuto(draft.layout);
  });
}

defineExpose({ client, channel: () => channel });
</script>

<template>
  <div class="meter-screen">
    <TitleBar
      :version="version"
      :source="source.event.value"
      :fullscreen="runtime.fullscreen.value"
      :layout-editing="editing"
      @settings="toggleSettings"
      @source="openSettings"
      @fullscreen="toggleFullscreen"
      @layout-edit="toggleLayoutEdit"
    />
    <MeterGrid
      class="grid"
      :class="{ 'is-editing': editing }"
      :instances="layout.instances"
      :mode="layout.mode"
      :registry="moduleRegistry"
      :editing="editing"
      :selected-id="runtime.selectedInstanceId.value"
      @select="runtime.selectInstance"
      @update="applyLayout"
      @direction="changeDirection"
    />
    <!-- 編集中は出さない（S01c・S01d の幕が格子をふさがないように。入力源の状態はタイトル帯のチップで分かる） -->
    <StatusOverlay v-if="!editing" :source="source.event.value" @open-settings="openSettings" />
    <LayoutEditPanel v-if="editing" :mode="layout.mode" @auto-arrange="arrangeAutomatically" @done="finishLayoutEdit" />
    <SettingsDrawer v-if="drawer === 'settings'" @select-device="devices.choose" @edit-layout="startLayoutEdit" />
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

/* レイアウト編集中は、右のパネルの幅だけ空ける（パネルと同じ幅。% はこの画面の幅に対して決まる） */
.grid.is-editing {
  margin-right: min(var(--edit-panel-width), var(--edit-panel-max-ratio));
}
</style>
