// 受信（frame_client）の入口。形式を知るのは format.ts と sections.ts だけにする。

export { FLAG_STALE, FORMAT_VERSION, decodeFrame, type AnalysisFrame, type DecodeError, type DecodeResult } from "./format";
export {
  LEVEL_LEN,
  SectionId,
  WAVE_LEN,
  WAVE_NOW_POINTS,
  WAVE_SUMMARY_LEN,
  WaveSummary,
  readLevel,
  readWaveform,
  type LevelValues,
  type WaveformValues,
} from "./sections";
export { RowHistory } from "./history";
export { FrameClient, WAVE_HISTORY_CAPACITY, type FrameStats, type Histories } from "./client";
export { startFrameStream } from "./stream";
