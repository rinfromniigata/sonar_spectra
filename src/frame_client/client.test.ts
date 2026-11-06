import { describe, expect, it } from "vitest";
import { FrameClient } from "./client";
import { FLAG_STALE, FORMAT_VERSION } from "./format";
import {
  LEVEL_LEN,
  SPECTRUM_LEN,
  SectionId,
  WAVE_LEN,
  WAVE_NOW_POINTS,
  WAVE_SUMMARY_LEN,
  readLevel,
  readWaveform,
} from "./sections";
import { encodeTestFrame } from "./test_frames";

/** 要約が [env, env, low, mid, high]、今の波形の L が全部 nowL、R が全部 nowR の波形のペイロード */
function wavePayload(env: number, nowL = 0, nowR = 0): number[] {
  return [env, env, 0.1, 0.2, 0.3, ...Array(WAVE_NOW_POINTS).fill(nowL), ...Array(WAVE_NOW_POINTS).fill(nowR)];
}

function frame(seq: number, env: number, flags = 0): Uint8Array {
  return encodeTestFrame({
    seq,
    flags,
    sections: [
      [SectionId.Level, [0.5, 0.25, 0.35, 0.18]],
      [SectionId.Waveform, wavePayload(env, 0.4, -0.4)],
    ],
  });
}

describe("FrameClient", () => {
  it("最新の値を保持し、レベルと波形を型つきで読める", () => {
    const client = new FrameClient();
    expect(client.receive(frame(0, 0.9))).toBe(true);

    const latest = client.latest!;
    expect(readLevel(latest)).toEqual({ peakL: 0.5, peakR: 0.25, rmsL: expect.closeTo(0.35, 6), rmsR: expect.closeTo(0.18, 6) });
    const wave = readWaveform(latest)!;
    expect(wave.summary.length).toBe(WAVE_SUMMARY_LEN);
    expect(wave.nowL.length).toBe(WAVE_NOW_POINTS);
    expect(wave.nowR.length).toBe(WAVE_NOW_POINTS);
    expect(wave.nowL[0]).toBeCloseTo(0.4, 6);
    expect(wave.nowR[WAVE_NOW_POINTS - 1]).toBeCloseTo(-0.4, 6);
  });

  it("波形の要約を履歴に積む。STALE のフレームは積まない", () => {
    const client = new FrameClient();
    client.receive(frame(0, 0.1));
    client.receive(frame(1, 0.2));
    client.receive(frame(2, 0.3, FLAG_STALE));

    const wave = client.histories.wave;
    expect(wave.length).toBe(2);
    expect(wave.row(0)[0]).toBeCloseTo(0.1, 6);
    expect(wave.latest()![0]).toBeCloseTo(0.2, 6);
    // STALE でも最新の値は更新する
    expect(client.latest!.seq).toBe(2);
    expect(client.latest!.stale).toBe(true);
  });

  it("スペクトラムを履歴（スペクトログラム用）に積む。STALE のフレームと、スペクトラムのないフレームは積まない", () => {
    const client = new FrameClient();
    const spectrum = (seq: number, level: number, flags = 0) =>
      encodeTestFrame({ seq, flags, sections: [[SectionId.Spectrum, Array(SPECTRUM_LEN).fill(level)]] });
    client.receive(spectrum(0, 0.1));
    client.receive(spectrum(1, 0.2));
    client.receive(spectrum(2, 0.3, FLAG_STALE));
    client.receive(frame(3, 0.5)); // スペクトラムのセクションがない

    const gram = client.histories.gram;
    expect(gram.width).toBe(SPECTRUM_LEN);
    expect(gram.length).toBe(2);
    expect(gram.row(0)[0]).toBeCloseTo(0.1, 6);
    expect(gram.row(1)[SPECTRUM_LEN - 1]).toBeCloseTo(0.2, 6);
    // 波形の履歴とは別に積む
    expect(client.histories.wave.length).toBe(1);
  });

  it("長さの合わないスペクトラムは履歴に積まない", () => {
    const client = new FrameClient();
    client.receive(encodeTestFrame({ sections: [[SectionId.Spectrum, Array(SPECTRUM_LEN + 1).fill(1)]] }));
    expect(client.histories.gram.length).toBe(0);
  });

  it("seq の飛びを数え、送出の始め直し（0 に戻る）は数えない", () => {
    const client = new FrameClient();
    client.receive(frame(10, 0));
    client.receive(frame(11, 0));
    client.receive(frame(14, 0));
    expect(client.stats.missed).toBe(2);
    client.receive(frame(0, 0));
    expect(client.stats.missed).toBe(2);
    // 桁あふれをまたいでも続きとみなす
    client.receive(frame(0xffff_ffff, 0));
    client.receive(frame(0, 0));
    expect(client.stats.missed).toBe(2);
    expect(client.stats.received).toBe(6);
  });

  it("版の食い違いと壊れたフレームは使わず、記録する", () => {
    const client = new FrameClient();
    client.receive(frame(0, 0.5));
    expect(client.receive(encodeTestFrame({ version: FORMAT_VERSION + 1 }))).toBe(false);
    expect(client.receive(new Uint8Array(3))).toBe(false);

    expect(client.stats.rejected).toBe(2);
    expect(client.stats.incompatibleVersion).toBe(FORMAT_VERSION + 1);
    // 直前の使えたフレームが残る
    expect(client.latest!.seq).toBe(0);
    expect(client.histories.wave.length).toBe(1);
  });

  it("長さの合わないセクションは読まない", () => {
    const client = new FrameClient();
    client.receive(
      encodeTestFrame({
        sections: [
          [SectionId.Level, Array(LEVEL_LEN + 1).fill(0)],
          [SectionId.Waveform, Array(WAVE_LEN - 1).fill(0)],
        ],
      }),
    );
    expect(readLevel(client.latest!)).toBeNull();
    expect(readWaveform(client.latest!)).toBeNull();
    expect(client.histories.wave.length).toBe(0);
  });

  it("reset で最新の値と履歴を捨てる", () => {
    const client = new FrameClient();
    client.receive(frame(0, 0.5));
    client.receive(encodeTestFrame({ seq: 1, sections: [[SectionId.Spectrum, Array(SPECTRUM_LEN).fill(1)]] }));
    client.reset();
    expect(client.latest).toBeNull();
    expect(client.histories.wave.length).toBe(0);
    expect(client.histories.gram.length).toBe(0);
  });
});
