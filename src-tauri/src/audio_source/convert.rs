//! デバイスのサンプル形式から、ステレオ・f32・インターリーブへの変換
//!
//! 共有モードのミックス形式（多くは f32 だが、整数のこともある）を受け、
//! モノラルは両チャンネルに複製し、多チャンネルはスピーカー配置に沿って L・R に畳み込む。

/// 1サンプルの形式
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SampleKind {
    F32,
    I16,
    /// 3バイトに詰めた24ビット
    I24,
    /// 4バイトの整数（有効ビットが24でも、上位に詰めて入っている）
    I32,
}

impl SampleKind {
    /// 浮動小数かどうかと、1サンプルの格納ビット数から形式を決める。対応しない組なら `None`
    pub fn from_format(is_float: bool, container_bits: u16) -> Option<Self> {
        match (is_float, container_bits) {
            (true, 32) => Some(Self::F32),
            (false, 16) => Some(Self::I16),
            (false, 24) => Some(Self::I24),
            (false, 32) => Some(Self::I32),
            _ => None,
        }
    }

    fn bytes(self) -> usize {
        match self {
            Self::F32 | Self::I32 => 4,
            Self::I16 => 2,
            Self::I24 => 3,
        }
    }

    fn read(self, bytes: &[u8]) -> f32 {
        match self {
            Self::F32 => f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]),
            Self::I16 => f32::from(i16::from_le_bytes([bytes[0], bytes[1]])) / 32_768.0,
            Self::I24 => {
                // 上位バイトに詰めてから算術シフトで符号を広げる
                let value = i32::from_le_bytes([0, bytes[0], bytes[1], bytes[2]]) >> 8;
                value as f32 / 8_388_608.0
            }
            Self::I32 => {
                i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f32
                    / 2_147_483_648.0
            }
        }
    }
}

// スピーカー配置のビット（ksmedia.h の SPEAKER_*）。フレーム内のサンプルは、立っているビットの小さい順に並ぶ
const FRONT_LEFT: u32 = 0x1;
const FRONT_RIGHT: u32 = 0x2;
const FRONT_CENTER: u32 = 0x4;
const LOW_FREQUENCY: u32 = 0x8;
const BACK_LEFT: u32 = 0x10;
const BACK_RIGHT: u32 = 0x20;
const FRONT_LEFT_OF_CENTER: u32 = 0x40;
const FRONT_RIGHT_OF_CENTER: u32 = 0x80;
const BACK_CENTER: u32 = 0x100;
const SIDE_LEFT: u32 = 0x200;
const SIDE_RIGHT: u32 = 0x400;
const TOP_CENTER: u32 = 0x800;
const TOP_FRONT_LEFT: u32 = 0x1000;
const TOP_FRONT_CENTER: u32 = 0x2000;
const TOP_FRONT_RIGHT: u32 = 0x4000;
const TOP_BACK_LEFT: u32 = 0x8000;
const TOP_BACK_CENTER: u32 = 0x1_0000;
const TOP_BACK_RIGHT: u32 = 0x2_0000;

/// 前の左右以外のチャンネルを畳み込むときの係数（-3 dB）
const SIDE_GAIN: f32 = std::f32::consts::FRAC_1_SQRT_2;

/// 1チャンネルが L・R に入る割合
fn speaker_weight(position: u32) -> [f32; 2] {
    match position {
        FRONT_LEFT => [1.0, 0.0],
        FRONT_RIGHT => [0.0, 1.0],
        FRONT_LEFT_OF_CENTER | BACK_LEFT | SIDE_LEFT | TOP_FRONT_LEFT | TOP_BACK_LEFT => {
            [SIDE_GAIN, 0.0]
        }
        FRONT_RIGHT_OF_CENTER | BACK_RIGHT | SIDE_RIGHT | TOP_FRONT_RIGHT | TOP_BACK_RIGHT => {
            [0.0, SIDE_GAIN]
        }
        FRONT_CENTER | BACK_CENTER | TOP_CENTER | TOP_FRONT_CENTER | TOP_BACK_CENTER => {
            [SIDE_GAIN, SIDE_GAIN]
        }
        // 低域効果（LFE）は、左右の定位を持たず、音楽の本体でもないので入れない
        LOW_FREQUENCY => [0.0, 0.0],
        _ => [0.0, 0.0],
    }
}

/// チャンネルごとの L・R への割合
///
/// 畳み込んだ後の音量は正規化しない。多チャンネルのデバイスでステレオの音源を鳴らしたとき
/// （前の左右にだけ音がある、よくある場合）に、ステレオのデバイスと同じレベルで見せるため。
fn channel_weights(channels: usize, mask: u32) -> Vec<[f32; 2]> {
    if channels == 1 {
        return vec![[1.0, 1.0]];
    }
    if mask.count_ones() as usize != channels {
        // 配置が分からない（マスクが0など）：先頭の2チャンネルを L・R とみなす
        let mut weights = vec![[0.0, 0.0]; channels];
        weights[0] = [1.0, 0.0];
        weights[1] = [0.0, 1.0];
        return weights;
    }
    (0..32)
        .map(|bit| 1u32 << bit)
        .filter(|position| mask & position != 0)
        .map(speaker_weight)
        .collect()
}

/// デバイスのフレームをステレオに変換する
#[derive(Debug, Clone)]
pub struct StereoConverter {
    kind: SampleKind,
    frame_bytes: usize,
    weights: Vec<[f32; 2]>,
}

impl StereoConverter {
    /// `frame_bytes` は1フレームのバイト数（WAVEFORMATEX の nBlockAlign）
    pub fn new(
        kind: SampleKind,
        channels: u16,
        frame_bytes: usize,
        channel_mask: u32,
    ) -> Result<Self, String> {
        let channels = usize::from(channels);
        if channels == 0 {
            return Err("device format has no channels".into());
        }
        if frame_bytes != channels * kind.bytes() {
            return Err(format!(
                "unexpected frame size {frame_bytes} for {channels} channels of {kind:?}"
            ));
        }
        Ok(Self {
            kind,
            frame_bytes,
            weights: channel_weights(channels, channel_mask),
        })
    }

    /// 1フレームのバイト数
    pub fn frame_bytes(&self) -> usize {
        self.frame_bytes
    }

    /// `raw` のフレームを変換し、`out` の末尾に L, R の順で追記する。端数のバイトは捨てる
    pub fn convert(&self, raw: &[u8], out: &mut Vec<f32>) {
        let sample_bytes = self.kind.bytes();
        out.reserve(raw.len() / self.frame_bytes * 2);
        for frame in raw.chunks_exact(self.frame_bytes) {
            let (mut left, mut right) = (0.0, 0.0);
            for (channel, [to_left, to_right]) in self.weights.iter().enumerate() {
                if *to_left == 0.0 && *to_right == 0.0 {
                    continue;
                }
                let sample = self.kind.read(&frame[channel * sample_bytes..]);
                left += sample * to_left;
                right += sample * to_right;
            }
            out.push(left);
            out.push(right);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f32_bytes(samples: &[f32]) -> Vec<u8> {
        samples.iter().flat_map(|s| s.to_le_bytes()).collect()
    }

    fn convert(converter: &StereoConverter, raw: &[u8]) -> Vec<f32> {
        let mut out = Vec::new();
        converter.convert(raw, &mut out);
        out
    }

    #[test]
    fn stereo_f32_passes_through() {
        let c = StereoConverter::new(SampleKind::F32, 2, 8, FRONT_LEFT | FRONT_RIGHT).unwrap();
        let raw = f32_bytes(&[0.5, -0.25, 1.0, 0.0]);
        assert_eq!(convert(&c, &raw), [0.5, -0.25, 1.0, 0.0]);
    }

    #[test]
    fn mono_is_copied_to_both_channels() {
        let c = StereoConverter::new(SampleKind::F32, 1, 4, FRONT_CENTER).unwrap();
        assert_eq!(
            convert(&c, &f32_bytes(&[0.5, -0.5])),
            [0.5, 0.5, -0.5, -0.5]
        );
    }

    #[test]
    fn surround_folds_into_left_and_right_without_lfe() {
        // 5.1（FL FR FC LFE SL SR）
        let mask = FRONT_LEFT | FRONT_RIGHT | FRONT_CENTER | LOW_FREQUENCY | SIDE_LEFT | SIDE_RIGHT;
        let c = StereoConverter::new(SampleKind::F32, 6, 24, mask).unwrap();

        // 前の左右だけに音がある：ステレオと同じレベル
        let out = convert(&c, &f32_bytes(&[0.5, -0.5, 0.0, 0.0, 0.0, 0.0]));
        assert_eq!(out, [0.5, -0.5]);

        // LFE は入らない
        let out = convert(&c, &f32_bytes(&[0.0, 0.0, 0.0, 1.0, 0.0, 0.0]));
        assert_eq!(out, [0.0, 0.0]);

        // センターは両方に -3 dB、サイドはそれぞれの側に -3 dB
        let out = convert(&c, &f32_bytes(&[0.0, 0.0, 1.0, 0.0, 1.0, 0.0]));
        assert!((out[0] - 2.0 * SIDE_GAIN).abs() < 1e-6);
        assert!((out[1] - SIDE_GAIN).abs() < 1e-6);
    }

    #[test]
    fn unknown_layout_uses_the_first_two_channels() {
        let c = StereoConverter::new(SampleKind::F32, 4, 16, 0).unwrap();
        let out = convert(&c, &f32_bytes(&[0.1, 0.2, 0.9, 0.9]));
        assert_eq!(out, [0.1, 0.2]);
    }

    #[test]
    fn integer_formats_are_scaled_to_unit_range() {
        let c = StereoConverter::new(SampleKind::I16, 2, 4, 0x3).unwrap();
        let raw: Vec<u8> = [i16::MIN, 16_384]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        assert_eq!(convert(&c, &raw), [-1.0, 0.5]);

        let c = StereoConverter::new(SampleKind::I24, 2, 6, 0x3).unwrap();
        // -8388608（最小）と 4194304（半分）
        let raw = [0x00, 0x00, 0x80, 0x00, 0x00, 0x40];
        assert_eq!(convert(&c, &raw), [-1.0, 0.5]);

        let c = StereoConverter::new(SampleKind::I32, 2, 8, 0x3).unwrap();
        let raw: Vec<u8> = [i32::MIN, 1 << 30]
            .iter()
            .flat_map(|s| s.to_le_bytes())
            .collect();
        assert_eq!(convert(&c, &raw), [-1.0, 0.5]);
    }

    #[test]
    fn trailing_partial_frame_is_dropped() {
        let c = StereoConverter::new(SampleKind::F32, 2, 8, 0x3).unwrap();
        let mut raw = f32_bytes(&[0.5, 0.5]);
        raw.extend([0, 0, 0]);
        assert_eq!(convert(&c, &raw), [0.5, 0.5]);
    }

    #[test]
    fn rejects_inconsistent_formats() {
        assert!(StereoConverter::new(SampleKind::F32, 0, 0, 0).is_err());
        assert!(StereoConverter::new(SampleKind::F32, 2, 6, 0x3).is_err());
        assert_eq!(SampleKind::from_format(true, 64), None);
        assert_eq!(SampleKind::from_format(false, 8), None);
        assert_eq!(SampleKind::from_format(false, 24), Some(SampleKind::I24));
    }
}
