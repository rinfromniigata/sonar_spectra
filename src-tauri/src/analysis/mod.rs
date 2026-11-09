//! 解析（analysis）
//!
//! 入力源から受けたサンプルの窓を、解析の種類ごとのセクションにまとめる。解析は種類ごとに
//! ファイルを分け、`default_analyzers` に登録する。解析を追加するときは、ファイルを足して
//! 登録し、`SectionId` に値を足すだけで、既存の解析に手を入れない。
//!
//! 1回の解析の流れ（`Pipeline::process`）：
//! 1. 有効な解析のどれかが FFT を使うなら、`AnalysisContext` で FFT を1度だけ計算する
//! 2. 有効な解析を登録順に回し、それぞれ自分のセクションを `SectionWriter` に書き出す

mod bands;
mod centroid;
mod chroma;
mod context;
mod level;
mod loudness;
mod section;
mod spectrum;
mod stereo;
mod vu;
mod waveform;
mod window;

pub use bands::LogBands;
pub use centroid::{CENTROID_LEN, CENTROID_MAX_HZ, CENTROID_MIN_HZ, CentroidAnalyzer};
pub use chroma::{
    CHORD_MAJOR, CHORD_MINOR, CHROMA_BINS, CHROMA_LEN, CHROMA_MAX_HZ, CHROMA_MIN_HZ, CHROMA_NONE,
    ChromaAnalyzer, KEY_MAJOR, KEY_MINOR,
};
pub use context::{AnalysisContext, fft_size_for};
pub use level::{LEVEL_LEN, LevelAnalyzer};
pub use loudness::{
    LOUDNESS_FLOOR_DB, LOUDNESS_LEN, LoudnessAnalyzer, MOMENTARY_SECONDS, SHORT_TERM_SECONDS,
};
pub use section::{SectionId, SectionWriter};
pub use spectrum::{
    SPECTRUM_BANDS, SPECTRUM_LEN, SPECTRUM_MAX_HZ, SPECTRUM_MIN_HZ, SpectrumAnalyzer,
};
pub use stereo::{
    CORRELATION_SECONDS, LISSAJOUS_POINTS, LISSAJOUS_SECONDS, PAN_BANDS, PAN_MAX_HZ, PAN_MIN_HZ,
    STEREO_CORRELATION, STEREO_LEN, STEREO_LISSAJOUS_X, STEREO_LISSAJOUS_Y, STEREO_PAN,
    STEREO_PAN_LEVEL, StereoAnalyzer,
};
pub use vu::{
    VU_DAMPING, VU_FLOOR_DB, VU_LEN, VU_NATURAL_RAD_PER_SEC, VU_REFERENCE_DBFS, VuAnalyzer,
};
pub use waveform::{
    BAND_HIGH_MAX_HZ, BAND_LOW_MAX_HZ, BAND_MID_MAX_HZ, WAVE_LEN, WAVE_NOW_POINTS,
    WAVE_NOW_SECONDS, WAVE_SUMMARY_LEN, WaveformAnalyzer,
};
pub use window::StereoWindow;

/// 1種類の解析
pub trait Analyzer: Send {
    /// 書き出すセクション
    fn id(&self) -> SectionId;

    /// 共有の FFT（`AnalysisContext`）を使うか。使うなら、`process` の前に計算済みになっている
    fn uses_fft(&self) -> bool {
        false
    }

    /// 窓に必要なフレーム数（FFT の分は除く）
    fn window_frames(&self, _sample_rate: u32) -> usize {
        0
    }

    /// 状態を捨てる。止めていた解析を有効にし直したときに呼ばれる（止めていた間のサンプルは数えていないため）。
    /// 状態を持たない解析は何もしない
    fn reset(&mut self) {}

    /// 最新のサンプル窓を受けて、自分のセクションを書き出す
    fn process(&mut self, window: &StereoWindow, ctx: &AnalysisContext, out: &mut SectionWriter);
}

/// 登録済みの解析（登録順に回り、セクションもこの順に並ぶ）
pub fn default_analyzers() -> Vec<Box<dyn Analyzer>> {
    vec![
        Box::new(LevelAnalyzer::new()),
        Box::new(WaveformAnalyzer::new()),
        Box::new(SpectrumAnalyzer::new()),
        Box::new(StereoAnalyzer::new()),
        Box::new(LoudnessAnalyzer::new()),
        Box::new(VuAnalyzer::new()),
        Box::new(ChromaAnalyzer::new()),
        Box::new(CentroidAnalyzer::new()),
    ]
}

/// 解析の一式と、有効な解析の切り替え
pub struct Pipeline {
    analyzers: Vec<Box<dyn Analyzer>>,
    active: Vec<bool>,
    ctx: AnalysisContext,
}

impl Default for Pipeline {
    fn default() -> Self {
        Self::new(default_analyzers())
    }
}

impl Pipeline {
    /// 作った時点では、すべての解析が有効
    pub fn new(analyzers: Vec<Box<dyn Analyzer>>) -> Self {
        let active = vec![true; analyzers.len()];
        Self {
            analyzers,
            active,
            ctx: AnalysisContext::new(),
        }
    }

    /// 有効にするセクションを、UI から届いた値の一覧で指定する（`set_active_sections`）。
    /// 一覧にない解析は止める。知らない値は無視する。止めていた解析を有効にし直すときは、その状態を捨てる
    pub fn set_active_sections(&mut self, ids: &[u8]) {
        let wanted: Vec<SectionId> = ids.iter().filter_map(|v| SectionId::from_u8(*v)).collect();
        for (analyzer, active) in self.analyzers.iter_mut().zip(self.active.iter_mut()) {
            let next = wanted.contains(&analyzer.id());
            if next && !*active {
                analyzer.reset();
            }
            *active = next;
        }
    }

    /// 有効なセクション（登録順）
    pub fn active_sections(&self) -> Vec<SectionId> {
        self.active_analyzers().map(|a| a.id()).collect()
    }

    fn active_analyzers(&self) -> impl Iterator<Item = &Box<dyn Analyzer>> {
        self.analyzers
            .iter()
            .zip(&self.active)
            .filter(|(_, active)| **active)
            .map(|(a, _)| a)
    }

    /// 有効な解析に必要な窓の長さ（フレーム数）
    pub fn window_frames(&self, sample_rate: u32) -> usize {
        let mut frames = 0;
        let mut uses_fft = false;
        for analyzer in self.active_analyzers() {
            frames = frames.max(analyzer.window_frames(sample_rate));
            uses_fft |= analyzer.uses_fft();
        }
        if uses_fft {
            frames = frames.max(fft_size_for(sample_rate));
        }
        frames
    }

    /// 窓を解析し、有効な解析のセクションを `out` に書き出す（`out` の前回の中身は捨てる）
    ///
    /// 形式が決まっていない（サンプルレートが0の）窓では、何も書き出さない。
    pub fn process(&mut self, window: &StereoWindow, out: &mut SectionWriter) {
        out.clear();
        self.ctx.invalidate();
        if window.sample_rate() == 0 {
            return;
        }
        if self.active_analyzers().any(|a| a.uses_fft()) {
            self.ctx.prepare(window);
        }
        for (analyzer, active) in self.analyzers.iter_mut().zip(&self.active) {
            if !*active {
                continue;
            }
            out.begin(analyzer.id());
            analyzer.process(window, &self.ctx, out);
            out.end();
        }
    }
}

/// テスト用の信号
#[cfg(test)]
pub(crate) mod test_signal {
    use super::{AnalysisContext, Analyzer, SectionWriter, StereoWindow};

    pub fn sine(hz: f32, amplitude: f32, sample_rate: u32, frames: usize) -> Vec<f32> {
        (0..frames)
            .map(|n| {
                let t = n as f64 / f64::from(sample_rate);
                (amplitude as f64 * (std::f64::consts::TAU * f64::from(hz) * t).sin()) as f32
            })
            .collect()
    }

    pub fn silence(frames: usize) -> Vec<f32> {
        vec![0.0; frames]
    }

    pub fn stereo_window(left: &[f32], right: &[f32], sample_rate: u32) -> StereoWindow {
        stereo_window_with_new(left, right, sample_rate, left.len())
    }

    pub fn stereo_window_with_new(
        left: &[f32],
        right: &[f32],
        sample_rate: u32,
        new_frames: usize,
    ) -> StereoWindow {
        let interleaved: Vec<f32> = left.iter().zip(right).flat_map(|(l, r)| [*l, *r]).collect();
        let mut window = StereoWindow::new();
        window.fill_from_interleaved(&interleaved, sample_rate, new_frames);
        window
    }

    /// 1つの解析だけを、必要なら FFT を計算してから回し、ペイロードを返す
    pub fn run_one(
        analyzer: &mut dyn Analyzer,
        left: &[f32],
        right: &[f32],
        sample_rate: u32,
        new_frames: usize,
    ) -> Vec<f32> {
        let window = stereo_window_with_new(left, right, sample_rate, new_frames);
        let mut ctx = AnalysisContext::new();
        if analyzer.uses_fft() {
            ctx.prepare(&window);
        }
        let mut out = SectionWriter::new();
        out.begin(analyzer.id());
        analyzer.process(&window, &ctx, &mut out);
        out.end();
        out.section(analyzer.id()).unwrap().to_vec()
    }
}

#[cfg(test)]
mod tests {
    use super::test_signal::{sine, stereo_window_with_new};
    use super::*;

    const RATE: u32 = 48_000;

    fn window_for(pipeline: &Pipeline) -> StereoWindow {
        let frames = pipeline.window_frames(RATE);
        let s = sine(1_000.0, 0.5, RATE, frames);
        stereo_window_with_new(&s, &s, RATE, 800)
    }

    #[test]
    fn all_registered_sections_are_written_in_order() {
        let mut pipeline = Pipeline::default();
        let mut out = SectionWriter::new();
        pipeline.process(&window_for(&pipeline), &mut out);

        let ids: Vec<_> = out.sections().map(|(id, _)| id).collect();
        assert_eq!(ids, SectionId::ALL);
        assert_eq!(out.section(SectionId::Level).unwrap().len(), LEVEL_LEN);
        assert_eq!(out.section(SectionId::Waveform).unwrap().len(), WAVE_LEN);
        assert_eq!(
            out.section(SectionId::Spectrum).unwrap().len(),
            SPECTRUM_LEN
        );
        assert_eq!(out.section(SectionId::Stereo).unwrap().len(), STEREO_LEN);
        assert_eq!(
            out.section(SectionId::Loudness).unwrap().len(),
            LOUDNESS_LEN
        );
        assert_eq!(out.section(SectionId::Vu).unwrap().len(), VU_LEN);
        assert_eq!(out.section(SectionId::Chroma).unwrap().len(), CHROMA_LEN);
        assert_eq!(
            out.section(SectionId::Centroid).unwrap().len(),
            CENTROID_LEN
        );
    }

    /// `reset` が呼ばれた回数を数える解析
    struct CountResets(std::sync::Arc<std::sync::atomic::AtomicUsize>);

    impl Analyzer for CountResets {
        fn id(&self) -> SectionId {
            SectionId::Loudness
        }
        fn reset(&mut self) {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
        fn process(&mut self, _: &StereoWindow, _: &AnalysisContext, _: &mut SectionWriter) {}
    }

    #[test]
    fn reactivated_analyzers_are_reset_once() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let resets = std::sync::Arc::new(AtomicUsize::new(0));
        let mut pipeline = Pipeline::new(vec![Box::new(CountResets(resets.clone()))]);
        let id = SectionId::Loudness.as_u8();

        // 有効のまま指定し直しても呼ばれない
        pipeline.set_active_sections(&[id]);
        assert_eq!(resets.load(Ordering::SeqCst), 0);
        // 止めてから有効にし直すと1度だけ呼ばれる
        pipeline.set_active_sections(&[]);
        pipeline.set_active_sections(&[id]);
        pipeline.set_active_sections(&[id]);
        assert_eq!(resets.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn inactive_sections_are_skipped_and_unknown_ids_ignored() {
        let mut pipeline = Pipeline::default();
        pipeline.set_active_sections(&[SectionId::Level.as_u8(), 200]);
        assert_eq!(pipeline.active_sections(), [SectionId::Level]);

        let mut out = SectionWriter::new();
        pipeline.process(&window_for(&pipeline), &mut out);
        let ids: Vec<_> = out.sections().map(|(id, _)| id).collect();
        assert_eq!(ids, [SectionId::Level]);
        // FFT を使う解析がないので、FFT は計算しない（ラウドネスも FFT を使わない）
        assert!(!pipeline.ctx.is_ready());

        pipeline.set_active_sections(&[]);
        pipeline.process(&window_for(&pipeline), &mut out);
        assert_eq!(out.sections().count(), 0);
    }

    #[test]
    fn window_frames_cover_the_fft_only_when_needed() {
        let mut pipeline = Pipeline::default();
        assert_eq!(pipeline.window_frames(RATE), 4_800); // レベル・相関・ラウドネスの約0.1秒 > FFT の 2048
        assert_eq!(pipeline.window_frames(192_000), 19_200);

        pipeline.set_active_sections(&[SectionId::Waveform.as_u8()]);
        assert_eq!(pipeline.window_frames(RATE), 2_048);

        pipeline.set_active_sections(&[SectionId::Spectrum.as_u8()]);
        assert_eq!(pipeline.window_frames(RATE), 2_048);

        // クロマ・重心は FFT の分だけ、VU はレベルと同じ約0.1秒
        pipeline.set_active_sections(&[SectionId::Chroma.as_u8(), SectionId::Centroid.as_u8()]);
        assert_eq!(pipeline.window_frames(RATE), 2_048);
        pipeline.set_active_sections(&[SectionId::Vu.as_u8()]);
        assert_eq!(pipeline.window_frames(RATE), 4_800);

        pipeline.set_active_sections(&[]);
        assert_eq!(pipeline.window_frames(RATE), 0);
    }

    #[test]
    fn window_without_a_format_writes_nothing() {
        let mut pipeline = Pipeline::default();
        let mut out = SectionWriter::new();
        let empty = StereoWindow::new();
        pipeline.process(&empty, &mut out);
        assert_eq!(out.sections().count(), 0);
    }
}
