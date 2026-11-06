// 送出と受信で共有するテスト用データ（src-tauri/src/frame_transport/fixtures/frame_format_v1.json）を、
// 受信側で検査する。送出側（src-tauri/src/frame_transport/shared_fixture.rs）は同じデータで
// 「値を符号化するとバイト列になる」を、こちらは「バイト列を復元すると値になる」を確かめる。
import { describe, expect, it } from "vitest";
import fixture from "../../src-tauri/src/frame_transport/fixtures/frame_format_v1.json";
import { FrameClient } from "./client";
import { FLAG_STALE, FORMAT_VERSION, decodeFrame, type AnalysisFrame } from "./format";
import { LEVEL_LEN, SectionId, WAVE_LEN, WAVE_SUMMARY_LEN, readLevel, readWaveform } from "./sections";

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function decodeOk(bytes: Uint8Array<ArrayBuffer>): AnalysisFrame {
  const result = decodeFrame(bytes.buffer);
  if (!result.ok) throw new Error(`decode failed: ${result.error.kind}`);
  return result.frame;
}

const analysisFrame = fixture.frames[0];
const sectionValues = (id: number) => analysisFrame.sections.find((s) => s.id === id)!.values;

describe("共有のテスト用データ（受信側）", () => {
  it("データの形式の版が、受信側の FORMAT_VERSION と同じ", () => {
    expect(fixture.format_version).toBe(FORMAT_VERSION);
  });

  it.each(fixture.frames.map((f) => [f.name, f] as const))("%s：復元したヘッダが一致する", (_name, frame) => {
    const decoded = decodeOk(fromHex(frame.bytes_hex));
    expect(decoded.seq).toBe(frame.seq);
    expect(decoded.sampleRate).toBe(frame.sample_rate);
    expect(decoded.flags).toBe(frame.flags);
    expect(decoded.stale).toBe((frame.flags & FLAG_STALE) !== 0);
  });

  it.each(fixture.frames.map((f) => [f.name, f] as const))("%s：復元したセクションの値が、f32 として厳密に一致する", (_name, frame) => {
    const decoded = decodeOk(fromHex(frame.bytes_hex));
    expect([...decoded.sections.keys()]).toEqual(frame.sections.map((s) => s.id));
    for (const section of frame.sections) {
      const values = decoded.sections.get(section.id)!;
      expect(values.length).toBe(section.values.length);
      const mismatches = section.values.flatMap((v, i) => (values[i] === Math.fround(v) ? [] : [i]));
      expect(mismatches, `section ${section.id}`).toEqual([]);
    }
  });

  it("両側の対応表がそろっている（セクションIDとペイロードの長さ）", () => {
    expect(sectionValues(SectionId.Level)).toHaveLength(LEVEL_LEN);
    expect(sectionValues(SectionId.Waveform)).toHaveLength(WAVE_LEN);
    const decoded = decodeOk(fromHex(analysisFrame.bytes_hex));
    expect(readLevel(decoded)).not.toBeNull();
    expect(readWaveform(decoded)).not.toBeNull();
  });

  it("4バイト境界にそろったセクション（レベル）はビュー、そろっていないセクション（波形）はコピーで読み、どちらも同じ値になる", () => {
    const bytes = fromHex(analysisFrame.bytes_hex);
    const decoded = decodeOk(bytes);
    const level = decoded.sections.get(SectionId.Level)!;
    const wave = decoded.sections.get(SectionId.Waveform)!;
    expect(level.buffer).toBe(bytes.buffer);
    expect(wave.buffer).not.toBe(bytes.buffer);
    expect(readLevel(decoded)!.peakL).toBe(Math.fround(sectionValues(SectionId.Level)[0]));
  });

  it("受信（FrameClient）を通すと、波形の要約が履歴に積まれ、知らないセクションは無視される", () => {
    const client = new FrameClient();
    expect(client.receive(fromHex(analysisFrame.bytes_hex))).toBe(true);
    const expected = sectionValues(SectionId.Waveform).slice(0, WAVE_SUMMARY_LEN).map(Math.fround);
    expect(Array.from(client.histories.wave.latest()!)).toEqual(expected);
    expect(client.latest!.sections.has(200)).toBe(true);

    // STALE の空のフレームは、最新の値にはなるが、履歴には積まない
    expect(client.receive(fromHex(fixture.frames[1].bytes_hex))).toBe(true);
    expect(client.histories.wave.length).toBe(1);
  });

  it.each(fixture.frames.map((f) => [f.name, f] as const))("%s：形式の版を変えたバイト列は受け付けず、食い違いを記録する", (_name, frame) => {
    const bytes = fromHex(frame.bytes_hex);
    bytes[2] = FORMAT_VERSION + 1;
    expect(decodeFrame(bytes.buffer)).toEqual({ ok: false, error: { kind: "version", version: FORMAT_VERSION + 1 } });

    const client = new FrameClient();
    expect(client.receive(bytes)).toBe(false);
    expect(client.stats.incompatibleVersion).toBe(FORMAT_VERSION + 1);
    expect(client.latest).toBeNull();
  });
});
