//! 重心と変化量：スペクトルの重心（音の明るさ）とフラックス（音色の変化の激しさ）
//!
//! セクション `Centroid` のペイロード（f32 × `CENTROID_LEN`）：
//!
//! ```text
//! [0] centroid  スペクトルの重心（Hz）。無音のときは 0
//! [1] flux      フラックス（0〜1）。無音のときは 0
//! ```
//!
//! - 重心：共有の FFT の `CENTROID_MIN_HZ`〜`CENTROID_MAX_HZ` の本数ごとの振幅（L・R の強さの平均の平方根）で、
//!   周波数を重み付けした平均。周波数は線形のまま平均する（一般的なスペクトルの重心の定義）。表示の軸
//!   （対数など）への写し方と平滑化は UI 側で行う
//! - フラックス：スペクトラムと同じ対数の帯域（`SPECTRUM_BANDS` 個）の振幅について、前回の解析から増えた分の和を、
//!   今回の振幅の和で割ったもの。0 は変化なし、1 は前回が無音で今回すべてが新しく鳴った。減った分は数えない
//!   （音の立ち上がりを拾うため）。解析の間隔（約 1/60 秒）ごとの変化なので、間隔が変わると値も少し変わる
//! - 範囲の強さの和が −60 dBFS 未満なら無音とする。無音の回も帯域の振幅は覚えておき、次に鳴り始めた回の
//!   フラックスに使う
//!
//! 新しく届いたフレーム（`StereoWindow::new_frames`）がない回は、前回と同じ FFT になるので、前回の値を返す。
//! 解析を有効にし直したとき（`reset`）は前回の帯域を捨て、次の回のフラックスは 0 とする。

use super::bands::LogBands;
use super::spectrum::ensure_bands;
use super::{
    AnalysisContext, Analyzer, SPECTRUM_BANDS, SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ, SectionId,
    SectionWriter, StereoWindow,
};

/// ペイロードの長さ
pub const CENTROID_LEN: usize = 2;
/// 重心を求める範囲の下端（Hz）
pub const CENTROID_MIN_HZ: f32 = 30.0;
/// 重心を求める範囲の上端（Hz）
pub const CENTROID_MAX_HZ: f32 = 20_000.0;

/// 無音とみなす強さ（振幅の二乗の和。−60 dBFS）
const SILENCE_POWER: f32 = 1e-6;

/// 重心と変化量の解析
#[derive(Debug, Default)]
pub struct CentroidAnalyzer {
    bands: Option<LogBands>,
    average: Vec<f32>,
    current: Vec<f32>,
    previous: Vec<f32>,
    values: [f32; CENTROID_LEN],
}

impl CentroidAnalyzer {
    pub fn new() -> Self {
        Self::default()
    }

    fn update(&mut self, ctx: &AnalysisContext) {
        self.average.clear();
        self.average.extend(
            ctx.power_left()
                .iter()
                .zip(ctx.power_right())
                .map(|(l, r)| (l + r) * 0.5),
        );

        // 重心
        let bin_hz = ctx.bin_hz();
        let first = ((CENTROID_MIN_HZ / bin_hz).ceil() as usize).max(1);
        let last = ((CENTROID_MAX_HZ / bin_hz).ceil() as usize).min(self.average.len());
        let (mut power, mut weighted, mut total) = (0.0f32, 0.0f64, 0.0f64);
        for k in first..last {
            let p = self.average[k];
            power += p;
            let a = f64::from(p.sqrt());
            weighted += a * k as f64 * f64::from(bin_hz);
            total += a;
        }
        let silent = power < SILENCE_POWER || total <= 0.0;

        // フラックス
        let bands = ensure_bands(
            &mut self.bands,
            ctx,
            SPECTRUM_BANDS,
            SPECTRUM_MIN_HZ,
            SPECTRUM_MAX_HZ,
        );
        std::mem::swap(&mut self.current, &mut self.previous);
        self.current.clear();
        self.current
            .extend((0..bands.len()).map(|i| bands.power(i, &self.average).sqrt()));
        let flux = if self.previous.len() == self.current.len() {
            let sum: f32 = self.current.iter().sum();
            let rise: f32 = self
                .current
                .iter()
                .zip(&self.previous)
                .map(|(now, before)| (now - before).max(0.0))
                .sum();
            if sum > 0.0 {
                (rise / sum).clamp(0.0, 1.0)
            } else {
                0.0
            }
        } else {
            0.0
        };

        self.values = if silent {
            [0.0, 0.0]
        } else {
            [(weighted / total) as f32, flux]
        };
    }
}

impl Analyzer for CentroidAnalyzer {
    fn id(&self) -> SectionId {
        SectionId::Centroid
    }

    fn uses_fft(&self) -> bool {
        true
    }

    fn reset(&mut self) {
        self.previous.clear();
        self.current.clear();
        self.values = [0.0; CENTROID_LEN];
    }

    fn process(&mut self, window: &StereoWindow, ctx: &AnalysisContext, out: &mut SectionWriter) {
        if ctx.is_ready() && window.new_frames() > 0 {
            self.update(ctx);
        }
        out.extend_from_slice(&self.values);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::fft_size_for;
    use crate::analysis::test_signal::{run_one, silence, sine, stereo_window_with_new};

    const RATE: u32 = 48_000;
    /// 1回の解析で届くフレーム数（約60回/秒）
    const TICK: usize = 800;
    /// 1本の間隔（48 kHz・2048 本）
    const BIN: f32 = 23.437_5;

    /// 信号を約60回/秒の解析に分けて流し、回ごとの結果を返す
    fn stream(analyzer: &mut CentroidAnalyzer, left: &[f32], right: &[f32]) -> Vec<[f32; 2]> {
        let size = fft_size_for(RATE);
        let mut ctx = AnalysisContext::new();
        let mut results = Vec::new();
        let mut end = TICK;
        while end <= left.len() {
            let start = end.saturating_sub(size);
            let window = stereo_window_with_new(&left[start..end], &right[start..end], RATE, TICK);
            ctx.prepare(&window);
            let mut out = SectionWriter::new();
            out.begin(SectionId::Centroid);
            analyzer.process(&window, &ctx, &mut out);
            out.end();
            let v = out.section(SectionId::Centroid).unwrap();
            results.push([v[0], v[1]]);
            end += TICK;
        }
        results
    }

    #[test]
    fn centroid_of_one_sine_is_its_frequency() {
        let s = sine(40.0 * BIN, 0.5, RATE, 4_096);
        let v = run_one(&mut CentroidAnalyzer::new(), &s, &s, RATE, TICK);
        assert_eq!(v.len(), CENTROID_LEN);
        assert!((v[0] - 40.0 * BIN).abs() < 1.0, "centroid {}", v[0]);
    }

    #[test]
    fn brighter_tones_have_a_higher_centroid() {
        let mut previous = 0.0;
        for bins in [10.0, 40.0, 120.0, 400.0] {
            let s = sine(bins * BIN, 0.5, RATE, 4_096);
            let v = run_one(&mut CentroidAnalyzer::new(), &s, &s, RATE, TICK);
            assert!(v[0] > previous, "{bins} bins: {} <= {previous}", v[0]);
            previous = v[0];
        }
        // 低い音に高い音を足すと、低い音だけのときより高くなる
        let low = sine(40.0 * BIN, 0.5, RATE, 4_096);
        let high = sine(300.0 * BIN, 0.2, RATE, 4_096);
        let mixed: Vec<f32> = low.iter().zip(&high).map(|(a, b)| a + b).collect();
        let base = run_one(&mut CentroidAnalyzer::new(), &low, &low, RATE, TICK)[0];
        let bright = run_one(&mut CentroidAnalyzer::new(), &mixed, &mixed, RATE, TICK)[0];
        assert!(bright > base, "{bright} <= {base}");
    }

    #[test]
    fn centroid_weights_by_amplitude_across_channels() {
        // L に 937.5 Hz・0.5、R に 2812.5 Hz・0.25 → (937.5 × 2 + 2812.5) / 3 = 1562.5 Hz
        let l = sine(40.0 * BIN, 0.5, RATE, 4_096);
        let r = sine(120.0 * BIN, 0.25, RATE, 4_096);
        let v = run_one(&mut CentroidAnalyzer::new(), &l, &r, RATE, TICK);
        assert!((v[0] - 1_562.5).abs() < 2.0, "centroid {}", v[0]);
    }

    #[test]
    fn flux_is_high_at_an_onset_and_near_zero_for_a_steady_tone() {
        let mut s = silence(RATE as usize / 2);
        s.extend(sine(1_000.0, 0.5, RATE, RATE as usize));
        let results = stream(&mut CentroidAnalyzer::new(), &s, &s);
        let onset = RATE as usize / 2 / TICK;

        // 無音の間は重心もフラックスも 0
        assert!(results[..onset].iter().all(|r| *r == [0.0, 0.0]));
        // 鳴り始めの回は大きく、鳴り続けると 0 に近い
        let peak = results[onset..onset + 3]
            .iter()
            .map(|r| r[1])
            .fold(0.0, f32::max);
        assert!(peak > 0.5, "onset flux {peak}");
        let steady = results.last().unwrap();
        assert!(steady[1] < 0.01, "steady flux {}", steady[1]);
        assert!((steady[0] - 1_000.0).abs() < 30.0, "centroid {}", steady[0]);
    }

    #[test]
    fn stale_ticks_hold_and_reset_forgets_the_previous_bands() {
        let mut analyzer = CentroidAnalyzer::new();
        let mut s = silence(RATE as usize / 4);
        s.extend(sine(1_000.0, 0.5, RATE, 4_800));
        let before = *stream(&mut analyzer, &s, &s).last().unwrap();

        // 新しいフレームが届いていない回は、前回の値のまま
        let z = silence(4_096);
        let held = run_one(&mut analyzer, &z, &z, RATE, 0);
        assert_eq!(held, before);

        // 有効にし直した最初の回は、前回の帯域がないのでフラックスは 0
        analyzer.reset();
        let tone = sine(1_000.0, 0.5, RATE, 4_096);
        let first = run_one(&mut analyzer, &tone, &tone, RATE, TICK);
        assert!(first[0] > 0.0);
        assert_eq!(first[1], 0.0);
    }
}
