// 受信：Channel から届いたバイト列を解析結果に戻し、最新の値と履歴を保持する。
// 受信と描画のタイミングは切り離す。描画ループは毎回 `latest` と `histories` を読むだけにする。

import { decodeFrame, type AnalysisFrame } from "./format";
import { RowHistory } from "./history";
import { SPECTRUM_LEN, WAVE_SUMMARY_LEN, readSpectrum, readWaveform } from "./sections";

/** 波形の履歴に積む行数（約60行/秒で約68秒分。広い画面で流れる速さを最も遅くしても足りる量） */
export const WAVE_HISTORY_CAPACITY = 4096;

/**
 * スペクトログラムの履歴に積む行数（約60行/秒で約34秒分）。画面を最も細かく流しても（1行を1ピクセルの幅にする）、
 * 4K 相当の幅の列を作り直せる量。ふだんの流れは描画側が持つ画像で動き、履歴は作り直しのときだけ読む
 */
export const GRAM_HISTORY_CAPACITY = 2048;

/** モジュールのインスタンス間で共有する履歴 */
export interface Histories {
  /** 波形：1行＝履歴用の要約（`WaveSummary` の並び） */
  wave: RowHistory;
  /** スペクトログラム：1行＝スペクトラムの帯域ごとの振幅（線形。低い順） */
  gram: RowHistory;
}

/** 受信の状況（確かめるときと、食い違いを知らせるときに使う） */
export interface FrameStats {
  /** 使えたフレームの数 */
  received: number;
  /** 復元できなかったフレームの数（版の食い違いを含む） */
  rejected: number;
  /** seq の飛びから数えた、届かなかったフレームの数 */
  missed: number;
  /** 形式の版が食い違ったフレームの版。食い違っていなければ null */
  incompatibleVersion: number | null;
}

export class FrameClient {
  /** 最後に使えたフレーム。まだなければ null */
  latest: AnalysisFrame | null = null;
  readonly histories: Histories = {
    wave: new RowHistory(WAVE_SUMMARY_LEN, WAVE_HISTORY_CAPACITY),
    gram: new RowHistory(SPECTRUM_LEN, GRAM_HISTORY_CAPACITY),
  };
  readonly stats: FrameStats = { received: 0, rejected: 0, missed: 0, incompatibleVersion: null };

  /** 1つのバイト列を受け取る。使えたら true */
  receive(data: ArrayBuffer | Uint8Array): boolean {
    const result = decodeFrame(data);
    if (!result.ok) {
      this.stats.rejected++;
      if (result.error.kind === "version") this.stats.incompatibleVersion = result.error.version;
      return false;
    }
    const frame = result.frame;
    this.countMissed(frame.seq);
    this.latest = frame;
    this.stats.received++;

    // 新しいサンプルが届いていないフレームは、同じ値を積み重ねないよう履歴に入れない
    if (!frame.stale) {
      const wave = readWaveform(frame);
      if (wave) this.histories.wave.push(wave.summary);
      const spectrum = readSpectrum(frame);
      if (spectrum) this.histories.gram.push(spectrum.bands);
    }
    return true;
  }

  /** 最新の値と履歴を捨てる（入力源を切り替えたときなど） */
  reset(): void {
    this.latest = null;
    this.histories.wave.clear();
    this.histories.gram.clear();
  }

  private countMissed(seq: number): void {
    const previous = this.latest?.seq;
    if (previous === undefined) return;
    const gap = (seq - previous - 1) >>> 0;
    // 大きく戻ったときは、送出が始め直された（seq が 0 からになった）とみなして数えない
    if (gap < 0x8000_0000) this.stats.missed += gap;
  }
}
