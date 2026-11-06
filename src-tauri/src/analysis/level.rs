//! レベル
//!
//! セクション `Level` のペイロード（f32 × 4）：
//!
//! ```text
//! [0] peak_l  [1] peak_r  [2] rms_l  [3] rms_r
//! ```
//!
//! 前回の解析から新しく届いたフレームのピークと RMS。線形の振幅で、1.0 がフルスケール。
//! dB への換算と、ピークの保持・減衰は UI 側で行う。

use super::{AnalysisContext, Analyzer, SectionId, SectionWriter, StereoWindow};

/// ペイロードの長さ
pub const LEVEL_LEN: usize = 4;

/// レベルの解析
#[derive(Debug, Default)]
pub struct LevelAnalyzer;

impl LevelAnalyzer {
    pub fn new() -> Self {
        Self
    }
}

pub(crate) fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0, |acc, s| acc.max(s.abs()))
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples.iter().map(|s| f64::from(*s) * f64::from(*s)).sum();
    (sum / samples.len() as f64).sqrt() as f32
}

impl Analyzer for LevelAnalyzer {
    fn id(&self) -> SectionId {
        SectionId::Level
    }

    fn window_frames(&self, sample_rate: u32) -> usize {
        // 解析が少し遅れても届いた分を取りこぼさないよう、約0.1秒分を見られるようにする
        (sample_rate / 10) as usize
    }

    fn process(&mut self, window: &StereoWindow, _ctx: &AnalysisContext, out: &mut SectionWriter) {
        let (left, right) = window.recent();
        out.extend_from_slice(&[peak(left), peak(right), rms(left), rms(right)]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::test_signal::{run_one, silence, sine};

    const RATE: u32 = 48_000;

    #[test]
    fn silence_gives_zero() {
        let z = silence(4_800);
        let out = run_one(&mut LevelAnalyzer::new(), &z, &z, RATE, 800);
        assert_eq!(out, [0.0; LEVEL_LEN]);
    }

    #[test]
    fn known_amplitude_sine_gives_its_peak_and_rms() {
        let s = sine(1_000.0, 0.5, RATE, 4_800);
        let out = run_one(&mut LevelAnalyzer::new(), &s, &s, RATE, 800);
        assert!((out[0] - 0.5).abs() < 1e-3, "peak {}", out[0]);
        assert!((out[2] - 0.5 / 2f32.sqrt()).abs() < 1e-3, "rms {}", out[2]);
        assert_eq!(out[0], out[1]);
        assert_eq!(out[2], out[3]);
    }

    #[test]
    fn left_only_sine_moves_only_left() {
        let s = sine(440.0, 0.8, RATE, 4_800);
        let z = silence(4_800);
        let out = run_one(&mut LevelAnalyzer::new(), &s, &z, RATE, 800);
        assert!(out[0] > 0.79 && out[2] > 0.5);
        assert_eq!(out[1], 0.0);
        assert_eq!(out[3], 0.0);
    }

    #[test]
    fn only_new_frames_count() {
        // 古い側に大きな音、新しく届いた800フレームは無音
        let mut l = sine(1_000.0, 1.0, RATE, 4_000);
        l.extend(silence(800));
        let out = run_one(&mut LevelAnalyzer::new(), &l, &l, RATE, 800);
        assert_eq!(out, [0.0; LEVEL_LEN]);
    }
}
