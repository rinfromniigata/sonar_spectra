//! 送出するバイト列の形式
//!
//! 形式を知るのは、送出側（このファイル）と受信側（`src/frame_client/format.ts`）だけ。
//! 形式を変えたら `FORMAT_VERSION` を上げ、受信側も同時に直す。数値はすべてリトルエンディアン。
//!
//! ```text
//! ヘッダ（14バイト）
//!   magic          u16   0x5353（"SS"）
//!   format_version u8    FORMAT_VERSION
//!   flags          u8    FLAG_* の論理和
//!   seq            u32   送るたびに1増える（桁あふれしたら0に戻る）
//!   sample_rate    u32   解析した窓のサンプルレート。0 は「入力源の形式が決まっていない」
//!   section_count  u16   続くセクションの数
//! セクション（section_count 個、6バイト＋ペイロード）
//!   section_id     u8    下の対応表
//!   reserved       u8    0
//!   length         u32   ペイロードのバイト数（f32 の個数×4）
//!   payload        f32 × (length / 4)
//! ```
//!
//! セクションIDとペイロードの対応表（IDの定義は `analysis::SectionId`、並びの詳細は各解析のファイル）：
//!
//! ```text
//!   1  Level     f32 × LEVEL_LEN(4)                       analysis/level.rs
//!   2  Waveform  f32 × WAVE_LEN(5 + 512 × 2)              analysis/waveform.rs
//!   3  Spectrum  f32 × SPECTRUM_LEN(96)                   analysis/spectrum.rs
//!   4  Stereo    f32 × STEREO_LEN(1 + 256 × 2 + 120 × 2)  analysis/stereo.rs
//!   5  Loudness  f32 × LOUDNESS_LEN(3)                    analysis/loudness.rs
//! ```
//!
//! 受信側は、知らない section_id のセクションを length で読み飛ばす。

use crate::analysis::SectionWriter;

/// "SS"
pub const MAGIC: u16 = 0x5353;
/// 形式の版。受信側と食い違ったら、受信側はそのフレームを使わない
pub const FORMAT_VERSION: u8 = 1;
/// ヘッダのバイト数
pub const HEADER_LEN: usize = 14;
/// セクションの見出し（section_id・reserved・length）のバイト数
pub const SECTION_HEADER_LEN: usize = 6;

/// 前回のフレームから新しいサンプルが届いていない（入力源が止まっている・使えない）。
/// 受信側は、このフレームの値を履歴に積まない
pub const FLAG_STALE: u8 = 0b0000_0001;

/// ヘッダのうち、フレームごとに変わる値
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameHeader {
    pub flags: u8,
    pub seq: u32,
    pub sample_rate: u32,
}

/// 解析結果を1つのバイト列に符号化し、`out` の末尾に書く
pub fn encode(header: &FrameHeader, sections: &SectionWriter, out: &mut Vec<u8>) {
    let count = sections.sections().count();
    let payload_bytes: usize = sections.sections().map(|(_, v)| v.len() * 4).sum();
    out.reserve(HEADER_LEN + count * SECTION_HEADER_LEN + payload_bytes);

    out.extend_from_slice(&MAGIC.to_le_bytes());
    out.push(FORMAT_VERSION);
    out.push(header.flags);
    out.extend_from_slice(&header.seq.to_le_bytes());
    out.extend_from_slice(&header.sample_rate.to_le_bytes());
    out.extend_from_slice(&(count as u16).to_le_bytes());

    for (id, values) in sections.sections() {
        out.push(id.as_u8());
        out.push(0);
        out.extend_from_slice(&((values.len() * 4) as u32).to_le_bytes());
        for value in values {
            out.extend_from_slice(&value.to_le_bytes());
        }
    }
}

/// 復元したフレーム（テストで符号化を確かめるため）
#[cfg(test)]
#[derive(Debug, Clone, PartialEq)]
pub struct DecodedFrame {
    pub header: FrameHeader,
    pub sections: Vec<(u8, Vec<f32>)>,
}

#[cfg(test)]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodeError {
    TooShort,
    BadMagic,
    Version(u8),
}

/// バイト列を復元する（受信側と同じ規則。テスト用）
#[cfg(test)]
pub fn decode(bytes: &[u8]) -> Result<DecodedFrame, DecodeError> {
    let u16_at = |i: usize| u16::from_le_bytes([bytes[i], bytes[i + 1]]);
    let u32_at =
        |i: usize| u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);

    if bytes.len() < HEADER_LEN {
        return Err(DecodeError::TooShort);
    }
    if u16_at(0) != MAGIC {
        return Err(DecodeError::BadMagic);
    }
    if bytes[2] != FORMAT_VERSION {
        return Err(DecodeError::Version(bytes[2]));
    }
    let header = FrameHeader {
        flags: bytes[3],
        seq: u32_at(4),
        sample_rate: u32_at(8),
    };
    let count = u16_at(12) as usize;

    let mut offset = HEADER_LEN;
    let mut sections = Vec::with_capacity(count);
    for _ in 0..count {
        if bytes.len() < offset + SECTION_HEADER_LEN {
            return Err(DecodeError::TooShort);
        }
        let id = bytes[offset];
        let length = u32_at(offset + 2) as usize;
        let start = offset + SECTION_HEADER_LEN;
        if bytes.len() < start + length {
            return Err(DecodeError::TooShort);
        }
        let values = bytes[start..start + length]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| f32::from_le_bytes(*b))
            .collect();
        sections.push((id, values));
        offset = start + length;
    }
    Ok(DecodedFrame { header, sections })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::SectionId;

    fn sample_sections() -> SectionWriter {
        let mut w = SectionWriter::new();
        w.begin(SectionId::Level);
        w.extend_from_slice(&[0.5, -1.0]);
        w.end();
        w.begin(SectionId::Waveform);
        w.push(1.5);
        w.end();
        w
    }

    #[test]
    fn encodes_the_documented_layout_byte_by_byte() {
        let header = FrameHeader {
            flags: FLAG_STALE,
            seq: 0x0102_0304,
            sample_rate: 48_000,
        };
        let mut bytes = Vec::new();
        encode(&header, &sample_sections(), &mut bytes);

        let mut expected = vec![
            0x53,
            0x53, // magic
            FORMAT_VERSION,
            FLAG_STALE,
            0x04,
            0x03,
            0x02,
            0x01, // seq
            0x80,
            0xBB,
            0x00,
            0x00, // 48000
            0x02,
            0x00, // section_count
            0x01,
            0x00,
            0x08,
            0x00,
            0x00,
            0x00, // Level, 8 bytes
        ];
        expected.extend_from_slice(&0.5f32.to_le_bytes());
        expected.extend_from_slice(&(-1.0f32).to_le_bytes());
        expected.extend_from_slice(&[0x02, 0x00, 0x04, 0x00, 0x00, 0x00]); // Waveform, 4 bytes
        expected.extend_from_slice(&1.5f32.to_le_bytes());
        assert_eq!(bytes, expected);
        assert_eq!(bytes.len(), HEADER_LEN + 2 * SECTION_HEADER_LEN + 12);
    }

    #[test]
    fn round_trips_through_decode() {
        let header = FrameHeader {
            flags: 0,
            seq: u32::MAX,
            sample_rate: 192_000,
        };
        let mut bytes = Vec::new();
        encode(&header, &sample_sections(), &mut bytes);
        let decoded = decode(&bytes).unwrap();
        assert_eq!(decoded.header, header);
        assert_eq!(decoded.sections, [(1, vec![0.5, -1.0]), (2, vec![1.5])]);
    }

    #[test]
    fn empty_frame_has_only_the_header() {
        let header = FrameHeader {
            flags: FLAG_STALE,
            seq: 7,
            sample_rate: 0,
        };
        let mut bytes = Vec::new();
        encode(&header, &SectionWriter::new(), &mut bytes);
        assert_eq!(bytes.len(), HEADER_LEN);
        assert_eq!(decode(&bytes).unwrap().sections, []);
    }

    #[test]
    fn decode_detects_version_mismatch_and_broken_input() {
        let mut bytes = Vec::new();
        encode(
            &FrameHeader {
                flags: 0,
                seq: 0,
                sample_rate: 48_000,
            },
            &sample_sections(),
            &mut bytes,
        );

        let mut other_version = bytes.clone();
        other_version[2] = FORMAT_VERSION + 1;
        assert_eq!(
            decode(&other_version),
            Err(DecodeError::Version(FORMAT_VERSION + 1))
        );

        let mut bad_magic = bytes.clone();
        bad_magic[0] = 0;
        assert_eq!(decode(&bad_magic), Err(DecodeError::BadMagic));

        assert_eq!(decode(&bytes[..10]), Err(DecodeError::TooShort));
        assert_eq!(
            decode(&bytes[..bytes.len() - 1]),
            Err(DecodeError::TooShort)
        );
    }
}
