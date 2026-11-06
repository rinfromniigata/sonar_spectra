// 単体テスト用：送出側（Rust の frame_transport::format::encode）と同じ並びでバイト列を作る。

import { FORMAT_VERSION, HEADER_LEN, MAGIC, SECTION_HEADER_LEN } from "./format";

export interface TestFrame {
  seq?: number;
  sampleRate?: number;
  flags?: number;
  version?: number;
  sections?: [number, number[]][];
}

export function encodeTestFrame(frame: TestFrame): Uint8Array<ArrayBuffer> {
  const sections = frame.sections ?? [];
  const size = HEADER_LEN + sections.reduce((sum, [, v]) => sum + SECTION_HEADER_LEN + v.length * 4, 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, MAGIC, true);
  view.setUint8(2, frame.version ?? FORMAT_VERSION);
  view.setUint8(3, frame.flags ?? 0);
  view.setUint32(4, frame.seq ?? 0, true);
  view.setUint32(8, frame.sampleRate ?? 48_000, true);
  view.setUint16(12, sections.length, true);
  let offset = HEADER_LEN;
  for (const [id, values] of sections) {
    view.setUint8(offset, id);
    view.setUint8(offset + 1, 0);
    view.setUint32(offset + 2, values.length * 4, true);
    offset += SECTION_HEADER_LEN;
    for (const v of values) {
      view.setFloat32(offset, v, true);
      offset += 4;
    }
  }
  return bytes;
}
