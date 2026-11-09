//! VU：L・R の針の振れ
//!
//! セクション `Vu` のペイロード（f32 × `VU_LEN`）：
//!
//! ```text
//! [0] left   L の針の位置（VU。0 が基準、dB の目盛り）
//! [1] right  R の針の位置
//! ```
//!
//! 値は dB で、針が振れていないとき（無音が続いたとき）は `VU_FLOOR_DB`。目盛りの範囲（−20〜+3）への
//! 切り詰め、針と残像の描画は UI 側で行う。
//!
//! 針の動きの中身：サンプルの絶対値（全波整流）を、針の機械的な動きをまねた2次の系に通す。
//! - 系の定数は、一定の正弦波を入れたとき 0.3 秒で振れの 99% に届き、行き過ぎが約 1.5% になる値
//!   （VU 計の規格の立ち上がり。`VU_NATURAL_RAD_PER_SEC`・`VU_DAMPING`）。戻りも同じ系で、ゆっくり戻る
//! - 正弦波で実効値と同じ値を指すよう、整流した平均を π/(2√2) 倍する
//! - 基準（0 VU）は、ピークが `VU_REFERENCE_DBFS` の正弦波。デジタルの機器で広く使われる値に合わせた
//!
//! 針の位置は状態を持つ。新しく届いたフレーム（`StereoWindow::new_frames`）だけを1度ずつ動かし、
//! 新しいフレームがない回は、前回の位置を返す。サンプルレートが変わったとき・解析を有効にし直したとき
//! （`reset`）は、針を止まった位置に戻す。

use super::{AnalysisContext, Analyzer, SectionId, SectionWriter, StereoWindow};

/// ペイロードの長さ
pub const VU_LEN: usize = 2;
/// 0 VU に当たる正弦波のピーク（dBFS）
pub const VU_REFERENCE_DBFS: f64 = -18.0;
/// 針が振れていないときの値（dB）
pub const VU_FLOOR_DB: f32 = -120.0;
/// 針の系の固有角周波数（rad/s）。`VU_DAMPING` と合わせて、0.3 秒で 99% に届く
pub const VU_NATURAL_RAD_PER_SEC: f64 = 13.13;
/// 針の系の減衰比（行き過ぎが約 1.5%）
pub const VU_DAMPING: f64 = 0.80;

/// 整流した平均を、正弦波の実効値に合わせる係数（π / (2√2)）
const RECTIFIED_TO_RMS: f64 = std::f64::consts::PI / (2.0 * std::f64::consts::SQRT_2);

/// 1本の針
#[derive(Debug, Clone, Copy, Default)]
struct Needle {
    /// 振れ（正弦波の実効値に換算した、線形の値）
    position: f64,
    velocity: f64,
}

impl Needle {
    /// 1サンプル分動かす（半陰的オイラー法。1サンプルの間隔は系の時定数よりずっと短い）
    fn step(&mut self, input: f64, dt: f64) {
        let wn = VU_NATURAL_RAD_PER_SEC;
        let accel = wn * wn * (input - self.position) - 2.0 * VU_DAMPING * wn * self.velocity;
        self.velocity += accel * dt;
        self.position += self.velocity * dt;
    }

    fn reading_db(&self) -> f32 {
        let reference = 10f64.powf(VU_REFERENCE_DBFS / 20.0) / std::f64::consts::SQRT_2;
        if self.position <= 0.0 {
            return VU_FLOOR_DB;
        }
        ((20.0 * (self.position / reference).log10()) as f32).max(VU_FLOOR_DB)
    }
}

/// VU の解析
#[derive(Debug, Default)]
pub struct VuAnalyzer {
    sample_rate: u32,
    needles: [Needle; 2],
}

impl VuAnalyzer {
    pub fn new() -> Self {
        Self::default()
    }

    fn restart(&mut self, sample_rate: u32) {
        self.sample_rate = sample_rate;
        self.needles = Default::default();
    }

    fn feed(&mut self, left: &[f32], right: &[f32]) {
        let dt = 1.0 / f64::from(self.sample_rate);
        for (needle, samples) in self.needles.iter_mut().zip([left, right]) {
            for x in samples {
                needle.step(f64::from(x.abs()) * RECTIFIED_TO_RMS, dt);
            }
        }
    }
}

impl Analyzer for VuAnalyzer {
    fn id(&self) -> SectionId {
        SectionId::Vu
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
        if new_frames > 0 && self.sample_rate > 0 {
            let (left, right) = window.latest(new_frames);
            self.feed(left, right);
        }
        out.push(self.needles[0].reading_db());
        out.push(self.needles[1].reading_db());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::test_signal::{silence, sine, stereo_window_with_new};

    const RATE: u32 = 48_000;
    /// 1回の解析で届くフレーム数（約60回/秒）
    const TICK: usize = 800;

    /// 信号を約60回/秒の解析に分けて流し、回ごとの結果を返す
    fn stream(analyzer: &mut VuAnalyzer, left: &[f32], right: &[f32]) -> Vec<[f32; 2]> {
        let ctx = AnalysisContext::new();
        let window_len = analyzer.window_frames(RATE);
        let mut results = Vec::new();
        let mut end = TICK;
        while end <= left.len() {
            let start = end.saturating_sub(window_len);
            let window = stereo_window_with_new(&left[start..end], &right[start..end], RATE, TICK);
            let mut out = SectionWriter::new();
            out.begin(SectionId::Vu);
            analyzer.process(&window, &ctx, &mut out);
            out.end();
            let v = out.section(SectionId::Vu).unwrap();
            results.push([v[0], v[1]]);
            end += TICK;
        }
        results
    }

    fn reference_amplitude() -> f32 {
        10f32.powf(VU_REFERENCE_DBFS as f32 / 20.0)
    }

    /// 解析の回の番号から、その回の終わりの時刻（秒）
    fn seconds(tick: usize) -> f64 {
        ((tick + 1) * TICK) as f64 / f64::from(RATE)
    }

    #[test]
    fn reference_sine_settles_at_zero_vu_and_channels_are_separate() {
        let s = sine(1_000.0, reference_amplitude(), RATE, RATE as usize * 2);
        let half = sine(1_000.0, reference_amplitude() * 0.5, RATE, s.len());
        let last = *stream(&mut VuAnalyzer::new(), &s, &half).last().unwrap();
        assert!(last[0].abs() < 0.05, "left {}", last[0]);
        assert!((last[1] + 6.02).abs() < 0.05, "right {}", last[1]);
    }

    #[test]
    fn needle_reaches_99_percent_in_about_300ms_with_a_small_overshoot() {
        let s = sine(1_000.0, reference_amplitude(), RATE, RATE as usize * 2);
        let results = stream(&mut VuAnalyzer::new(), &s, &s);
        let linear = |db: f32| 10f64.powf(f64::from(db) / 20.0);

        // 0.3 秒の前後の回で、99% を下から上へ越える（1回 = 約17ms）
        let first = results.iter().position(|r| linear(r[0]) >= 0.99).unwrap();
        let t = seconds(first);
        assert!((0.28..=0.32).contains(&t), "reached 99% at {t}s");

        // 行き過ぎは 1〜2%
        let peak = results.iter().map(|r| linear(r[0])).fold(0.0, f64::max);
        assert!((1.01..=1.02).contains(&peak), "overshoot {peak}");
    }

    #[test]
    fn silence_reads_the_floor_and_the_needle_falls_back_slowly() {
        let z = silence(RATE as usize);
        let first = *stream(&mut VuAnalyzer::new(), &z, &z).last().unwrap();
        assert_eq!(first, [VU_FLOOR_DB; 2]);

        // 1秒の音の後に無音：0.1 秒ではまだ戻りきらず、1秒後には目盛りの下端（−20）より下に戻る
        let mut s = sine(1_000.0, reference_amplitude(), RATE, RATE as usize);
        s.extend(silence(RATE as usize));
        let results = stream(&mut VuAnalyzer::new(), &s, &s);
        let ticks_per_second = RATE as usize / TICK;
        let soon = results[ticks_per_second + ticks_per_second / 10][0];
        assert!(soon > -10.0, "after 0.1s {soon}");
        let later = results.last().unwrap()[0];
        assert!(later < -20.0, "after 1s {later}");
    }

    #[test]
    fn stale_ticks_hold_the_needle_and_reset_or_rate_change_starts_over() {
        let mut analyzer = VuAnalyzer::new();
        let s = sine(1_000.0, reference_amplitude(), RATE, RATE as usize);
        let before = *stream(&mut analyzer, &s, &s).last().unwrap();

        // 新しいフレームが届いていない回は、針を動かさない
        let ctx = AnalysisContext::new();
        let mut out = SectionWriter::new();
        out.begin(SectionId::Vu);
        let window = stereo_window_with_new(&s[..4_800], &s[..4_800], RATE, 0);
        analyzer.process(&window, &ctx, &mut out);
        out.end();
        assert_eq!(out.section(SectionId::Vu).unwrap(), &before[..]);

        analyzer.reset();
        assert_eq!(analyzer.sample_rate, 0);
        assert_eq!(analyzer.needles[0].reading_db(), VU_FLOOR_DB);

        stream(&mut analyzer, &s, &s);
        let z = silence(9_600);
        let mut out = SectionWriter::new();
        out.begin(SectionId::Vu);
        analyzer.process(&stereo_window_with_new(&z, &z, 96_000, 0), &ctx, &mut out);
        out.end();
        assert_eq!(analyzer.sample_rate, 96_000);
        assert_eq!(out.section(SectionId::Vu).unwrap(), [VU_FLOOR_DB; 2]);
    }
}
