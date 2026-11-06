import { describe, expect, it } from "vitest";
import { FLAG_STALE, FORMAT_VERSION, decodeFrame, type AnalysisFrame } from "./format";
import { encodeTestFrame } from "./test_frames";

function decodeOk(data: ArrayBuffer | Uint8Array): AnalysisFrame {
  const result = decodeFrame(data);
  if (!result.ok) throw new Error(`decode failed: ${result.error.kind}`);
  return result.frame;
}

describe("decodeFrame", () => {
  it("Rust の符号化のテストと同じバイト列を復元できる", () => {
    // src-tauri/src/frame_transport/format.rs の encodes_the_documented_layout_byte_by_byte と同じ中身
    const bytes = new Uint8Array([
      0x53, 0x53, FORMAT_VERSION, FLAG_STALE, 0x04, 0x03, 0x02, 0x01, 0x80, 0xbb, 0x00, 0x00, 0x02, 0x00,
      0x01, 0x00, 0x08, 0x00, 0x00, 0x00, ...f32(0.5), ...f32(-1.0),
      0x02, 0x00, 0x04, 0x00, 0x00, 0x00, ...f32(1.5),
    ]);
    const frame = decodeOk(bytes.buffer);
    expect(frame.seq).toBe(0x01020304);
    expect(frame.sampleRate).toBe(48_000);
    expect(frame.stale).toBe(true);
    expect(Array.from(frame.sections.get(1)!)).toEqual([0.5, -1.0]);
    expect(Array.from(frame.sections.get(2)!)).toEqual([1.5]);
  });

  it("4バイト境界にそろったセクションはコピーせず、そろっていないセクションはコピーする", () => {
    const bytes = encodeTestFrame({ sections: [[1, [1, 2, 3]], [2, [4, 5]]] });
    const frame = decodeOk(bytes.buffer);
    const first = frame.sections.get(1)!;
    const second = frame.sections.get(2)!;
    // 1つ目は20バイト目から：受け取ったバッファのビュー
    expect(first.buffer).toBe(bytes.buffer);
    expect(first.byteOffset).toBe(20);
    // 2つ目は38バイト目から（4の倍数でない）：コピー
    expect(second.buffer).not.toBe(bytes.buffer);
    expect(Array.from(first)).toEqual([1, 2, 3]);
    expect(Array.from(second)).toEqual([4, 5]);
  });

  it("途中から始まる Uint8Array でも読める", () => {
    const inner = encodeTestFrame({ seq: 9, sections: [[1, [0.25, 0.75]]] });
    const outer = new Uint8Array(inner.length + 3);
    outer.set(inner, 3);
    const frame = decodeOk(outer.subarray(3));
    expect(frame.seq).toBe(9);
    expect(Array.from(frame.sections.get(1)!)).toEqual([0.25, 0.75]);
  });

  it("セクションのないフレーム", () => {
    const frame = decodeOk(encodeTestFrame({ sampleRate: 0, flags: FLAG_STALE }));
    expect(frame.sampleRate).toBe(0);
    expect(frame.sections.size).toBe(0);
  });

  it("知らない section_id も読み飛ばさずに入る（使う側が無視する）", () => {
    const frame = decodeOk(encodeTestFrame({ sections: [[200, [7]], [1, [8]]] }));
    expect(Array.from(frame.sections.get(200)!)).toEqual([7]);
    expect(Array.from(frame.sections.get(1)!)).toEqual([8]);
  });

  it("形式の版の食い違いを検出する", () => {
    const result = decodeFrame(encodeTestFrame({ version: FORMAT_VERSION + 1 }));
    expect(result).toEqual({ ok: false, error: { kind: "version", version: FORMAT_VERSION + 1 } });
  });

  it("壊れたバイト列を受け付けない", () => {
    const good = encodeTestFrame({ sections: [[1, [1, 2]]] });
    expect(decodeFrame(good.subarray(0, 10))).toEqual({ ok: false, error: { kind: "too_short" } });
    expect(decodeFrame(good.subarray(0, good.length - 1))).toEqual({ ok: false, error: { kind: "too_short" } });

    const badMagic = good.slice();
    badMagic[0] = 0;
    expect(decodeFrame(badMagic)).toEqual({ ok: false, error: { kind: "bad_magic" } });

    const oddLength = good.slice();
    new DataView(oddLength.buffer).setUint32(16, 7, true);
    expect(decodeFrame(oddLength)).toEqual({ ok: false, error: { kind: "malformed" } });
  });
});

function f32(value: number): number[] {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setFloat32(0, value, true);
  return Array.from(bytes);
}
