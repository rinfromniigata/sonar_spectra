//! スペクトラム：対数の帯域ごとの振幅
//!
//! セクション `Spectrum` のペイロード（f32 × `SPECTRUM_LEN`）：
//!
//! ```text
//! [0 .. SPECTRUM_BANDS)   帯域ごとの振幅（低い順）
//! ```
//!
//! 帯域は `SPECTRUM_MIN_HZ` 〜 `SPECTRUM_MAX_HZ` を対数で `SPECTRUM_BANDS` 等分したもの（`bands.rs`）。
//! この範囲で、モックの周波数の目盛り（50・200・1k・5k・16k を横幅の 6・30・55・80・97% の位置）に合う。
//! 値は線形の振幅で、1.0 がフルスケール。L・R それぞれのエネルギーを平均して求める（逆位相でも打ち消し合わない）。
//! L と R に同じ振幅 A の正弦波が1つだけあれば、その周波数の帯域がおよそ A になる（山が隣の帯域にも
//! 分かれることがあり、その分は両隣と合わせると A になる）。FFT の1本の間隔（48 kHz で約23 Hz）より狭い
//! 低域（約330 Hz 未満）の帯域は、前後の本数の補間なので、山の位置は1本の間隔の精度で、高さは最大で約3 dB 小さい。
//! dB への換算、表示の範囲、平滑化とピークの残像は UI 側で行う。スペクトログラムも、このセクションを使う。

use super::bands::LogBands;
use super::{AnalysisContext, Analyzer, SectionId, SectionWriter, StereoWindow};

/// 帯域の数（モックの BINS と同じ）
pub const SPECTRUM_BANDS: usize = 96;
/// いちばん低い帯域の下端（Hz）
pub const SPECTRUM_MIN_HZ: f32 = 30.0;
/// いちばん高い帯域の上端（Hz）
pub const SPECTRUM_MAX_HZ: f32 = 20_000.0;
/// ペイロードの長さ
pub const SPECTRUM_LEN: usize = SPECTRUM_BANDS;

/// スペクトラムの解析
#[derive(Debug, Default)]
pub struct SpectrumAnalyzer {
    bands: Option<LogBands>,
    average: Vec<f32>,
}

impl SpectrumAnalyzer {
    pub fn new() -> Self {
        Self::default()
    }
}

/// 帯域の割り当てを、今の FFT の条件に合わせる（変わったときだけ作り直す）
pub(crate) fn ensure_bands<'a>(
    slot: &'a mut Option<LogBands>,
    ctx: &AnalysisContext,
    count: usize,
    min_hz: f32,
    max_hz: f32,
) -> &'a LogBands {
    let bins = ctx.power_left().len();
    let bin_hz = ctx.bin_hz();
    if !slot
        .as_ref()
        .is_some_and(|b| b.matches(count, min_hz, max_hz, bin_hz, bins))
    {
        *slot = Some(LogBands::new(count, min_hz, max_hz, bin_hz, bins));
    }
    slot.as_ref().expect("bands were just set")
}

impl Analyzer for SpectrumAnalyzer {
    fn id(&self) -> SectionId {
        SectionId::Spectrum
    }

    fn uses_fft(&self) -> bool {
        true
    }

    fn process(&mut self, _window: &StereoWindow, ctx: &AnalysisContext, out: &mut SectionWriter) {
        if !ctx.is_ready() {
            for _ in 0..SPECTRUM_LEN {
                out.push(0.0);
            }
            return;
        }
        self.average.clear();
        self.average.extend(
            ctx.power_left()
                .iter()
                .zip(ctx.power_right())
                .map(|(l, r)| (l + r) * 0.5),
        );
        let bands = ensure_bands(
            &mut self.bands,
            ctx,
            SPECTRUM_BANDS,
            SPECTRUM_MIN_HZ,
            SPECTRUM_MAX_HZ,
        );
        for band in 0..SPECTRUM_BANDS {
            out.push(bands.power(band, &self.average).sqrt());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::test_signal::{run_one, silence, sine};

    const RATE: u32 = 48_000;
    const LEN: usize = 4_800;

    fn band_of(hz: f32) -> usize {
        LogBands::new(
            SPECTRUM_BANDS,
            SPECTRUM_MIN_HZ,
            SPECTRUM_MAX_HZ,
            RATE as f32 / 2048.0,
            1025,
        )
        .band_of(hz)
        .unwrap()
    }

    fn peak_band(out: &[f32]) -> usize {
        (0..out.len())
            .max_by(|a, b| out[*a].total_cmp(&out[*b]))
            .unwrap()
    }

    #[test]
    fn payload_has_the_documented_length() {
        let s = sine(1_000.0, 0.5, RATE, LEN);
        let out = run_one(&mut SpectrumAnalyzer::new(), &s, &s, RATE, 800);
        assert_eq!(out.len(), SPECTRUM_LEN);
    }

    #[test]
    fn silence_gives_zero() {
        let z = silence(LEN);
        let out = run_one(&mut SpectrumAnalyzer::new(), &z, &z, RATE, 800);
        assert!(out.iter().all(|v| *v == 0.0));
    }

    #[test]
    fn a_1khz_sine_peaks_in_the_1khz_band_with_its_amplitude() {
        let amp = 0.5;
        let s = sine(1_000.0, amp, RATE, LEN);
        let out = run_one(&mut SpectrumAnalyzer::new(), &s, &s, RATE, 800);
        let band = band_of(1_000.0);
        assert_eq!(peak_band(&out), band);
        // 山が隣の帯域にも分かれるので、山の帯域と両隣を合わせると振幅になる
        let around = (out[band - 1].powi(2) + out[band].powi(2) + out[band + 1].powi(2)).sqrt();
        assert!((around - amp).abs() < 0.05 * amp, "around 1 kHz {around}");
        // 離れた帯域には漏れない
        assert!(out[band_of(100.0)] < 1e-3 * amp);
        assert!(out[band_of(10_000.0)] < 1e-3 * amp);
    }

    #[test]
    fn sines_land_in_their_bands_from_low_to_high() {
        let bin_hz = RATE as f32 / 2048.0;
        for hz in [60.0, 250.0, 3_000.0, 12_000.0] {
            let s = sine(hz, 0.5, RATE, LEN);
            let out = run_one(&mut SpectrumAnalyzer::new(), &s, &s, RATE, 800);
            let peak = peak_band(&out);
            // 1本の間隔より狭い低域の帯域では、山は最も近い本数の周波数に来る（精度は1本の間隔の半分）。
            // 広い帯域では、その周波数の帯域か隣に来る
            let low = band_of(hz - bin_hz * 0.55);
            let high = band_of(hz + bin_hz * 0.55);
            assert!(
                (low.saturating_sub(1)..=high + 1).contains(&peak),
                "{hz} Hz peaked at band {peak}, expected {low}..={high}"
            );
            // 低域の狭い帯域でも、山の高さは振幅から大きく外れない（およそ −3 dB 以内）
            assert!(
                out[peak] > 0.5 * 0.65 && out[peak] < 0.5 * 1.05,
                "{hz} Hz peak {}",
                out[peak]
            );
        }
    }

    #[test]
    fn antiphase_does_not_cancel() {
        let s = sine(1_000.0, 0.5, RATE, LEN);
        let neg: Vec<f32> = s.iter().map(|v| -v).collect();
        let same = run_one(&mut SpectrumAnalyzer::new(), &s, &s, RATE, 800);
        let anti = run_one(&mut SpectrumAnalyzer::new(), &s, &neg, RATE, 800);
        for (a, b) in same.iter().zip(&anti) {
            assert!((a - b).abs() < 1e-4);
        }
    }

    #[test]
    fn other_sample_rates_keep_the_band_layout() {
        let rate = 96_000;
        let s = sine(1_000.0, 0.5, rate, 9_600);
        let out = run_one(&mut SpectrumAnalyzer::new(), &s, &s, rate, 1_600);
        assert_eq!(out.len(), SPECTRUM_LEN);
        assert_eq!(peak_band(&out), band_of(1_000.0));
    }
}
