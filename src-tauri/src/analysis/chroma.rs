//! クロマ：12の音名ごとの強さと、今のコード・キーの推定
//!
//! セクション `Chroma` のペイロード（f32 × `CHROMA_LEN`）：
//!
//! ```text
//! [0 .. 12)  音名ごとの強さ（C, C♯, D, … , B の順。0〜1）
//! [12]       コードの根音（0〜11。0 = C）。推定できないときは CHROMA_NONE
//! [13]       コードの種類（CHORD_MAJOR / CHORD_MINOR）。推定できないときは CHROMA_NONE
//! [14]       キーの主音（0〜11）。推定できないときは CHROMA_NONE
//! [15]       キーの調（KEY_MAJOR / KEY_MINOR）。推定できないときは CHROMA_NONE
//! ```
//!
//! SPEC の「既知の制限」のとおり、近似で、正確な和声分析ではない。安定を優先し、追従の遅れは許容する。
//!
//! 1回の解析の中身：
//! 1. 音名ごとの強さ：共有の FFT の `CHROMA_MIN_HZ`〜`CHROMA_MAX_HZ` で、L・R の強さの平均の山（極大）を探し、
//!    前後の本数との放物線の当てはめで山の周波数を細かく求めて、いちばん近い音名にその振幅を足す。いちばん大きな
//!    山より 40 dB 以上小さい山は数えない。最大が1になるよう割る。範囲の強さの和が −60 dBFS 未満なら無音とし、
//!    すべて0とする
//! 2. 時間方向の平滑化：1 の値を、表示用（`DISPLAY_SECONDS`）・コード用（`CHORD_SECONDS`）・キー用
//!    （`KEY_SECONDS`）の3つの時定数で平滑化する。キー用は無音の間は動かさない（曲の切れ目で消えないように）
//! 3. コード：コード用の値と、長三和音・短三和音の型（24通り）の余弦の類似度を比べ、いちばん近いもの。
//!    音がない（コード用の値の最大が `CHORD_MIN_PRESENCE` 未満）か、類似度が `CHORD_MIN_SCORE` 未満なら、推定できない
//! 4. キー：キー用の値と、Krumhansl–Kessler の調の profile（長調・短調、24通り）の相関を比べ、いちばん高いもの。
//!    音のあった時間の合計が `KEY_MIN_SECONDS` に届くまでと、相関が `KEY_MIN_CORRELATION` 未満のときは、推定できない
//! 5. 安定させる：コードは `CHORD_HOLD_SECONDS`、キーは `KEY_HOLD_SECONDS` のあいだ同じ候補がいちばんであり続けた
//!    ときだけ切り替える
//!
//! 平滑化と切り替えの時間は、新しく届いたフレーム（`StereoWindow::new_frames`）の長さで進める。新しいフレームが
//! ない回は何も動かさず、前回の値を返す。解析を有効にし直したとき（`reset`）は、すべて捨てる。

use super::{AnalysisContext, Analyzer, SectionId, SectionWriter, StereoWindow};

/// 音名の数
pub const CHROMA_BINS: usize = 12;
/// ペイロードの長さ
pub const CHROMA_LEN: usize = CHROMA_BINS + 4;
/// 音名を数える範囲の下端（Hz）
pub const CHROMA_MIN_HZ: f32 = 80.0;
/// 音名を数える範囲の上端（Hz）
pub const CHROMA_MAX_HZ: f32 = 5_000.0;
/// 推定できないときの値
pub const CHROMA_NONE: f32 = -1.0;
/// コードの種類：長三和音
pub const CHORD_MAJOR: f32 = 0.0;
/// コードの種類：短三和音
pub const CHORD_MINOR: f32 = 1.0;
/// キーの調：長調
pub const KEY_MAJOR: f32 = 0.0;
/// キーの調：短調
pub const KEY_MINOR: f32 = 1.0;

/// 無音とみなす強さ（振幅の二乗の和。−60 dBFS）
const SILENCE_POWER: f32 = 1e-6;
/// 数える山の下限（いちばん大きな山の強さに対する比。−40 dB）
const PEAK_FLOOR_RATIO: f32 = 1e-4;

/// 表示用の平滑化の時定数（秒）
const DISPLAY_SECONDS: f64 = 0.15;
/// コード用の平滑化の時定数（秒）
const CHORD_SECONDS: f64 = 0.5;
/// コードを切り替えるまでに、同じ候補がいちばんであり続ける時間（秒）
const CHORD_HOLD_SECONDS: f64 = 0.3;
/// コードを推定する、コード用の値の最大の下限
const CHORD_MIN_PRESENCE: f32 = 0.3;
/// コードとみなす類似度の下限（どの音名も同じ強さのとき 0.5）
const CHORD_MIN_SCORE: f32 = 0.6;
/// キー用の平滑化の時定数（秒）
const KEY_SECONDS: f64 = 8.0;
/// キーを切り替えるまでに、同じ候補がいちばんであり続ける時間（秒）
const KEY_HOLD_SECONDS: f64 = 2.0;
/// キーを推定し始める、音のあった時間の合計（秒）
const KEY_MIN_SECONDS: f64 = 1.0;
/// キーとみなす相関の下限
const KEY_MIN_CORRELATION: f32 = 0.5;
/// 1回の解析で進める時間の上限（秒）。解析が遅れても、一度に大きく動かない
const MAX_STEP_SECONDS: f64 = 0.1;

/// 長三和音・短三和音の構成音（根音からの半音の数）
const CHORD_TONES: [[usize; 3]; 2] = [[0, 4, 7], [0, 3, 7]];

/// Krumhansl–Kessler の調の profile（主音から半音ずつ）。長調・短調
const KEY_PROFILES: [[f32; CHROMA_BINS]; 2] = [
    [
        6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
    ],
    [
        6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
    ],
];

/// 候補が一定の時間いちばんであり続けたときだけ切り替える選択
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct Stable {
    current: Option<usize>,
    candidate: Option<usize>,
    held: f64,
}

impl Stable {
    fn update(&mut self, best: Option<usize>, dt: f64, hold: f64) {
        if best == self.current {
            self.candidate = best;
            self.held = 0.0;
            return;
        }
        if best == self.candidate {
            self.held += dt;
        } else {
            self.candidate = best;
            self.held = dt;
        }
        if self.held >= hold {
            self.current = best;
            self.held = 0.0;
        }
    }
}

/// 周波数（Hz）の音名（0 = C）
fn pitch_class(hz: f32) -> usize {
    let midi = 69.0 + 12.0 * (hz / 440.0).log2();
    (midi.round() as i64).rem_euclid(CHROMA_BINS as i64) as usize
}

/// 今の FFT から、音名ごとの強さ（最大が1）を求める。無音なら `false` を返し、すべて0にする
fn frame_chroma(
    ctx: &AnalysisContext,
    average: &mut Vec<f32>,
    out: &mut [f32; CHROMA_BINS],
) -> bool {
    out.fill(0.0);
    average.clear();
    average.extend(
        ctx.power_left()
            .iter()
            .zip(ctx.power_right())
            .map(|(l, r)| (l + r) * 0.5),
    );
    let bin_hz = ctx.bin_hz();
    if bin_hz <= 0.0 || average.len() < 4 {
        return false;
    }
    let first = ((CHROMA_MIN_HZ / bin_hz).ceil() as usize).max(2);
    let last = ((CHROMA_MAX_HZ / bin_hz).floor() as usize).min(average.len() - 2);
    if first > last {
        return false;
    }
    let range = &average[first..=last];
    if range.iter().sum::<f32>() < SILENCE_POWER {
        return false;
    }
    let is_peak = |k: usize| average[k] > average[k - 1] && average[k] >= average[k + 1];
    let loudest = (first..=last)
        .filter(|k| is_peak(*k))
        .map(|k| average[k])
        .fold(0.0f32, f32::max);
    let floor = loudest * PEAK_FLOOR_RATIO;
    for k in first..=last {
        if !is_peak(k) || average[k] <= floor {
            continue;
        }
        let (a, b, c) = (average[k - 1], average[k], average[k + 1]);
        // 強さの対数に放物線を当てはめ、山の位置を本数の間で求める（ハン窓では、ずれは本数の数%）
        let offset = if a > 0.0 && c > 0.0 {
            let (la, lb, lc) = (a.ln(), b.ln(), c.ln());
            let denom = la - 2.0 * lb + lc;
            if denom < 0.0 {
                (0.5 * (la - lc) / denom).clamp(-0.5, 0.5)
            } else {
                0.0
            }
        } else {
            0.0
        };
        let hz = (k as f32 + offset) * bin_hz;
        out[pitch_class(hz)] += (a + b + c).sqrt();
    }
    let max = out.iter().copied().fold(0.0f32, f32::max);
    if max <= 0.0 {
        return false;
    }
    for v in out.iter_mut() {
        *v /= max;
    }
    true
}

/// 余弦の類似度がいちばん高いコード（根音 + 12 × 種類）と、その類似度
fn best_chord(chroma: &[f32; CHROMA_BINS]) -> (usize, f32) {
    let norm = chroma.iter().map(|v| v * v).sum::<f32>().sqrt();
    let mut best = (0, f32::MIN);
    for (quality, tones) in CHORD_TONES.iter().enumerate() {
        for root in 0..CHROMA_BINS {
            let dot: f32 = tones.iter().map(|t| chroma[(root + t) % CHROMA_BINS]).sum();
            let score = if norm > 0.0 {
                dot / (norm * (tones.len() as f32).sqrt())
            } else {
                0.0
            };
            if score > best.1 {
                best = (root + CHROMA_BINS * quality, score);
            }
        }
    }
    best
}

/// 相関がいちばん高いキー（主音 + 12 × 調）と、その相関
fn best_key(chroma: &[f32; CHROMA_BINS]) -> (usize, f32) {
    let mut best = (0, f32::MIN);
    for (mode, profile) in KEY_PROFILES.iter().enumerate() {
        for tonic in 0..CHROMA_BINS {
            let r = correlation(chroma, |i| profile[(i + CHROMA_BINS - tonic) % CHROMA_BINS]);
            if r > best.1 {
                best = (tonic + CHROMA_BINS * mode, r);
            }
        }
    }
    best
}

/// ピアソンの相関。どちらかが一定なら 0
fn correlation(x: &[f32; CHROMA_BINS], y: impl Fn(usize) -> f32) -> f32 {
    let n = CHROMA_BINS as f32;
    let mx = x.iter().sum::<f32>() / n;
    let my = (0..CHROMA_BINS).map(&y).sum::<f32>() / n;
    let (mut sxy, mut sxx, mut syy) = (0.0, 0.0, 0.0);
    for (i, xi) in x.iter().enumerate() {
        let (dx, dy) = (xi - mx, y(i) - my);
        sxy += dx * dy;
        sxx += dx * dx;
        syy += dy * dy;
    }
    if sxx <= 0.0 || syy <= 0.0 {
        0.0
    } else {
        sxy / (sxx * syy).sqrt()
    }
}

fn smooth(state: &mut [f32; CHROMA_BINS], target: &[f32; CHROMA_BINS], dt: f64, seconds: f64) {
    let alpha = (1.0 - (-dt / seconds).exp()) as f32;
    for (s, t) in state.iter_mut().zip(target) {
        *s += (t - *s) * alpha;
    }
}

/// クロマの解析
#[derive(Debug, Default)]
pub struct ChromaAnalyzer {
    average: Vec<f32>,
    display: [f32; CHROMA_BINS],
    chord_chroma: [f32; CHROMA_BINS],
    key_chroma: [f32; CHROMA_BINS],
    /// 音のあった時間の合計（秒）
    voiced_seconds: f64,
    chord: Stable,
    key: Stable,
}

impl ChromaAnalyzer {
    pub fn new() -> Self {
        Self::default()
    }

    fn update(&mut self, ctx: &AnalysisContext, dt: f64) {
        let mut frame = [0.0; CHROMA_BINS];
        let voiced = frame_chroma(ctx, &mut self.average, &mut frame);

        smooth(&mut self.display, &frame, dt, DISPLAY_SECONDS);
        smooth(&mut self.chord_chroma, &frame, dt, CHORD_SECONDS);
        let presence = self.chord_chroma.iter().copied().fold(0.0f32, f32::max);
        let chord = (presence >= CHORD_MIN_PRESENCE)
            .then(|| best_chord(&self.chord_chroma))
            .filter(|(_, score)| *score >= CHORD_MIN_SCORE)
            .map(|(chord, _)| chord);
        self.chord.update(chord, dt, CHORD_HOLD_SECONDS);

        if voiced {
            smooth(&mut self.key_chroma, &frame, dt, KEY_SECONDS);
            self.voiced_seconds += dt;
            let key = (self.voiced_seconds >= KEY_MIN_SECONDS)
                .then(|| best_key(&self.key_chroma))
                .filter(|(_, r)| *r >= KEY_MIN_CORRELATION)
                .map(|(key, _)| key);
            self.key.update(key, dt, KEY_HOLD_SECONDS);
        }
    }
}

/// 「根音（主音）+ 12 × 種類（調）」を、ペイロードの2つの値にする
fn split(choice: Option<usize>) -> [f32; 2] {
    match choice {
        Some(v) => [(v % CHROMA_BINS) as f32, (v / CHROMA_BINS) as f32],
        None => [CHROMA_NONE; 2],
    }
}

impl Analyzer for ChromaAnalyzer {
    fn id(&self) -> SectionId {
        SectionId::Chroma
    }

    fn uses_fft(&self) -> bool {
        true
    }

    fn reset(&mut self) {
        *self = Self::default();
    }

    fn process(&mut self, window: &StereoWindow, ctx: &AnalysisContext, out: &mut SectionWriter) {
        let rate = window.sample_rate();
        if ctx.is_ready() && window.new_frames() > 0 && rate > 0 {
            let dt = (window.new_frames() as f64 / f64::from(rate)).min(MAX_STEP_SECONDS);
            self.update(ctx, dt);
        }
        out.extend_from_slice(&self.display);
        out.extend_from_slice(&split(self.chord.current));
        out.extend_from_slice(&split(self.key.current));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::fft_size_for;
    use crate::analysis::test_signal::{run_one, stereo_window_with_new};

    const RATE: u32 = 48_000;
    /// 1回の解析で届くフレーム数（約60回/秒）
    const TICK: usize = 800;

    /// 正弦波の和（周波数の一覧、振幅はそれぞれ `amplitude`）
    fn tones(hz: &[f32], amplitude: f32, frames: usize) -> Vec<f32> {
        (0..frames)
            .map(|n| {
                let t = n as f64 / f64::from(RATE);
                hz.iter()
                    .map(|f| amplitude as f64 * (std::f64::consts::TAU * f64::from(*f) * t).sin())
                    .sum::<f64>() as f32
            })
            .collect()
    }

    fn midi_hz(note: i32) -> f32 {
        440.0 * 2f32.powf((note - 69) as f32 / 12.0)
    }

    /// 信号を約60回/秒の解析に分けて流し、回ごとのペイロードを返す
    fn stream(analyzer: &mut ChromaAnalyzer, signal: &[f32]) -> Vec<Vec<f32>> {
        let size = fft_size_for(RATE);
        let mut ctx = AnalysisContext::new();
        let mut results = Vec::new();
        let mut end = TICK;
        while end <= signal.len() {
            let start = end.saturating_sub(size);
            let window =
                stereo_window_with_new(&signal[start..end], &signal[start..end], RATE, TICK);
            ctx.prepare(&window);
            let mut out = SectionWriter::new();
            out.begin(SectionId::Chroma);
            analyzer.process(&window, &ctx, &mut out);
            out.end();
            results.push(out.section(SectionId::Chroma).unwrap().to_vec());
            end += TICK;
        }
        results
    }

    fn loudest(chroma: &[f32]) -> usize {
        (0..CHROMA_BINS)
            .max_by(|a, b| chroma[*a].total_cmp(&chroma[*b]))
            .unwrap()
    }

    /// 三和音（根音の MIDI の番号と、種類）
    fn triad(root: i32, quality: usize) -> Vec<f32> {
        CHORD_TONES[quality]
            .iter()
            .map(|t| midi_hz(root + *t as i32))
            .collect()
    }

    #[test]
    fn pitch_classes_follow_equal_temperament_from_c() {
        assert_eq!(pitch_class(261.63), 0); // C4
        assert_eq!(pitch_class(440.0), 9); // A4
        assert_eq!(pitch_class(466.16), 10); // A♯4
        assert_eq!(pitch_class(987.77), 11); // B5
        assert_eq!(pitch_class(1_000.0), 11); // B5 より 32 セント高い
        assert_eq!(pitch_class(130.81), 0); // C3
    }

    #[test]
    fn single_tones_land_on_their_pitch_class() {
        for (note, expected) in [(60, 0), (64, 4), (69, 9), (83, 11), (50, 2)] {
            let s = tones(&[midi_hz(note)], 0.3, 4_096);
            let v = run_one(&mut ChromaAnalyzer::new(), &s, &s, RATE, TICK);
            assert_eq!(v.len(), CHROMA_LEN);
            assert_eq!(loudest(&v), expected, "note {note}: {:?}", &v[..12]);
        }
    }

    #[test]
    fn triads_are_recognized_after_the_hold_and_silence_clears_the_chord() {
        // C5 の長三和音
        let s = tones(&triad(72, 0), 0.2, RATE as usize);
        let results = stream(&mut ChromaAnalyzer::new(), &s);
        // 平滑化と切り替えの待ちで、最初の数回は推定できない
        assert_eq!(results[0][12..14], [CHROMA_NONE; 2]);
        let last = results.last().unwrap();
        assert_eq!(last[12..14], [0.0, CHORD_MAJOR]);
        // 構成音が強く、それ以外は弱い
        for n in [0, 4, 7] {
            assert!(last[n] > 0.6, "tone {n}: {}", last[n]);
        }
        assert!(last[2] < 0.2 && last[9] < 0.2);

        // A4 の短三和音
        let s = tones(&triad(69, 1), 0.2, RATE as usize);
        let last = stream(&mut ChromaAnalyzer::new(), &s).pop().unwrap();
        assert_eq!(last[12..14], [9.0, CHORD_MINOR]);

        // 和音の後の無音：表示は0に戻り、コードは推定できなくなる
        let mut s = tones(&triad(72, 0), 0.2, RATE as usize);
        s.extend(vec![0.0; RATE as usize * 2]);
        let last = stream(&mut ChromaAnalyzer::new(), &s).pop().unwrap();
        assert!(last[..12].iter().all(|v| *v < 0.01), "{:?}", &last[..12]);
        assert_eq!(last[12..14], [CHROMA_NONE; 2]);
    }

    #[test]
    fn a_short_blip_of_another_chord_does_not_switch() {
        let mut s = tones(&triad(72, 0), 0.2, RATE as usize);
        s.extend(tones(&triad(69, 1), 0.2, RATE as usize / 10));
        s.extend(tones(&triad(72, 0), 0.2, RATE as usize / 2));
        let results = stream(&mut ChromaAnalyzer::new(), &s);
        let settled = (RATE as usize / TICK) - 1;
        for (i, r) in results.iter().enumerate().skip(settled) {
            assert_eq!(r[12..14], [0.0, CHORD_MAJOR], "tick {i}");
        }
    }

    /// 1小節2秒の進行を `repeats` 回くり返す
    fn progression(chords: &[(i32, usize)], repeats: usize) -> Vec<f32> {
        let mut s = Vec::new();
        for _ in 0..repeats {
            for (root, quality) in chords {
                // 低い根音も足す（低音の支え）
                let mut hz = triad(*root, *quality);
                hz.push(midi_hz(root - 12));
                s.extend(tones(&hz, 0.15, RATE as usize * 2));
            }
        }
        s
    }

    #[test]
    fn key_is_estimated_from_a_progression_and_held_through_silence() {
        // C - F - G - C（ハ長調）
        let mut s = progression(&[(72, 0), (65, 0), (67, 0), (72, 0)], 2);
        let results = stream(&mut ChromaAnalyzer::new(), &s);
        // 推定し始めるまで（音のあった時間 1 秒と、切り替えの待ち 2 秒）は推定できない
        assert_eq!(results[60][14..16], [CHROMA_NONE; 2]);
        assert_eq!(results.last().unwrap()[14..16], [0.0, KEY_MAJOR]);

        // 無音の間もキーは残る
        s.extend(vec![0.0; RATE as usize * 3]);
        let last = stream(&mut ChromaAnalyzer::new(), &s).pop().unwrap();
        assert_eq!(last[14..16], [0.0, KEY_MAJOR]);

        // Am - Dm - E - Am（イ短調。E の G♯ でハ長調と分かれる）
        let s = progression(&[(69, 1), (62, 1), (64, 0), (69, 1)], 2);
        let last = stream(&mut ChromaAnalyzer::new(), &s).pop().unwrap();
        assert_eq!(last[14..16], [9.0, KEY_MINOR]);
    }

    #[test]
    fn silence_and_stale_ticks_and_reset() {
        let z = vec![0.0; RATE as usize];
        let last = stream(&mut ChromaAnalyzer::new(), &z).pop().unwrap();
        assert_eq!(last[..12], [0.0; 12]);
        assert_eq!(last[12..], [CHROMA_NONE; 4]);

        let mut analyzer = ChromaAnalyzer::new();
        let s = tones(&triad(72, 0), 0.2, RATE as usize);
        let before = stream(&mut analyzer, &s).pop().unwrap();

        // 新しいフレームが届いていない回は、何も動かさない
        let after = run_one(&mut analyzer, &z[..4_096], &z[..4_096], RATE, 0);
        assert_eq!(after, before);

        analyzer.reset();
        let cleared = run_one(&mut analyzer, &z[..4_096], &z[..4_096], RATE, 0);
        assert_eq!(cleared[..12], [0.0; 12]);
        assert_eq!(cleared[12..], [CHROMA_NONE; 4]);
    }

    #[test]
    fn hold_switches_only_after_the_candidate_persists() {
        let mut s = Stable::default();
        s.update(Some(3), 0.1, 0.3);
        s.update(Some(3), 0.1, 0.3);
        assert_eq!(s.current, None);
        s.update(Some(3), 0.1, 0.3);
        assert_eq!(s.current, Some(3));
        // 別の候補がいちばんであり続けないと切り替えない
        s.update(Some(5), 0.2, 0.3);
        s.update(Some(3), 0.2, 0.3);
        s.update(Some(5), 0.2, 0.3);
        assert_eq!(s.current, Some(3));
    }
}
