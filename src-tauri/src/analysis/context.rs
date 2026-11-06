//! 解析の間で共有する計算結果（FFT）
//!
//! スペクトラム・定位・クロマ・重心・波形の帯域別の強さは、同じ FFT の結果を使う。
//! FFT は1回の解析につき1度だけ、使う解析が有効なときだけ計算する。

use std::sync::Arc;

use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};

use super::window::StereoWindow;

/// 48 kHz のときの FFT の長さ（約43ms）。ほかのサンプルレートでは、時間の長さがおよそ同じになる2の累乗にする
const BASE_FFT_SIZE: usize = 2048;
const BASE_SAMPLE_RATE: f64 = 48_000.0;

/// サンプルレートに応じた FFT の長さ（44.1/48 kHz → 2048、96 kHz → 4096、192 kHz → 8192）
pub fn fft_size_for(sample_rate: u32) -> usize {
    let ratio = f64::from(sample_rate.max(1)) / BASE_SAMPLE_RATE;
    let exponent = ratio.log2().round().clamp(-3.0, 3.0) as i32;
    if exponent >= 0 {
        BASE_FFT_SIZE << exponent
    } else {
        BASE_FFT_SIZE >> -exponent
    }
}

/// 解析の間で共有する計算結果
pub struct AnalysisContext {
    planner: FftPlanner<f32>,
    fft: Option<Arc<dyn Fft<f32>>>,
    sample_rate: u32,
    size: usize,
    /// ハン窓
    window: Vec<f32>,
    /// 窓の二乗和（振幅への換算に使う）
    window_power: f32,
    buffer: Vec<Complex<f32>>,
    scratch: Vec<Complex<f32>>,
    /// 0 からナイキストまで（size / 2 + 1 本）
    left: Vec<Complex<f32>>,
    right: Vec<Complex<f32>>,
    ready: bool,
}

impl Default for AnalysisContext {
    fn default() -> Self {
        Self::new()
    }
}

impl AnalysisContext {
    pub fn new() -> Self {
        Self {
            planner: FftPlanner::new(),
            fft: None,
            sample_rate: 0,
            size: 0,
            window: Vec::new(),
            window_power: 0.0,
            buffer: Vec::new(),
            scratch: Vec::new(),
            left: Vec::new(),
            right: Vec::new(),
            ready: false,
        }
    }

    /// 前回の結果を使えなくする（FFT を使う解析が1つも有効でない回のため）
    pub(crate) fn invalidate(&mut self) {
        self.ready = false;
    }

    fn plan(&mut self, sample_rate: u32) {
        let size = fft_size_for(sample_rate);
        self.sample_rate = sample_rate;
        if size == self.size {
            return;
        }
        let fft = self.planner.plan_fft_forward(size);
        self.scratch = vec![Complex::default(); fft.get_inplace_scratch_len()];
        self.fft = Some(fft);
        self.size = size;
        // 周期的なハン窓（スペクトル解析向け）
        self.window = (0..size)
            .map(|n| {
                let phase = std::f32::consts::TAU * n as f32 / size as f32;
                0.5 - 0.5 * phase.cos()
            })
            .collect();
        self.window_power = self.window.iter().map(|w| w * w).sum();
        self.buffer = vec![Complex::default(); size];
        self.left = vec![Complex::default(); size / 2 + 1];
        self.right = vec![Complex::default(); size / 2 + 1];
    }

    /// 窓の末尾 `fft_size` フレームで、L・R の FFT を計算する
    ///
    /// 窓が短ければ、足りない古い側を0とみなす。L を実部、R を虚部に詰めて1回の FFT で求め、分け直す。
    pub(crate) fn prepare(&mut self, window: &StereoWindow) {
        if window.sample_rate() != self.sample_rate || self.fft.is_none() {
            self.plan(window.sample_rate());
        }
        let Some(fft) = self.fft.clone() else {
            return;
        };
        let size = self.size;

        let (left, right) = window.latest(size);
        let pad = size - left.len();
        self.buffer[..pad].fill(Complex::default());
        for (i, (l, r)) in left.iter().zip(right).enumerate() {
            let w = self.window[pad + i];
            self.buffer[pad + i] = Complex::new(l * w, r * w);
        }
        fft.process_with_scratch(&mut self.buffer, &mut self.scratch);

        // Z = FFT(l + i r) から、L_k = (Z_k + conj(Z_{N-k})) / 2、R_k = (Z_k - conj(Z_{N-k})) / 2i
        for k in 0..=size / 2 {
            let z = self.buffer[k];
            let z_mirror = self.buffer[(size - k) % size].conj();
            self.left[k] = (z + z_mirror) * 0.5;
            let diff = z - z_mirror;
            self.right[k] = Complex::new(diff.im * 0.5, -diff.re * 0.5);
        }
        self.ready = true;
    }

    /// この回の FFT が計算済みか
    pub fn is_ready(&self) -> bool {
        self.ready
    }

    pub fn fft_size(&self) -> usize {
        self.size
    }

    /// 1本あたりの周波数（Hz）
    pub fn bin_hz(&self) -> f32 {
        if self.size == 0 {
            0.0
        } else {
            self.sample_rate as f32 / self.size as f32
        }
    }

    /// L の周波数成分（0 からナイキストまで）
    pub fn left(&self) -> &[Complex<f32>] {
        &self.left
    }

    /// R の周波数成分（0 からナイキストまで）
    pub fn right(&self) -> &[Complex<f32>] {
        &self.right
    }

    /// L・R を平均した信号のうち、`low_hz` 以上 `high_hz` 未満の成分の振幅
    ///
    /// その帯域に振幅 A の正弦波が1つだけあれば、およそ A を返す（窓の二乗和で換算する）。
    /// 直流（0 Hz）は含めない。
    pub fn band_amplitude(&self, low_hz: f32, high_hz: f32) -> f32 {
        if !self.ready {
            return 0.0;
        }
        let bin_hz = self.bin_hz();
        let first = ((low_hz / bin_hz).ceil() as usize).max(1);
        let last = ((high_hz / bin_hz).ceil() as usize).min(self.left.len());
        if first >= last {
            return 0.0;
        }
        let energy: f32 = (first..last)
            .map(|k| ((self.left[k] + self.right[k]) * 0.5).norm_sqr())
            .sum();
        (4.0 * energy / (self.size as f32 * self.window_power)).sqrt()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::test_signal::{sine, stereo_window};

    #[test]
    fn fft_size_keeps_about_the_same_duration() {
        assert_eq!(fft_size_for(44_100), 2048);
        assert_eq!(fft_size_for(48_000), 2048);
        assert_eq!(fft_size_for(88_200), 4096);
        assert_eq!(fft_size_for(96_000), 4096);
        assert_eq!(fft_size_for(192_000), 8192);
        assert_eq!(fft_size_for(22_050), 1024);
    }

    fn peak_bin(bins: &[Complex<f32>]) -> usize {
        (1..bins.len())
            .max_by(|a, b| bins[*a].norm().total_cmp(&bins[*b].norm()))
            .unwrap()
    }

    #[test]
    fn packed_fft_separates_left_and_right() {
        let rate = 48_000;
        // ビンの中心に乗る周波数（1本 = 23.4375 Hz）
        let l = sine(40.0 * 23.437_5, 0.5, rate, 2048);
        let r = sine(120.0 * 23.437_5, 0.25, rate, 2048);
        let mut ctx = AnalysisContext::new();
        ctx.prepare(&stereo_window(&l, &r, rate));

        assert!(ctx.is_ready());
        assert_eq!(ctx.fft_size(), 2048);
        assert_eq!(peak_bin(ctx.left()), 40);
        assert_eq!(peak_bin(ctx.right()), 120);
        // 相手側の周波数は漏れ込まない
        assert!(ctx.left()[120].norm() < 1e-3);
        assert!(ctx.right()[40].norm() < 1e-3);
    }

    #[test]
    fn band_amplitude_matches_the_sine_amplitude() {
        let rate = 48_000;
        let s = sine(1_000.0, 0.5, rate, 4096);
        let mut ctx = AnalysisContext::new();
        ctx.prepare(&stereo_window(&s, &s, rate));
        let a = ctx.band_amplitude(250.0, 4_000.0);
        assert!((a - 0.5).abs() < 0.01, "amplitude {a}");
        assert!(ctx.band_amplitude(4_000.0, 20_000.0) < 0.01);
    }

    #[test]
    fn short_window_is_padded_and_rate_change_replans() {
        let mut ctx = AnalysisContext::new();
        let s = sine(1_000.0, 0.5, 48_000, 100);
        ctx.prepare(&stereo_window(&s, &s, 48_000));
        assert_eq!(ctx.fft_size(), 2048);

        let s = sine(1_000.0, 0.5, 96_000, 5_000);
        ctx.prepare(&stereo_window(&s, &s, 96_000));
        assert_eq!(ctx.fft_size(), 4096);
        assert_eq!(ctx.left().len(), 2049);
        assert!((ctx.bin_hz() - 23.437_5).abs() < 1e-4);

        ctx.invalidate();
        assert!(!ctx.is_ready());
        assert_eq!(ctx.band_amplitude(0.0, 20_000.0), 0.0);
    }
}
