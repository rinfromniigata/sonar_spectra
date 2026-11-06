//! 波形：履歴用の要約と、今の波形
//!
//! セクション `Waveform` のペイロード（f32 × `WAVE_LEN`）：
//!
//! ```text
//! [0] env_l    [1] env_r                     前回の解析から新しく届いたフレームのピーク（履歴の1列分）
//! [2] band_low [3] band_mid [4] band_high    帯域ごとの振幅（履歴の帯域別の色に使う）
//! [5 .. 5+N)       今の波形 L（直近 WAVE_NOW_SECONDS 秒を N 点に、古い順）
//! [5+N .. 5+2N)    今の波形 R
//! ```
//!
//! N は `WAVE_NOW_POINTS`。値は線形の振幅で、1.0 がフルスケール。
//! 帯域の振幅は、L・R それぞれのエネルギーの平均から求める。L と R に同じ振幅 A の正弦波が1つだけあれば A、
//! 片側だけなら A/√2 になる。逆位相（L = −R）でも打ち消し合わない（`AnalysisContext::band_amplitude`）。
//! 履歴の保持（何列分ためるか）は、受信側（frame_client）で行う。

use super::level::peak;
use super::{AnalysisContext, Analyzer, SectionId, SectionWriter, StereoWindow};

/// 今の波形の点数
pub const WAVE_NOW_POINTS: usize = 512;
/// 今の波形が表す時間（秒）
pub const WAVE_NOW_SECONDS: f64 = 0.02;
/// 履歴用の要約の長さ
pub const WAVE_SUMMARY_LEN: usize = 5;
/// ペイロードの長さ
pub const WAVE_LEN: usize = WAVE_SUMMARY_LEN + 2 * WAVE_NOW_POINTS;

/// 低域の上限（Hz）
pub const BAND_LOW_MAX_HZ: f32 = 250.0;
/// 中域の上限（Hz）
pub const BAND_MID_MAX_HZ: f32 = 4_000.0;
/// 高域の上限（Hz）。可聴域の外は数えない
pub const BAND_HIGH_MAX_HZ: f32 = 20_000.0;

/// 波形の解析
#[derive(Debug, Default)]
pub struct WaveformAnalyzer;

impl WaveformAnalyzer {
    pub fn new() -> Self {
        Self
    }
}

fn now_frames(sample_rate: u32) -> usize {
    ((f64::from(sample_rate) * WAVE_NOW_SECONDS).round() as usize).max(1)
}

/// `samples` を `WAVE_NOW_POINTS` 点にまとめて `out` に書く
///
/// 1点に複数のサンプルが入るときは平均する（細かい折り返しを防ぐ）。
/// サンプルが点より少ないときは、近いサンプルをそのまま使う。
fn write_points(samples: &[f32], out: &mut SectionWriter) {
    let n = samples.len();
    if n == 0 {
        for _ in 0..WAVE_NOW_POINTS {
            out.push(0.0);
        }
        return;
    }
    for i in 0..WAVE_NOW_POINTS {
        let start = i * n / WAVE_NOW_POINTS;
        let end = ((i + 1) * n / WAVE_NOW_POINTS).max(start + 1).min(n);
        let bucket = &samples[start..end];
        out.push(bucket.iter().sum::<f32>() / bucket.len() as f32);
    }
}

impl Analyzer for WaveformAnalyzer {
    fn id(&self) -> SectionId {
        SectionId::Waveform
    }

    fn uses_fft(&self) -> bool {
        true
    }

    fn window_frames(&self, sample_rate: u32) -> usize {
        now_frames(sample_rate)
    }

    fn process(&mut self, window: &StereoWindow, ctx: &AnalysisContext, out: &mut SectionWriter) {
        let (recent_l, recent_r) = window.recent();
        out.extend_from_slice(&[
            peak(recent_l),
            peak(recent_r),
            ctx.band_amplitude(0.0, BAND_LOW_MAX_HZ),
            ctx.band_amplitude(BAND_LOW_MAX_HZ, BAND_MID_MAX_HZ),
            ctx.band_amplitude(BAND_MID_MAX_HZ, BAND_HIGH_MAX_HZ),
        ]);

        let (now_l, now_r) = window.latest(now_frames(window.sample_rate()));
        write_points(now_l, out);
        write_points(now_r, out);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::test_signal::{run_one, silence, sine};

    const RATE: u32 = 48_000;
    const LEN: usize = 4_800;

    fn bands(out: &[f32]) -> [f32; 3] {
        [out[2], out[3], out[4]]
    }

    #[test]
    fn payload_has_the_documented_length() {
        let s = sine(1_000.0, 0.5, RATE, LEN);
        let out = run_one(&mut WaveformAnalyzer::new(), &s, &s, RATE, 800);
        assert_eq!(out.len(), WAVE_LEN);
    }

    #[test]
    fn silence_gives_zero() {
        let z = silence(LEN);
        let out = run_one(&mut WaveformAnalyzer::new(), &z, &z, RATE, 800);
        assert!(out.iter().all(|v| *v == 0.0));
    }

    #[test]
    fn left_only_sine_moves_only_left() {
        let s = sine(440.0, 0.8, RATE, LEN);
        let z = silence(LEN);
        let out = run_one(&mut WaveformAnalyzer::new(), &s, &z, RATE, 800);

        assert!(out[0] > 0.79, "env_l {}", out[0]);
        assert_eq!(out[1], 0.0);
        let now_l = &out[WAVE_SUMMARY_LEN..WAVE_SUMMARY_LEN + WAVE_NOW_POINTS];
        let now_r = &out[WAVE_SUMMARY_LEN + WAVE_NOW_POINTS..];
        assert!(now_l.iter().any(|v| v.abs() > 0.5));
        assert!(now_r.iter().all(|v| *v == 0.0));
    }

    #[test]
    fn bands_separate_low_mid_and_high_sines() {
        let amp = 0.5;
        for (hz, expected) in [(100.0, 0), (1_000.0, 1), (8_000.0, 2)] {
            let s = sine(hz, amp, RATE, LEN);
            let out = run_one(&mut WaveformAnalyzer::new(), &s, &s, RATE, 800);
            let b = bands(&out);
            assert!(
                (b[expected] - amp).abs() < 0.05 * amp,
                "{hz} Hz: band {expected} = {}",
                b[expected]
            );
            for (i, v) in b.iter().enumerate() {
                if i != expected {
                    assert!(*v < 0.05 * amp, "{hz} Hz leaked into band {i}: {v}");
                }
            }
        }
    }

    #[test]
    fn now_waveform_covers_the_latest_20ms_in_order() {
        // 直線的に増える信号：点も古い順に増え、最後の点は最新のサンプルに近い
        let ramp: Vec<f32> = (0..LEN).map(|n| n as f32 / LEN as f32).collect();
        let out = run_one(&mut WaveformAnalyzer::new(), &ramp, &ramp, RATE, 800);
        let now_l = &out[WAVE_SUMMARY_LEN..WAVE_SUMMARY_LEN + WAVE_NOW_POINTS];
        assert!(now_l.windows(2).all(|p| p[1] >= p[0]));
        let first_expected = (LEN - now_frames(RATE)) as f32 / LEN as f32;
        assert!((now_l[0] - first_expected).abs() < 1e-3);
        assert!((now_l[WAVE_NOW_POINTS - 1] - 1.0).abs() < 1e-3);
    }

    #[test]
    fn points_are_filled_even_when_samples_are_fewer() {
        let mut w = SectionWriter::new();
        w.begin(SectionId::Waveform);
        write_points(&[0.25, 0.75], &mut w);
        write_points(&[], &mut w);
        w.end();
        let v = w.section(SectionId::Waveform).unwrap();
        assert_eq!(v.len(), 2 * WAVE_NOW_POINTS);
        assert_eq!(v[0], 0.25);
        assert_eq!(v[WAVE_NOW_POINTS - 1], 0.75);
        assert!(v[WAVE_NOW_POINTS..].iter().all(|x| *x == 0.0));
    }
}
