//! 位相：リサージュの点列、相関、周波数別の定位
//!
//! セクション `Stereo` のペイロード（f32 × `STEREO_LEN`）：
//!
//! ```text
//! [0]                       相関（−1〜1。1 = L と R が同じ、0 = 無関係・片側だけ・無音、−1 = 逆位相）
//! [X .. X+P)                リサージュの点の横（(R − L)/√2。右が正）     X = STEREO_LISSAJOUS_X
//! [Y .. Y+P)                リサージュの点の縦（(L + R)/√2。上が正）     Y = STEREO_LISSAJOUS_Y
//! [PAN .. PAN+B)            周波数別の定位（−1 = 左だけ、0 = 中央、1 = 右だけ。低い順）  PAN = STEREO_PAN
//! [PAN_LEVEL .. PAN_LEVEL+B) 周波数別の振幅（線形。1.0 がフルスケール）       PAN_LEVEL = STEREO_PAN_LEVEL
//! ```
//!
//! P は `LISSAJOUS_POINTS`、B は `PAN_BANDS`。
//!
//! - リサージュ：直近 `LISSAJOUS_SECONDS` 秒のサンプルから P 個を等間隔に取り出した点（古い順）。平均せずに
//!   そのままのサンプルを使う（高域の振れ幅を縮めないため）。モノラルの信号は縦の線（横が0）、L だけは
//!   左上から右下への斜めの線、逆位相は横の線になる。画面の大きさへの写し方は UI 側で行う
//! - 相関：直近 `CORRELATION_SECONDS` 秒の Σlr / √(Σl²·Σr²)。どちらかがほぼ無音なら 0
//! - 周波数別の定位：`PAN_MIN_HZ` 〜 `PAN_MAX_HZ` を対数で B 等分した帯域（`bands.rs`）ごとに、L・R の振幅
//!   aL・aR から `4/π·atan2(aR, aL) − 1` で求める（等パワーのパンの角度に比例する）。帯域がほぼ無音なら 0。
//!   振幅は L・R のエネルギーの平均（スペクトラムと同じ換算）。点の大きさと色の決め方は UI 側で行う

use super::bands::LogBands;
use super::spectrum::ensure_bands;
use super::{AnalysisContext, Analyzer, SectionId, SectionWriter, StereoWindow};

/// リサージュの点の数
pub const LISSAJOUS_POINTS: usize = 256;
/// リサージュが表す時間（秒）
pub const LISSAJOUS_SECONDS: f64 = 0.02;
/// 相関を求める時間（秒）
pub const CORRELATION_SECONDS: f64 = 0.1;
/// 周波数別の定位の帯域の数
pub const PAN_BANDS: usize = 120;
/// 周波数別の定位のいちばん低い帯域の下端（Hz）
pub const PAN_MIN_HZ: f32 = 30.0;
/// 周波数別の定位のいちばん高い帯域の上端（Hz）
pub const PAN_MAX_HZ: f32 = 20_000.0;

/// 相関の位置
pub const STEREO_CORRELATION: usize = 0;
/// リサージュの横の始まり
pub const STEREO_LISSAJOUS_X: usize = 1;
/// リサージュの縦の始まり
pub const STEREO_LISSAJOUS_Y: usize = STEREO_LISSAJOUS_X + LISSAJOUS_POINTS;
/// 周波数別の定位の始まり
pub const STEREO_PAN: usize = STEREO_LISSAJOUS_Y + LISSAJOUS_POINTS;
/// 周波数別の振幅の始まり
pub const STEREO_PAN_LEVEL: usize = STEREO_PAN + PAN_BANDS;
/// ペイロードの長さ
pub const STEREO_LEN: usize = STEREO_PAN_LEVEL + PAN_BANDS;

/// これより小さいエネルギー（振幅の二乗）は無音とみなす（約 −120 dBFS）
const SILENT_POWER: f32 = 1e-12;

/// 位相の解析
#[derive(Debug, Default)]
pub struct StereoAnalyzer {
    bands: Option<LogBands>,
}

impl StereoAnalyzer {
    pub fn new() -> Self {
        Self::default()
    }
}

fn frames_for(sample_rate: u32, seconds: f64) -> usize {
    ((f64::from(sample_rate) * seconds).round() as usize).max(1)
}

/// 相関（−1〜1）。どちらかがほぼ無音なら 0
fn correlation(left: &[f32], right: &[f32]) -> f32 {
    let (mut lr, mut ll, mut rr) = (0.0f64, 0.0f64, 0.0f64);
    for (l, r) in left.iter().zip(right) {
        let (l, r) = (f64::from(*l), f64::from(*r));
        lr += l * r;
        ll += l * l;
        rr += r * r;
    }
    let n = left.len().max(1) as f64;
    let floor = f64::from(SILENT_POWER) * n;
    if ll <= floor || rr <= floor {
        return 0.0;
    }
    (lr / (ll * rr).sqrt()).clamp(-1.0, 1.0) as f32
}

/// 定位（−1〜1）。L・R のエネルギーから求める。ほぼ無音なら 0
fn pan_of(power_l: f32, power_r: f32) -> f32 {
    if power_l + power_r <= SILENT_POWER {
        return 0.0;
    }
    let angle = power_r.sqrt().atan2(power_l.sqrt());
    (angle * 4.0 / std::f32::consts::PI - 1.0).clamp(-1.0, 1.0)
}

impl Analyzer for StereoAnalyzer {
    fn id(&self) -> SectionId {
        SectionId::Stereo
    }

    fn uses_fft(&self) -> bool {
        true
    }

    fn window_frames(&self, sample_rate: u32) -> usize {
        frames_for(sample_rate, LISSAJOUS_SECONDS).max(frames_for(sample_rate, CORRELATION_SECONDS))
    }

    fn process(&mut self, window: &StereoWindow, ctx: &AnalysisContext, out: &mut SectionWriter) {
        let rate = window.sample_rate();

        let (corr_l, corr_r) = window.latest(frames_for(rate, CORRELATION_SECONDS));
        out.push(correlation(corr_l, corr_r));

        // リサージュ：各区間の最後のサンプルを取る（最後の点が最新のサンプルになる）
        let (left, right) = window.latest(frames_for(rate, LISSAJOUS_SECONDS));
        let n = left.len();
        let pick = |i: usize| -> Option<(f32, f32)> {
            if n == 0 {
                return None;
            }
            let idx = ((i + 1) * n / LISSAJOUS_POINTS).max(1) - 1;
            Some((left[idx], right[idx]))
        };
        for i in 0..LISSAJOUS_POINTS {
            out.push(pick(i).map_or(0.0, |(l, r)| (r - l) * std::f32::consts::FRAC_1_SQRT_2));
        }
        for i in 0..LISSAJOUS_POINTS {
            out.push(pick(i).map_or(0.0, |(l, r)| (l + r) * std::f32::consts::FRAC_1_SQRT_2));
        }

        // 周波数別の定位と振幅
        if !ctx.is_ready() {
            for _ in 0..2 * PAN_BANDS {
                out.push(0.0);
            }
            return;
        }
        let bands = ensure_bands(&mut self.bands, ctx, PAN_BANDS, PAN_MIN_HZ, PAN_MAX_HZ);
        let (power_l, power_r) = (ctx.power_left(), ctx.power_right());
        for band in 0..PAN_BANDS {
            out.push(pan_of(
                bands.power(band, power_l),
                bands.power(band, power_r),
            ));
        }
        for band in 0..PAN_BANDS {
            let energy = (bands.power(band, power_l) + bands.power(band, power_r)) * 0.5;
            out.push(energy.sqrt());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::test_signal::{run_one, silence, sine};

    const RATE: u32 = 48_000;
    const LEN: usize = 4_800;

    struct Parsed {
        corr: f32,
        x: Vec<f32>,
        y: Vec<f32>,
        pan: Vec<f32>,
        level: Vec<f32>,
    }

    fn run(left: &[f32], right: &[f32]) -> Parsed {
        let out = run_one(&mut StereoAnalyzer::new(), left, right, RATE, 800);
        assert_eq!(out.len(), STEREO_LEN);
        Parsed {
            corr: out[STEREO_CORRELATION],
            x: out[STEREO_LISSAJOUS_X..STEREO_LISSAJOUS_Y].to_vec(),
            y: out[STEREO_LISSAJOUS_Y..STEREO_PAN].to_vec(),
            pan: out[STEREO_PAN..STEREO_PAN_LEVEL].to_vec(),
            level: out[STEREO_PAN_LEVEL..].to_vec(),
        }
    }

    fn pan_band(hz: f32) -> usize {
        LogBands::new(
            PAN_BANDS,
            PAN_MIN_HZ,
            PAN_MAX_HZ,
            RATE as f32 / 2048.0,
            1025,
        )
        .band_of(hz)
        .unwrap()
    }

    fn loudest(levels: &[f32]) -> usize {
        (0..levels.len())
            .max_by(|a, b| levels[*a].total_cmp(&levels[*b]))
            .unwrap()
    }

    #[test]
    fn silence_gives_zero_everywhere() {
        let z = silence(LEN);
        let p = run(&z, &z);
        assert_eq!(p.corr, 0.0);
        assert!(
            p.x.iter()
                .chain(&p.y)
                .chain(&p.pan)
                .chain(&p.level)
                .all(|v| *v == 0.0)
        );
    }

    #[test]
    fn mono_is_a_vertical_line_centered_and_fully_correlated() {
        let s = sine(1_000.0, 0.5, RATE, LEN);
        let p = run(&s, &s);
        // リサージュ：横は0、縦は振れる
        assert!(p.x.iter().all(|v| v.abs() < 1e-6));
        let height = p.y.iter().fold(0.0f32, |a, v| a.max(v.abs()));
        assert!((height - 0.5 * 2f32.sqrt()).abs() < 0.05, "height {height}");
        assert!((p.corr - 1.0).abs() < 1e-4, "corr {}", p.corr);
        // 定位：音のある帯域は中央
        let band = loudest(&p.level);
        assert!(band.abs_diff(pan_band(1_000.0)) <= 1);
        assert!(p.pan[band].abs() < 1e-3, "pan {}", p.pan[band]);
    }

    #[test]
    fn left_only_leans_left() {
        let s = sine(1_000.0, 0.5, RATE, LEN);
        let z = silence(LEN);
        let p = run(&s, &z);
        // リサージュ：点は x = −y の斜めの線（左上・右下）
        assert!(p.x.iter().zip(&p.y).all(|(x, y)| (x + y).abs() < 1e-6));
        assert!(p.y.iter().any(|v| v.abs() > 0.3));
        assert_eq!(p.corr, 0.0);
        let band = loudest(&p.level);
        assert!((p.pan[band] + 1.0).abs() < 1e-3, "pan {}", p.pan[band]);
    }

    #[test]
    fn panned_sources_land_on_their_side_per_frequency() {
        // 低域は等パワーのパンで R 寄り（定位 0.5 = 角度 3π/8）、高域は L だけ
        let angle = 3.0 * std::f32::consts::PI / 8.0;
        let low = sine(100.0, 0.5, RATE, LEN);
        let high = sine(8_000.0, 0.4, RATE, LEN);
        let left: Vec<f32> = low
            .iter()
            .zip(&high)
            .map(|(a, b)| a * angle.cos() + b)
            .collect();
        let right: Vec<f32> = low.iter().map(|a| a * angle.sin()).collect();
        let p = run(&left, &right);

        let expected_low = angle * 4.0 / std::f32::consts::PI - 1.0;
        let low_band = (0..pan_band(400.0))
            .max_by(|a, b| p.level[*a].total_cmp(&p.level[*b]))
            .unwrap();
        assert!(
            (p.pan[low_band] - expected_low).abs() < 0.02,
            "low pan {}",
            p.pan[low_band]
        );
        let high_band = (pan_band(2_000.0)..PAN_BANDS)
            .max_by(|a, b| p.level[*a].total_cmp(&p.level[*b]))
            .unwrap();
        assert!(
            (p.pan[high_band] + 1.0).abs() < 1e-3,
            "high pan {}",
            p.pan[high_band]
        );
    }

    #[test]
    fn antiphase_is_a_horizontal_line_with_negative_correlation() {
        let s = sine(500.0, 0.5, RATE, LEN);
        let neg: Vec<f32> = s.iter().map(|v| -v).collect();
        let p = run(&s, &neg);
        assert!(p.y.iter().all(|v| v.abs() < 1e-6));
        assert!((p.corr + 1.0).abs() < 1e-4);
        let band = loudest(&p.level);
        assert!(p.pan[band].abs() < 1e-3);
    }

    #[test]
    fn lissajous_points_are_the_latest_samples_in_order() {
        let n = frames_for(RATE, LISSAJOUS_SECONDS);
        let ramp: Vec<f32> = (0..LEN).map(|i| i as f32 / LEN as f32).collect();
        let p = run(&ramp, &ramp);
        assert!(p.y.windows(2).all(|w| w[1] >= w[0]));
        let last = p.y[LISSAJOUS_POINTS - 1] * std::f32::consts::FRAC_1_SQRT_2;
        assert!((last - (LEN - 1) as f32 / LEN as f32).abs() < 1e-5);
        let first = p.y[0] * std::f32::consts::FRAC_1_SQRT_2;
        assert!(first >= (LEN - n) as f32 / LEN as f32 - 1e-5);
    }

    #[test]
    fn window_covers_the_correlation_span() {
        assert_eq!(StereoAnalyzer::new().window_frames(RATE), 4_800);
    }
}
