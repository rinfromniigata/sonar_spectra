//! 送出と受信で共有するテスト用データ（`fixtures/frame_format_v1.json`）
//!
//! 同じデータを、送出側（このファイル）は「値を符号化するとバイト列になる」、受信側
//! （`src/frame_client/shared_fixture.test.ts`）は「バイト列を復元すると値になる」で検査する。
//! 形式を変えたら `FORMAT_VERSION` を上げ、環境変数 `SONAR_UPDATE_FIXTURE=1` を付けて次のテストを
//! 実行してデータを作り直し、受信側も合わせる（環境変数がなければ、何も書かずに終わる。実機用のテストを
//! `-- --ignored` でまとめて実行したときに、データを書き換えないため）。
//!
//! ```text
//! SONAR_UPDATE_FIXTURE=1 cargo test --manifest-path src-tauri/Cargo.toml regenerate_shared_fixture -- --ignored
//! ```

use serde::{Deserialize, Serialize};

use super::format::{FLAG_STALE, FORMAT_VERSION, FrameHeader, decode, encode};
use crate::analysis::test_signal::{sine, stereo_window_with_new};
use crate::analysis::{Pipeline, SectionId, SectionWriter};

const FIXTURE_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/src/frame_transport/fixtures/frame_format_v1.json"
);

#[derive(Debug, Serialize, Deserialize)]
struct Fixture {
    /// このデータの形式の版（`FORMAT_VERSION` と同じ）
    format_version: u8,
    frames: Vec<FixtureFrame>,
}

#[derive(Debug, Serialize, Deserialize)]
struct FixtureFrame {
    /// 何を確かめるためのフレームか
    name: String,
    flags: u8,
    seq: u32,
    sample_rate: u32,
    sections: Vec<FixtureSection>,
    /// 符号化したバイト列（16進）
    bytes_hex: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct FixtureSection {
    id: u8,
    values: Vec<f32>,
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn from_hex(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("valid hex"))
        .collect()
}

/// 既知のIDのセクションだけを SectionWriter に入れる（知らないIDは `encode_fixture_frame` が後ろに足す）
fn writer_from(sections: &[FixtureSection]) -> SectionWriter {
    let mut writer = SectionWriter::new();
    for section in sections {
        if let Some(id) = SectionId::from_u8(section.id) {
            writer.begin(id);
            writer.extend_from_slice(&section.values);
            writer.end();
        }
    }
    writer
}

/// フレームを符号化する。知らない section_id のセクションは、形式どおりに末尾へ足す
fn encode_fixture_frame(frame: &FixtureFrame) -> Vec<u8> {
    let header = FrameHeader {
        flags: frame.flags,
        seq: frame.seq,
        sample_rate: frame.sample_rate,
    };
    let mut bytes = Vec::new();
    encode(&header, &writer_from(&frame.sections), &mut bytes);
    let unknown: Vec<&FixtureSection> = frame
        .sections
        .iter()
        .filter(|s| SectionId::from_u8(s.id).is_none())
        .collect();
    if !unknown.is_empty() {
        let count = u16::from_le_bytes([bytes[12], bytes[13]]) + unknown.len() as u16;
        bytes[12..14].copy_from_slice(&count.to_le_bytes());
        for section in unknown {
            bytes.push(section.id);
            bytes.push(0);
            bytes.extend_from_slice(&((section.values.len() * 4) as u32).to_le_bytes());
            for v in &section.values {
                bytes.extend_from_slice(&v.to_le_bytes());
            }
        }
    }
    bytes
}

/// 実際の解析の結果（L に 1 kHz・0.5、R に 3 kHz・0.25 の正弦波）
fn analysis_sections() -> Vec<FixtureSection> {
    let rate = 48_000;
    let mut pipeline = Pipeline::default();
    let frames = pipeline.window_frames(rate);
    let left = sine(1_000.0, 0.5, rate, frames);
    let right = sine(3_000.0, 0.25, rate, frames);
    let window = stereo_window_with_new(&left, &right, rate, 800);
    let mut writer = SectionWriter::new();
    pipeline.process(&window, &mut writer);
    writer
        .sections()
        .map(|(id, values)| FixtureSection {
            id: id.as_u8(),
            values: values.to_vec(),
        })
        .collect()
}

fn build_fixture() -> Fixture {
    let mut sections = analysis_sections();
    // 受信側が読み飛ばすことを確かめる、知らない section_id
    sections.push(FixtureSection {
        id: 200,
        values: vec![1.0, -2.0, 0.5],
    });
    let mut frames = vec![
        FixtureFrame {
            name: "analysis: all sections from sines, plus an unknown section".into(),
            flags: 0,
            seq: 0x0102_0304,
            sample_rate: 48_000,
            sections,
            bytes_hex: String::new(),
        },
        FixtureFrame {
            name: "stale: no source format yet, no sections".into(),
            flags: FLAG_STALE,
            seq: u32::MAX,
            sample_rate: 0,
            sections: Vec::new(),
            bytes_hex: String::new(),
        },
    ];
    for frame in &mut frames {
        frame.bytes_hex = to_hex(&encode_fixture_frame(frame));
    }
    Fixture {
        format_version: FORMAT_VERSION,
        frames,
    }
}

fn load_fixture() -> Fixture {
    let text = std::fs::read_to_string(FIXTURE_PATH).expect("shared fixture exists");
    serde_json::from_str(&text).expect("shared fixture is valid")
}

#[test]
#[ignore = "共有のテスト用データを作り直すときだけ実行する"]
fn regenerate_shared_fixture() {
    if std::env::var("SONAR_UPDATE_FIXTURE").as_deref() != Ok("1") {
        eprintln!("SONAR_UPDATE_FIXTURE=1 がないので、共有のテスト用データは作り直さない");
        return;
    }
    let text = serde_json::to_string_pretty(&build_fixture()).unwrap();
    std::fs::write(FIXTURE_PATH, text + "\n").unwrap();
}

#[test]
fn fixture_is_for_the_current_format_version() {
    assert_eq!(load_fixture().format_version, FORMAT_VERSION);
}

#[test]
fn encoding_the_fixture_values_gives_the_fixture_bytes() {
    for frame in load_fixture().frames {
        assert_eq!(
            to_hex(&encode_fixture_frame(&frame)),
            frame.bytes_hex,
            "frame: {}",
            frame.name
        );
    }
}

#[test]
fn decoding_the_fixture_bytes_gives_the_fixture_values() {
    for frame in load_fixture().frames {
        let decoded = decode(&from_hex(&frame.bytes_hex)).expect("fixture decodes");
        assert_eq!(
            decoded.header,
            FrameHeader {
                flags: frame.flags,
                seq: frame.seq,
                sample_rate: frame.sample_rate
            },
            "frame: {}",
            frame.name
        );
        let expected: Vec<(u8, Vec<f32>)> = frame
            .sections
            .iter()
            .map(|s| (s.id, s.values.clone()))
            .collect();
        assert_eq!(decoded.sections, expected, "frame: {}", frame.name);
    }
}

#[test]
fn fixture_bytes_with_another_version_are_rejected() {
    use super::format::DecodeError;
    for frame in load_fixture().frames {
        let mut bytes = from_hex(&frame.bytes_hex);
        bytes[2] = FORMAT_VERSION.wrapping_add(1);
        assert_eq!(
            decode(&bytes),
            Err(DecodeError::Version(FORMAT_VERSION.wrapping_add(1)))
        );
    }
}
