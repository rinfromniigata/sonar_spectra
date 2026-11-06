//! 解析に渡すサンプルの窓

/// 1回の解析に渡す、最新のサンプルの窓（L・R を分けたもの、古い順）
///
/// 送出（frame_transport）がリングバッファから読み出して作る。窓の長さは
/// `Pipeline::window_frames` が決め、そのうち前回の解析から新しく届いたフレーム数を `new_frames` で持つ。
#[derive(Debug, Default, Clone)]
pub struct StereoWindow {
    sample_rate: u32,
    left: Vec<f32>,
    right: Vec<f32>,
    new_frames: usize,
}

impl StereoWindow {
    pub fn new() -> Self {
        Self::default()
    }

    /// L, R のインターリーブから窓を作り直す（確保した領域は使い回す）
    ///
    /// `new_frames` は前回の解析から新しく届いたフレーム数。0 なら「届いていない」
    pub fn fill_from_interleaved(
        &mut self,
        interleaved: &[f32],
        sample_rate: u32,
        new_frames: usize,
    ) {
        self.sample_rate = sample_rate;
        self.new_frames = new_frames;
        self.left.clear();
        self.right.clear();
        for [l, r] in interleaved.as_chunks::<2>().0 {
            self.left.push(*l);
            self.right.push(*r);
        }
    }

    /// 0 は「まだ形式が決まっていない」
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// 前回の解析から新しく届いたフレーム数（窓の長さを超えることがある）。0 なら「届いていない」
    ///
    /// 状態を持つ解析（ラウドネスのフィルタなど）が、同じサンプルを2度数えないために使う。
    pub fn new_frames(&self) -> usize {
        self.new_frames
    }

    pub fn len(&self) -> usize {
        self.left.len()
    }

    pub fn is_empty(&self) -> bool {
        self.left.is_empty()
    }

    pub fn left(&self) -> &[f32] {
        &self.left
    }

    pub fn right(&self) -> &[f32] {
        &self.right
    }

    /// 末尾の `frames` フレーム（窓より長ければ窓全体）
    pub fn latest(&self, frames: usize) -> (&[f32], &[f32]) {
        let start = self.len().saturating_sub(frames);
        (&self.left[start..], &self.right[start..])
    }

    /// 前回の解析から新しく届いたフレーム
    ///
    /// 何も届いていないときは、約60分の1秒分を返す（直前の値を出し続けるため）。
    /// 解析が遅れて多く届いたときは、その全体を返す（ピークを取りこぼさないため）。
    pub fn recent(&self) -> (&[f32], &[f32]) {
        let frames = if self.new_frames == 0 {
            (self.sample_rate / 60) as usize
        } else {
            self.new_frames
        };
        self.latest(frames.max(1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_interleaved_frames() {
        let mut w = StereoWindow::new();
        w.fill_from_interleaved(&[1.0, -1.0, 2.0, -2.0, 3.0, -3.0], 48_000, 2);
        assert_eq!(w.left(), [1.0, 2.0, 3.0]);
        assert_eq!(w.right(), [-1.0, -2.0, -3.0]);
        assert_eq!(w.len(), 3);
        assert_eq!(w.recent(), (&[2.0, 3.0][..], &[-2.0, -3.0][..]));
        assert_eq!(w.latest(10).0.len(), 3);
    }

    #[test]
    fn recent_without_new_frames_falls_back_to_one_tick() {
        let mut w = StereoWindow::new();
        let frames: Vec<f32> = (0..2_000).flat_map(|n| [n as f32, 0.0]).collect();
        w.fill_from_interleaved(&frames, 6_000, 0);
        assert_eq!(w.recent().0.len(), 100);
        assert_eq!(w.recent().0[99], 1_999.0);
    }

    #[test]
    fn refill_reuses_and_replaces() {
        let mut w = StereoWindow::new();
        w.fill_from_interleaved(&[1.0, 1.0, 1.0, 1.0], 48_000, 2);
        w.fill_from_interleaved(&[5.0, 6.0], 44_100, 1);
        assert_eq!(w.left(), [5.0]);
        assert_eq!(w.sample_rate(), 44_100);
    }
}
