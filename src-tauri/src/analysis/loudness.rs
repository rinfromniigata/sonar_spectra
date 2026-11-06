//! ラウドネス（表示名 LOUD）の近似と、ピーク
//!
//! セクション `Loudness` のペイロード（f32 × `LOUDNESS_LEN`）：
//!
//! ```text
//! [0] momentary   直近 MOMENTARY_SECONDS 秒のラウドネス（dB。LUFS に近い値）
//! [1] short_term  直近 SHORT_TERM_SECONDS 秒のラウドネス（dB。LOUD の表示に使う）
//! [2] peak        直近 SHORT_TERM_SECONDS 秒の L・R のサンプルの最大値（dBFS）
//! ```
//!
//! 値は dB で、無音などで計算できないときは `LOUDNESS_FLOOR_DB`（UI は −∞ として表示する）。
//!
//! 近似の中身：ITU-R BS.1770 の K 特性（高域のシェルフと低域の遮断の2段の双2次フィルタ）を L・R に掛け、
//! 平均二乗の和から `−0.691 + 10·log10(ms_L + ms_R)` で求める。規格のゲート（無音や小さな区間を除く処理）、
//! トゥルーピーク（オーバーサンプリング）、区間の正確な端は扱わない。ピークはサンプルの最大値。
//! SPEC の「既知の制限」のとおり、規格に沿った測定ではない。
//!
//! フィルタと区間の和は状態を持つ。新しく届いたフレーム（`StereoWindow::new_frames`）だけを1度ずつ数え、
//! サンプルレートが変わったとき・解析を有効にし直したとき（`reset`）は、状態を捨てて数え直す。
//! 数え始めてから区間の長さに届くまでは、届いた分の平均で求める。

use std::collections::VecDeque;

use super::{AnalysisContext, Analyzer, SectionId, SectionWriter, StereoWindow};

/// モーメンタリの区間（秒）
pub const MOMENTARY_SECONDS: f64 = 0.4;
/// ショートタームの区間（秒）。ピークもこの区間で求める
pub const SHORT_TERM_SECONDS: f64 = 3.0;
/// 計算できないとき（無音など）の値（dB）
pub const LOUDNESS_FLOOR_DB: f32 = -120.0;
/// ペイロードの長さ
pub const LOUDNESS_LEN: usize = 3;

/// 双2次フィルタ（直接形 I）。係数は a0 で割ったもの
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct Biquad {
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
}

#[derive(Debug, Clone, Copy, Default)]
struct BiquadState {
    x1: f64,
    x2: f64,
    y1: f64,
    y2: f64,
}

impl Biquad {
    fn run(&self, s: &mut BiquadState, x: f64) -> f64 {
        let y = self.b0 * x + self.b1 * s.x1 + self.b2 * s.x2 - self.a1 * s.y1 - self.a2 * s.y2;
        s.x2 = s.x1;
        s.x1 = x;
        s.y2 = s.y1;
        s.y1 = y;
        y
    }
}

/// K 特性の2段のフィルタ（BS.1770 の 48 kHz の係数を、任意のサンプルレートに合わせて設計し直したもの）
fn k_weighting(sample_rate: u32) -> [Biquad; 2] {
    let fs = f64::from(sample_rate);

    // 1段目：高域のシェルフ（約 +4 dB）
    let f0 = 1_681.974_450_955_533;
    let gain_db = 3.999_843_853_973_347;
    let q = 0.707_175_236_955_419_6;
    let k = (std::f64::consts::PI * f0 / fs).tan();
    let vh = 10f64.powf(gain_db / 20.0);
    let vb = vh.powf(0.499_666_774_154_541_6);
    let a0 = 1.0 + k / q + k * k;
    let shelf = Biquad {
        b0: (vh + vb * k / q + k * k) / a0,
        b1: 2.0 * (k * k - vh) / a0,
        b2: (vh - vb * k / q + k * k) / a0,
        a1: 2.0 * (k * k - 1.0) / a0,
        a2: (1.0 - k / q + k * k) / a0,
    };

    // 2段目：低域の遮断（RLB）
    let f0 = 38.135_470_876_024_44;
    let q = 0.500_327_037_323_877_3;
    let k = (std::f64::consts::PI * f0 / fs).tan();
    let a0 = 1.0 + k / q + k * k;
    let high_pass = Biquad {
        b0: 1.0,
        b1: -2.0,
        b2: 1.0,
        a1: 2.0 * (k * k - 1.0) / a0,
        a2: (1.0 - k / q + k * k) / a0,
    };

    [shelf, high_pass]
}

/// 1回の解析で数えた区間
#[derive(Debug, Clone, Copy)]
struct Block {
    frames: usize,
    /// K 特性を掛けた L・R の二乗の和（L と R を足したもの）
    sum_squares: f64,
    /// L・R のサンプルの絶対値の最大
    peak: f32,
}

/// ラウドネスの解析
#[derive(Debug, Default)]
pub struct LoudnessAnalyzer {
    sample_rate: u32,
    filters: [Biquad; 2],
    state: [[BiquadState; 2]; 2],
    blocks: VecDeque<Block>,
    total_frames: usize,
}

impl LoudnessAnalyzer {
    pub fn new() -> Self {
        Self::default()
    }

    fn restart(&mut self, sample_rate: u32) {
        self.sample_rate = sample_rate;
        self.filters = if sample_rate == 0 {
            [Biquad::default(); 2]
        } else {
            k_weighting(sample_rate)
        };
        self.state = Default::default();
        self.blocks.clear();
        self.total_frames = 0;
    }

    fn feed(&mut self, left: &[f32], right: &[f32]) {
        let [shelf, high_pass] = self.filters;
        let mut sum_squares = 0.0;
        let mut peak = 0.0f32;
        for (channel, samples) in [left, right].into_iter().enumerate() {
            let [s1, s2] = &mut self.state[channel];
            for x in samples {
                peak = peak.max(x.abs());
                let y = high_pass.run(s2, shelf.run(s1, f64::from(*x)));
                sum_squares += y * y;
            }
        }
        self.blocks.push_back(Block {
            frames: left.len(),
            sum_squares,
            peak,
        });
        self.total_frames += left.len();

        // ショートタームの区間を覆う分だけ残す
        let keep = frames_for(self.sample_rate, SHORT_TERM_SECONDS);
        while let Some(front) = self.blocks.front() {
            if self.total_frames - front.frames < keep {
                break;
            }
            self.total_frames -= front.frames;
            self.blocks.pop_front();
        }
    }

    /// 新しい側から `frames` フレーム分（足りなければあるだけ）のラウドネス
    fn loudness(&self, frames: usize) -> f32 {
        let (mut counted, mut sum) = (0usize, 0.0f64);
        for block in self.blocks.iter().rev() {
            if counted >= frames {
                break;
            }
            counted += block.frames;
            sum += block.sum_squares;
        }
        if counted == 0 || sum <= 0.0 {
            return LOUDNESS_FLOOR_DB;
        }
        let db = -0.691 + 10.0 * (sum / counted as f64).log10();
        (db as f32).max(LOUDNESS_FLOOR_DB)
    }

    fn peak_db(&self) -> f32 {
        let peak = self.blocks.iter().fold(0.0f32, |a, b| a.max(b.peak));
        if peak <= 0.0 {
            return LOUDNESS_FLOOR_DB;
        }
        (20.0 * peak.log10()).max(LOUDNESS_FLOOR_DB)
    }
}

fn frames_for(sample_rate: u32, seconds: f64) -> usize {
    ((f64::from(sample_rate) * seconds).round() as usize).max(1)
}

impl Analyzer for LoudnessAnalyzer {
    fn id(&self) -> SectionId {
        SectionId::Loudness
    }

    fn window_frames(&self, sample_rate: u32) -> usize {
        // 解析が少し遅れても届いた分を取りこぼさないよう、約0.1秒分を見られるようにする（レベルと同じ）
        (sample_rate / 10) as usize
    }

    fn reset(&mut self) {
        self.restart(0);
    }

    fn process(&mut self, window: &StereoWindow, _ctx: &AnalysisContext, out: &mut SectionWriter) {
        if window.sample_rate() != self.sample_rate {
            self.restart(window.sample_rate());
        }
        let new_frames = window.new_frames().min(window.len());
        if new_frames > 0 {
            let (left, right) = window.latest(new_frames);
            self.feed(left, right);
        }
        out.extend_from_slice(&[
            self.loudness(frames_for(self.sample_rate, MOMENTARY_SECONDS)),
            self.loudness(frames_for(self.sample_rate, SHORT_TERM_SECONDS)),
            self.peak_db(),
        ]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::test_signal::{silence, sine, stereo_window_with_new};

    const RATE: u32 = 48_000;
    /// 1回の解析で届くフレーム数（約60回/秒）
    const TICK: usize = 800;

    /// 信号を約60回/秒の解析に分けて流し、最後の結果を返す
    fn stream(
        analyzer: &mut LoudnessAnalyzer,
        left: &[f32],
        right: &[f32],
        rate: u32,
    ) -> Vec<[f32; 3]> {
        let ctx = AnalysisContext::new();
        let window_len = analyzer.window_frames(rate);
        let tick = (rate / 60) as usize;
        let mut results = Vec::new();
        let mut end = tick;
        while end <= left.len() {
            let start = end.saturating_sub(window_len);
            let window = stereo_window_with_new(&left[start..end], &right[start..end], rate, tick);
            let mut out = SectionWriter::new();
            out.begin(SectionId::Loudness);
            analyzer.process(&window, &ctx, &mut out);
            out.end();
            let v = out.section(SectionId::Loudness).unwrap();
            results.push([v[0], v[1], v[2]]);
            end += tick;
        }
        results
    }

    #[test]
    fn k_weighting_matches_the_published_48khz_coefficients() {
        let [shelf, high_pass] = k_weighting(48_000);
        let close = |a: f64, b: f64| (a - b).abs() < 1e-8;
        assert!(close(shelf.b0, 1.535_124_859_586_97));
        assert!(close(shelf.b1, -2.691_696_189_406_38));
        assert!(close(shelf.b2, 1.198_392_810_852_85));
        assert!(close(shelf.a1, -1.690_659_293_182_41));
        assert!(close(shelf.a2, 0.732_480_774_215_85));
        assert!(close(high_pass.a1, -1.990_047_454_833_98));
        assert!(close(high_pass.a2, 0.990_072_250_366_21));
    }

    #[test]
    fn full_scale_1khz_sine_in_one_channel_reads_about_minus_3() {
        // BS.1770 の確認用の信号：0 dBFS・1 kHz の正弦波を片側だけ → −3.01 LKFS
        let s = sine(1_000.0, 1.0, RATE, RATE as usize * 4);
        let z = silence(s.len());
        let last = *stream(&mut LoudnessAnalyzer::new(), &s, &z, RATE)
            .last()
            .unwrap();
        assert!((last[0] + 3.01).abs() < 0.1, "momentary {}", last[0]);
        assert!((last[1] + 3.01).abs() < 0.1, "short-term {}", last[1]);
        assert!(last[2].abs() < 0.01, "peak {}", last[2]);
    }

    #[test]
    fn constant_level_gives_a_steady_value() {
        // −20 dBFS の 1 kHz を両側に：片側だけの −23 に、もう片側の分の +3 dB でおよそ −20
        let amp = 0.1;
        let s = sine(1_000.0, amp, RATE, RATE as usize * 5);
        let results = stream(&mut LoudnessAnalyzer::new(), &s, &s, RATE);
        // ショートタームの区間が埋まった後（3秒以降）は、どちらの値も 0.05 dB 以内で動かない
        let settled = &results[(3.2 * 60.0) as usize..];
        for i in 0..2 {
            let (min, max) = settled.iter().fold((f32::MAX, f32::MIN), |(lo, hi), r| {
                (lo.min(r[i]), hi.max(r[i]))
            });
            assert!(max - min < 0.05, "value {i} moved {min}..{max}");
            assert!((max + 20.0).abs() < 0.2, "value {i} = {max}");
        }
        let peak = settled.last().unwrap()[2];
        assert!((peak + 20.0).abs() < 0.05, "peak {peak}");
    }

    #[test]
    fn silence_reads_the_floor_and_a_loud_burst_fades_out_of_the_windows() {
        let mut analyzer = LoudnessAnalyzer::new();
        let z = silence(RATE as usize);
        let first = *stream(&mut analyzer, &z, &z, RATE).last().unwrap();
        assert_eq!(first, [LOUDNESS_FLOOR_DB; 3]);

        // 1秒の音の後に4秒の無音：区間から外れて床に戻る
        let mut s = sine(1_000.0, 0.5, RATE, RATE as usize);
        s.extend(silence(RATE as usize * 4));
        let results = stream(&mut LoudnessAnalyzer::new(), &s, &s, RATE);
        let during = results[50];
        assert!(during[0] > -20.0 && during[2] > -7.0);
        let after_momentary = results[(1.5 * 60.0) as usize];
        assert_eq!(after_momentary[0], LOUDNESS_FLOOR_DB);
        assert!(
            after_momentary[1] > -30.0,
            "short-term still holds the burst"
        );
        let end = *results.last().unwrap();
        assert_eq!(end, [LOUDNESS_FLOOR_DB; 3]);
    }

    #[test]
    fn frames_are_counted_once_and_stale_ticks_keep_the_value() {
        let mut analyzer = LoudnessAnalyzer::new();
        let ctx = AnalysisContext::new();
        let s = sine(1_000.0, 0.5, RATE, 4_800);
        let mut out = SectionWriter::new();

        out.begin(SectionId::Loudness);
        analyzer.process(&stereo_window_with_new(&s, &s, RATE, TICK), &ctx, &mut out);
        out.end();
        assert_eq!(analyzer.total_frames, TICK);
        let first = out.section(SectionId::Loudness).unwrap().to_vec();

        // 新しいフレームが届いていない回は、数えずに同じ値を返す
        out.clear();
        out.begin(SectionId::Loudness);
        analyzer.process(&stereo_window_with_new(&s, &s, RATE, 0), &ctx, &mut out);
        out.end();
        assert_eq!(analyzer.total_frames, TICK);
        assert_eq!(out.section(SectionId::Loudness).unwrap(), &first[..]);

        // 窓より多く届いたときは、窓の分だけ数える
        out.clear();
        out.begin(SectionId::Loudness);
        analyzer.process(
            &stereo_window_with_new(&s, &s, RATE, 100_000),
            &ctx,
            &mut out,
        );
        out.end();
        assert_eq!(analyzer.total_frames, TICK + 4_800);
    }

    #[test]
    fn a_rate_change_or_reset_starts_over() {
        let mut analyzer = LoudnessAnalyzer::new();
        let s = sine(1_000.0, 0.5, RATE, RATE as usize);
        stream(&mut analyzer, &s, &s, RATE);
        assert!(analyzer.total_frames > 0);

        let z = silence(96_000);
        let last = *stream(&mut analyzer, &z, &z, 96_000).last().unwrap();
        assert_eq!(analyzer.sample_rate, 96_000);
        assert_eq!(last, [LOUDNESS_FLOOR_DB; 3]);

        analyzer.reset();
        assert_eq!(analyzer.total_frames, 0);
        assert!(analyzer.blocks.is_empty());
    }
}
