// 受信するバイト列の形式。送出側（src-tauri/src/frame_transport/format.rs）と対になる。
// 形式を変えたら、両方の FORMAT_VERSION を上げて同時に直す。数値はすべてリトルエンディアン。
//
// ヘッダ（14バイト）: magic u16 / format_version u8 / flags u8 / seq u32 / sample_rate u32 / section_count u16
// セクション（6バイト＋ペイロード）: section_id u8 / reserved u8 / length u32（ペイロードのバイト数） / f32 の並び

/** "SS" */
export const MAGIC = 0x5353;
/** 形式の版。食い違ったフレームは使わない */
export const FORMAT_VERSION = 1;
export const HEADER_LEN = 14;
export const SECTION_HEADER_LEN = 6;

/** 前回のフレームから新しいサンプルが届いていない（入力源が止まっている・使えない）。履歴に積まない */
export const FLAG_STALE = 0b0000_0001;

/** 1回分の解析結果 */
export interface AnalysisFrame {
  seq: number;
  /** 0 は「入力源の形式が決まっていない」 */
  sampleRate: number;
  flags: number;
  stale: boolean;
  /** section_id → ペイロード。知らない section_id もそのまま入る */
  sections: Map<number, Float32Array>;
}

export type DecodeError =
  | { kind: "too_short" }
  | { kind: "bad_magic" }
  | { kind: "version"; version: number }
  | { kind: "malformed" };

export type DecodeResult = { ok: true; frame: AnalysisFrame } | { ok: false; error: DecodeError };

/** この環境がリトルエンディアンか（Float32Array のビューをそのまま使えるか） */
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * ペイロードを Float32Array にする。4バイト境界にそろっていればコピーせずにビューを作り、
 * そろっていなければ（6バイトの見出しの後ろに来るセクション）DataView で読んでコピーする。
 */
function payloadView(view: DataView, start: number, byteLength: number): Float32Array {
  const count = byteLength / 4;
  const absolute = view.byteOffset + start;
  if (LITTLE_ENDIAN && absolute % 4 === 0) {
    return new Float32Array(view.buffer, absolute, count);
  }
  const values = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    values[i] = view.getFloat32(start + i * 4, true);
  }
  return values;
}

/**
 * バイト列を解析結果に戻す。返す Float32Array は受け取ったバッファを指すことがあるので、
 * バッファを書き換えないこと（Channel から届くバッファは1回ごとに新しい）。
 */
export function decodeFrame(data: ArrayBuffer | Uint8Array): DecodeResult {
  const view =
    data instanceof Uint8Array ? new DataView(data.buffer, data.byteOffset, data.byteLength) : new DataView(data);

  if (view.byteLength < HEADER_LEN) return { ok: false, error: { kind: "too_short" } };
  if (view.getUint16(0, true) !== MAGIC) return { ok: false, error: { kind: "bad_magic" } };
  const version = view.getUint8(2);
  if (version !== FORMAT_VERSION) return { ok: false, error: { kind: "version", version } };

  const flags = view.getUint8(3);
  const seq = view.getUint32(4, true);
  const sampleRate = view.getUint32(8, true);
  const count = view.getUint16(12, true);

  const sections = new Map<number, Float32Array>();
  let offset = HEADER_LEN;
  for (let i = 0; i < count; i++) {
    if (view.byteLength < offset + SECTION_HEADER_LEN) return { ok: false, error: { kind: "too_short" } };
    const id = view.getUint8(offset);
    const length = view.getUint32(offset + 2, true);
    const start = offset + SECTION_HEADER_LEN;
    if (length % 4 !== 0) return { ok: false, error: { kind: "malformed" } };
    if (view.byteLength < start + length) return { ok: false, error: { kind: "too_short" } };
    sections.set(id, payloadView(view, start, length));
    offset = start + length;
  }

  return {
    ok: true,
    frame: { seq, sampleRate, flags, stale: (flags & FLAG_STALE) !== 0, sections },
  };
}
