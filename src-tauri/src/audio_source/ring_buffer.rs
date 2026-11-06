//! 取得したフレームを数秒分ためるリングバッファ
//!
//! 書き込み口（`FrameSink`）は取得スレッドが、読み出し口（`FrameReader`）は送出スレッドが持つ。
//! 満杯になったら古いフレームから上書きするため、送出や描画が詰まっても取得スレッドは止まらない。
//! ロックを持つのは、書き込みと読み出しのコピーの間だけにする。

use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

/// 既定の容量（フレーム数）。192 kHz で約2秒、48 kHz で約8秒分
pub const DEFAULT_RING_FRAMES: usize = 384_000;

/// ステレオなので、1フレームは2サンプル（L, R）
const CHANNELS: usize = 2;

struct Ring {
    /// L, R のインターリーブ。長さは `capacity * CHANNELS`
    samples: Vec<f32>,
    capacity: usize,
    /// 次に書き込むフレームの位置
    write_pos: usize,
    /// たまっているフレーム数（最大 `capacity`）
    filled: usize,
    /// 作成から書き込んだフレームの累計。`reset` でも戻さない
    total_frames: u64,
    /// 0 は「まだ形式が決まっていない」
    sample_rate: u32,
}

impl Ring {
    fn push(&mut self, frames: &[f32]) {
        let count = frames.len() / CHANNELS;
        self.total_frames += count as u64;

        // 容量を超える分は、新しい側だけを残す
        let (frames, count) = if count >= self.capacity {
            let skip = (count - self.capacity) * CHANNELS;
            self.write_pos = 0;
            (
                &frames[skip..skip + self.capacity * CHANNELS],
                self.capacity,
            )
        } else {
            (&frames[..count * CHANNELS], count)
        };

        let first = count.min(self.capacity - self.write_pos);
        let start = self.write_pos * CHANNELS;
        self.samples[start..start + first * CHANNELS].copy_from_slice(&frames[..first * CHANNELS]);
        let rest = count - first;
        self.samples[..rest * CHANNELS].copy_from_slice(&frames[first * CHANNELS..]);

        self.write_pos = (self.write_pos + count) % self.capacity;
        self.filled = (self.filled + count).min(self.capacity);
    }

    fn copy_latest(&self, dst: &mut [f32]) -> WindowInfo {
        let wanted = dst.len() / CHANNELS;
        let valid = wanted.min(self.filled);
        let pad = (wanted - valid) * CHANNELS;

        // 足りない分は古い側（先頭）を0で埋める
        dst[..pad].fill(0.0);
        let start_frame = (self.write_pos + self.capacity - valid) % self.capacity;
        let first = valid.min(self.capacity - start_frame);
        let src = start_frame * CHANNELS;
        dst[pad..pad + first * CHANNELS]
            .copy_from_slice(&self.samples[src..src + first * CHANNELS]);
        let rest = valid - first;
        dst[pad + first * CHANNELS..pad + valid * CHANNELS]
            .copy_from_slice(&self.samples[..rest * CHANNELS]);

        WindowInfo {
            sample_rate: self.sample_rate,
            total_frames: self.total_frames,
            valid_frames: valid,
        }
    }
}

type Shared = Arc<Mutex<Ring>>;

fn lock(shared: &Shared) -> MutexGuard<'_, Ring> {
    // 片側がパニックしても、もう片側は動き続けられるようにする（中身はサンプルの並びだけ）
    shared.lock().unwrap_or_else(PoisonError::into_inner)
}

/// 容量 `capacity_frames` のリングバッファを作り、書き込み口と読み出し口を返す
///
/// # Panics
///
/// `capacity_frames` が0のとき
pub fn frame_ring(capacity_frames: usize) -> (FrameSink, FrameReader) {
    assert!(capacity_frames > 0, "ring capacity must be positive");
    let shared = Arc::new(Mutex::new(Ring {
        samples: vec![0.0; capacity_frames * CHANNELS],
        capacity: capacity_frames,
        write_pos: 0,
        filled: 0,
        total_frames: 0,
        sample_rate: 0,
    }));
    (
        FrameSink {
            shared: Arc::clone(&shared),
        },
        FrameReader { shared },
    )
}

/// リングバッファへの書き込み口（取得スレッドが持つ）
#[derive(Clone)]
pub struct FrameSink {
    shared: Shared,
}

impl FrameSink {
    /// ステレオ・f32・インターリーブのフレームを書き込む。満杯なら古いフレームを上書きする
    ///
    /// 長さが奇数のときは、最後の半端なサンプルを捨てる（デバッグビルドではパニックする）
    pub fn push(&self, frames: &[f32]) {
        debug_assert!(
            frames.len().is_multiple_of(CHANNELS),
            "frames must be interleaved stereo"
        );
        if frames.len() < CHANNELS {
            return;
        }
        lock(&self.shared).push(frames);
    }

    /// たまったフレームを捨て、新しいサンプルレートで書き込みを始める
    ///
    /// デバイスを開いたとき・開き直してサンプルレートが変わったときに呼ぶ。
    /// 異なるサンプルレートのフレームが1つの窓に混ざらないようにする。
    pub fn reset(&self, sample_rate: u32) {
        let mut ring = lock(&self.shared);
        ring.write_pos = 0;
        ring.filled = 0;
        ring.sample_rate = sample_rate;
    }
}

/// リングバッファからの読み出し口（送出スレッドが持つ）
#[derive(Clone)]
pub struct FrameReader {
    shared: Shared,
}

impl FrameReader {
    /// 最新のフレームを `dst` にコピーする（古い順。`dst` の長さ÷2 フレーム分）
    ///
    /// たまっているフレームが足りないときは、`dst` の先頭（古い側）を0で埋める。
    pub fn copy_latest(&self, dst: &mut [f32]) -> WindowInfo {
        lock(&self.shared).copy_latest(dst)
    }
}

/// 読み出した窓の情報
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WindowInfo {
    /// 窓のフレームのサンプルレート。0 は「まだ形式が決まっていない」
    pub sample_rate: u32,
    /// 作成から書き込まれたフレームの累計。前回の値との差で、新しく届いたフレーム数が分かる
    pub total_frames: u64,
    /// 窓のうち、実際のフレームで埋まっている数（末尾側）
    pub valid_frames: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// フレーム番号 n を (n, -n) として作る
    fn frames(range: std::ops::Range<i32>) -> Vec<f32> {
        range.flat_map(|n| [n as f32, -(n as f32)]).collect()
    }

    #[test]
    fn pads_the_old_side_with_zeros_until_filled() {
        let (sink, reader) = frame_ring(8);
        sink.reset(48_000);
        sink.push(&frames(1..4));

        let mut dst = [9.0; 10];
        let info = reader.copy_latest(&mut dst);
        assert_eq!(dst, [0.0, 0.0, 0.0, 0.0, 1.0, -1.0, 2.0, -2.0, 3.0, -3.0]);
        assert_eq!(
            info,
            WindowInfo {
                sample_rate: 48_000,
                total_frames: 3,
                valid_frames: 3
            }
        );
    }

    #[test]
    fn keeps_order_across_wraparound() {
        let (sink, reader) = frame_ring(5);
        sink.push(&frames(0..4));
        sink.push(&frames(4..7)); // 位置 4, 0, 1 に書かれ、0〜1 が上書きされる

        let mut dst = vec![0.0; 10];
        let info = reader.copy_latest(&mut dst);
        assert_eq!(dst, frames(2..7));
        assert_eq!(info.valid_frames, 5);
        assert_eq!(info.total_frames, 7);
    }

    #[test]
    fn window_shorter_than_buffer_returns_newest_frames() {
        let (sink, reader) = frame_ring(6);
        sink.push(&frames(0..5));
        sink.push(&frames(5..9));

        let mut dst = vec![0.0; 6];
        reader.copy_latest(&mut dst);
        assert_eq!(dst, frames(6..9));
    }

    #[test]
    fn window_longer_than_capacity_is_padded() {
        let (sink, reader) = frame_ring(3);
        sink.push(&frames(0..10));

        let mut dst = vec![9.0; 8];
        let info = reader.copy_latest(&mut dst);
        let mut expected = vec![0.0; 2];
        expected.extend(frames(7..10));
        assert_eq!(dst, expected);
        assert_eq!(info.valid_frames, 3);
    }

    #[test]
    fn push_larger_than_capacity_keeps_the_newest_part() {
        let (sink, reader) = frame_ring(4);
        sink.push(&frames(0..2)); // 書き込み位置をずらしておく
        sink.push(&frames(2..13));

        let mut dst = vec![0.0; 8];
        let info = reader.copy_latest(&mut dst);
        assert_eq!(dst, frames(9..13));
        assert_eq!(info.total_frames, 13);

        sink.push(&frames(13..15));
        reader.copy_latest(&mut dst);
        assert_eq!(dst, frames(11..15));
    }

    #[test]
    fn reset_drops_frames_and_changes_the_rate_but_keeps_the_total() {
        let (sink, reader) = frame_ring(4);
        sink.reset(44_100);
        sink.push(&frames(0..3));
        sink.reset(48_000);
        sink.push(&frames(3..4));

        let mut dst = vec![9.0; 4];
        let info = reader.copy_latest(&mut dst);
        assert_eq!(dst, [0.0, 0.0, 3.0, -3.0]);
        assert_eq!(
            info,
            WindowInfo {
                sample_rate: 48_000,
                total_frames: 4,
                valid_frames: 1
            }
        );
    }

    #[test]
    fn writer_never_waits_for_a_reader_that_does_not_read() {
        let (sink, reader) = frame_ring(16);
        let writer = std::thread::spawn(move || {
            for chunk in 0..1_000 {
                sink.push(&frames(chunk * 4..chunk * 4 + 4));
            }
        });
        writer.join().unwrap();

        let mut dst = vec![0.0; 32];
        let info = reader.copy_latest(&mut dst);
        assert_eq!(dst, frames(3_984..4_000));
        assert_eq!(info.total_frames, 4_000);
    }

    #[test]
    fn concurrent_reads_see_consistent_windows() {
        let (sink, reader) = frame_ring(64);
        let writer = std::thread::spawn(move || {
            for chunk in 0..2_000 {
                sink.push(&frames(chunk * 8..chunk * 8 + 8));
            }
        });
        let mut dst = vec![0.0; 32];
        for _ in 0..500 {
            let info = reader.copy_latest(&mut dst);
            let valid = info.valid_frames;
            let tail = &dst[dst.len() - valid * 2..];
            // 連続したフレーム番号が古い順に並び、L と R が対応している
            for pair in tail.as_chunks::<2>().0.windows(2) {
                assert_eq!(pair[1][0], pair[0][0] + 1.0);
                assert_eq!(pair[1][1], -pair[1][0]);
            }
            if valid > 0 {
                assert_eq!(tail[tail.len() - 2], (info.total_frames - 1) as f32);
            }
        }
        writer.join().unwrap();
    }

    #[test]
    #[should_panic(expected = "ring capacity must be positive")]
    fn zero_capacity_is_rejected() {
        let _ = frame_ring(0);
    }
}
