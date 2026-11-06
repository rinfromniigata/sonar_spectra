//! 対数の帯域：FFT の1本ごとの強さを、周波数を対数で等分した帯域にまとめる
//!
//! スペクトラムと周波数別の定位が使う。帯域 i は `min_hz·r^i` 以上 `min_hz·r^(i+1)` 未満
//! （r = (max_hz / min_hz)^(1/count)）で、低い順に並ぶ。
//!
//! 帯域の強さの求め方：
//! - 中心がその帯域に入る本数があれば、その本数の強さを足す（振幅の二乗の和。正弦波1つなら、山の本数を
//!   すべて含む帯域で A² になる）
//! - 帯域が1本の間隔より狭く、中心が入る本数がなければ、帯域の中心（幾何平均）の周波数で、前後の2本の強さを
//!   直線で補間する（低域で帯域が0にならず、隣の帯域となめらかにつながる）
//! - ナイキストより上の帯域は 0
//!
//! 直流（0本目）は使わない。

/// 1つの帯域が、強さの並びのどこを読むか
#[derive(Debug, Clone, Copy, PartialEq)]
enum Span {
    /// `start..end` 本目の和
    Sum { start: usize, end: usize },
    /// `k` 本目と `k + 1` 本目を `t` の割合で補間する
    Interpolate { k: usize, t: f32 },
    /// ナイキストより上
    Empty,
}

/// 対数の帯域の割り当て。サンプルレートか FFT の長さが変わったら作り直す
#[derive(Debug, Clone, PartialEq)]
pub struct LogBands {
    count: usize,
    min_hz: f32,
    max_hz: f32,
    bin_hz: f32,
    bins: usize,
    spans: Vec<Span>,
}

impl LogBands {
    /// `bin_hz` は1本あたりの周波数、`bins` は強さの並びの長さ（0 からナイキストまで）
    pub fn new(count: usize, min_hz: f32, max_hz: f32, bin_hz: f32, bins: usize) -> Self {
        let ratio = f64::from(max_hz / min_hz);
        let edge = |i: usize| f64::from(min_hz) * ratio.powf(i as f64 / count as f64);
        let last_bin = bins.saturating_sub(1);
        let spans = (0..count)
            .map(|i| {
                let (low, high) = (edge(i), edge(i + 1));
                if bin_hz <= 0.0 || last_bin < 1 {
                    return Span::Empty;
                }
                let bin_hz = f64::from(bin_hz);
                let nyquist = last_bin as f64 * bin_hz;
                if low >= nyquist {
                    return Span::Empty;
                }
                // 中心が [low, high) に入る本数
                let start = ((low / bin_hz).ceil() as usize).max(1);
                let end = ((high / bin_hz).ceil() as usize).min(bins);
                if start < end {
                    return Span::Sum { start, end };
                }
                let x = ((low * high).sqrt() / bin_hz).max(1.0);
                let k = (x.floor() as usize).min(last_bin.saturating_sub(1)).max(1);
                let t = (x - k as f64).clamp(0.0, 1.0) as f32;
                if k + 1 > last_bin {
                    Span::Sum {
                        start: k,
                        end: k + 1,
                    }
                } else {
                    Span::Interpolate { k, t }
                }
            })
            .collect();
        Self {
            count,
            min_hz,
            max_hz,
            bin_hz,
            bins,
            spans,
        }
    }

    /// 同じ条件で作った割り当てか（作り直しが要るかの判定）
    pub fn matches(
        &self,
        count: usize,
        min_hz: f32,
        max_hz: f32,
        bin_hz: f32,
        bins: usize,
    ) -> bool {
        self.count == count
            && self.min_hz == min_hz
            && self.max_hz == max_hz
            && self.bin_hz == bin_hz
            && self.bins == bins
    }

    pub fn len(&self) -> usize {
        self.spans.len()
    }

    pub fn is_empty(&self) -> bool {
        self.spans.is_empty()
    }

    /// 帯域 `band` の強さ（振幅の二乗）。`power` は1本ごとの強さ（`AnalysisContext::power_left` など）
    pub fn power(&self, band: usize, power: &[f32]) -> f32 {
        match self.spans[band] {
            Span::Sum { start, end } => power[start..end.min(power.len())].iter().sum(),
            Span::Interpolate { k, t } => power[k] * (1.0 - t) + power[k + 1] * t,
            Span::Empty => 0.0,
        }
    }

    /// 帯域 `band` の下端と上端（Hz）
    pub fn edges(&self, band: usize) -> (f32, f32) {
        let ratio = f64::from(self.max_hz / self.min_hz);
        let edge =
            |i: usize| (f64::from(self.min_hz) * ratio.powf(i as f64 / self.count as f64)) as f32;
        (edge(band), edge(band + 1))
    }

    /// 周波数 `hz` を含む帯域（範囲の外なら `None`）
    pub fn band_of(&self, hz: f32) -> Option<usize> {
        if hz < self.min_hz || hz >= self.max_hz {
            return None;
        }
        let ratio = f64::from(self.max_hz / self.min_hz);
        let i = (f64::from(hz / self.min_hz).ln() / ratio.ln() * self.count as f64).floor();
        Some((i as usize).min(self.count - 1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // 48 kHz・2048 点の FFT（1本 = 23.4375 Hz、1025本）
    const BIN_HZ: f32 = 23.437_5;
    const BINS: usize = 1025;

    #[test]
    fn edges_are_logarithmic_and_cover_the_range() {
        let bands = LogBands::new(96, 30.0, 20_000.0, BIN_HZ, BINS);
        assert_eq!(bands.len(), 96);
        let (low, _) = bands.edges(0);
        let (_, high) = bands.edges(95);
        assert!((low - 30.0).abs() < 1e-3);
        assert!((high - 20_000.0).abs() < 0.1);
        // 隣どうしの比が一定
        let r0 = bands.edges(0).1 / bands.edges(0).0;
        let r1 = bands.edges(60).1 / bands.edges(60).0;
        assert!((r0 - r1).abs() < 1e-4);
        assert_eq!(bands.band_of(29.0), None);
        assert_eq!(bands.band_of(30.0), Some(0));
        assert_eq!(bands.band_of(19_999.0), Some(95));
    }

    #[test]
    fn wide_bands_sum_and_narrow_bands_interpolate() {
        let bands = LogBands::new(96, 30.0, 20_000.0, BIN_HZ, BINS);
        let mut power = vec![0.0; BINS];
        power[2] = 1.0;
        power[3] = 3.0;
        // 低域の帯域（1本の間隔より狭い）は、隣り合う2本の間の値になる
        let low = bands.band_of(2.5 * BIN_HZ).unwrap();
        let v = bands.power(low, &power);
        assert!(v > 1.0 && v < 3.0, "interpolated {v}");

        // 高域の帯域（多くの本数を含む）は和
        let mut flat = vec![0.0; BINS];
        flat[1..].fill(1.0);
        let top = bands.power(95, &flat);
        let (lo, hi) = bands.edges(95);
        let expected = ((hi - lo) / BIN_HZ).round();
        assert!(
            (top - expected).abs() <= 1.0,
            "sum {top}, expected about {expected}"
        );
    }

    #[test]
    fn bands_above_nyquist_are_empty() {
        // 22.05 kHz のサンプルレート（ナイキスト 11.025 kHz）
        let bin_hz = 22_050.0 / 1024.0;
        let bands = LogBands::new(96, 30.0, 20_000.0, bin_hz, 513);
        let flat = vec![1.0; 513];
        assert_eq!(bands.power(95, &flat), 0.0);
        assert!(bands.power(0, &flat) > 0.0);
    }

    #[test]
    fn matches_detects_a_change_of_conditions() {
        let bands = LogBands::new(96, 30.0, 20_000.0, BIN_HZ, BINS);
        assert!(bands.matches(96, 30.0, 20_000.0, BIN_HZ, BINS));
        assert!(!bands.matches(96, 30.0, 20_000.0, BIN_HZ / 2.0, 2049));
    }
}
