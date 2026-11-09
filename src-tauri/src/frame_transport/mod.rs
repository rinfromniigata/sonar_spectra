//! 送出（frame_transport）
//!
//! 送出用のスレッドが約60回/秒に、リングバッファの最新の窓で解析を回し、1つのバイト列に
//! まとめて送る。送り先は関数で受け取り、アプリでは `tauri::ipc::Channel`（`channel_output`）にする。
//!
//! - ウィンドウが最小化されている間は、UI からの通知（`set_paused`）で解析と送出を止める。
//!   取得（入力源のスレッド）は止めないので、戻した直後から最新の音を解析できる
//! - 有効なセクションの切り替え（`set_active_sections`）は、次の回から反映する

pub mod format;
#[cfg(test)]
mod shared_fixture;

use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use tauri::ipc::{Channel, InvokeResponseBody};

use crate::analysis::{Pipeline, SectionWriter, StereoWindow};
use crate::audio_source::FrameReader;
use format::{FLAG_STALE, FrameHeader, encode};

/// 送る間隔（約60回/秒）
pub const TICK_INTERVAL: Duration = Duration::from_nanos(16_666_667);

/// 入力源の形式が分かるまで、窓の長さを決めるのに使うサンプルレート
const FALLBACK_SAMPLE_RATE: u32 = 48_000;

/// バイト列を `Channel` へ送る関数を作る。JavaScript 側には `ArrayBuffer` として届く
///
/// 送れなかったとき（ページの再読み込みなど）は、そのフレームを捨てる。
/// 新しいページは `start_stream` で新しい `Channel` を渡し直す。
pub fn channel_output(
    channel: Channel<InvokeResponseBody>,
) -> impl FnMut(Vec<u8>) + Send + 'static {
    move |bytes| {
        let _ = channel.send(InvokeResponseBody::Raw(bytes));
    }
}

/// 1回分の送出：窓を読み、解析し、符号化する（スレッドから切り離して確かめられるようにする）
struct Ticker {
    reader: FrameReader,
    pipeline: Pipeline,
    interleaved: Vec<f32>,
    window: StereoWindow,
    sections: SectionWriter,
    last_total: Option<u64>,
    sample_rate: u32,
    seq: u32,
}

impl Ticker {
    fn new(reader: FrameReader, pipeline: Pipeline) -> Self {
        Self {
            reader,
            pipeline,
            interleaved: Vec::new(),
            window: StereoWindow::new(),
            sections: SectionWriter::new(),
            last_total: None,
            sample_rate: 0,
            seq: 0,
        }
    }

    fn tick(&mut self) -> Vec<u8> {
        // 窓の長さは前回分かったサンプルレートで決める（変わった直後の1回だけ、長さがずれてもよい）
        let rate = if self.sample_rate == 0 {
            FALLBACK_SAMPLE_RATE
        } else {
            self.sample_rate
        };
        let frames = self.pipeline.window_frames(rate);
        self.interleaved.resize(frames * 2, 0.0);
        let info = self.reader.copy_latest(&mut self.interleaved);
        self.sample_rate = info.sample_rate;

        let arrived = info.total_frames - self.last_total.unwrap_or(0);
        let new_frames = usize::try_from(arrived)
            .unwrap_or(usize::MAX)
            .min(info.valid_frames);
        self.last_total = Some(info.total_frames);

        self.window
            .fill_from_interleaved(&self.interleaved, info.sample_rate, new_frames);
        self.pipeline.process(&self.window, &mut self.sections);

        let header = FrameHeader {
            flags: if new_frames == 0 { FLAG_STALE } else { 0 },
            seq: self.seq,
            sample_rate: info.sample_rate,
        };
        self.seq = self.seq.wrapping_add(1);
        let mut bytes = Vec::new();
        encode(&header, &self.sections, &mut bytes);
        bytes
    }
}

#[derive(Default)]
struct Control {
    stop: bool,
    paused: bool,
    active_sections: Option<Vec<u8>>,
}

#[derive(Default)]
struct Shared {
    control: Mutex<Control>,
    /// 一時停止の解除と停止を、一時停止中のスレッドに知らせる
    wake: Condvar,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, Control> {
        self.control.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// 送出用のスレッド
pub struct FrameTransport {
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

impl FrameTransport {
    /// スレッドを起こして送出を始める。`output` は送出用のスレッドから呼ばれる
    pub fn start(
        reader: FrameReader,
        pipeline: Pipeline,
        output: impl FnMut(Vec<u8>) + Send + 'static,
    ) -> Self {
        let shared = Arc::new(Shared::default());
        let shared_in = Arc::clone(&shared);
        let ticker = Ticker::new(reader, pipeline);
        let thread = thread::Builder::new()
            .name("frame-transport".into())
            .spawn(move || run(&shared_in, ticker, output))
            .expect("failed to spawn the frame transport thread");
        Self {
            shared,
            thread: Some(thread),
        }
    }

    /// 解析と送出を止める・再開する（ウィンドウの最小化）
    pub fn set_paused(&self, paused: bool) {
        self.shared.lock().paused = paused;
        self.shared.wake.notify_all();
    }

    /// 有効にするセクションを指定する（`analysis::SectionId` の値の一覧）
    pub fn set_active_sections(&self, ids: Vec<u8>) {
        self.shared.lock().active_sections = Some(ids);
    }

    /// スレッドを止めて待つ
    pub fn stop(&mut self) {
        self.shared.lock().stop = true;
        self.shared.wake.notify_all();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Drop for FrameTransport {
    fn drop(&mut self) {
        self.stop();
    }
}

fn run(shared: &Shared, mut ticker: Ticker, mut output: impl FnMut(Vec<u8>)) {
    let mut next = Instant::now();
    loop {
        let active = {
            let mut control = shared.lock();
            if control.paused && !control.stop {
                // 一時停止の間は眠る。戻ったら、遅れを取り戻そうとせずに今から数え直す
                while control.paused && !control.stop {
                    control = shared
                        .wake
                        .wait(control)
                        .unwrap_or_else(PoisonError::into_inner);
                }
                next = Instant::now();
            }
            if control.stop {
                return;
            }
            control.active_sections.take()
        };
        if let Some(ids) = active {
            ticker.pipeline.set_active_sections(&ids);
        }

        output(ticker.tick());

        // 待つのは thread::sleep にする（Windows では高分解能のタイマーを使い、約16.7ms を守れる）
        next += TICK_INTERVAL;
        let now = Instant::now();
        if next > now {
            thread::sleep(next - now);
        } else {
            // 遅れが出たら、取り戻そうとせずに今から数え直す
            next = now;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::format::{DecodedFrame, decode};
    use super::*;
    use crate::analysis::{
        CENTROID_LEN, CHROMA_LEN, LEVEL_LEN, LOUDNESS_LEN, SPECTRUM_LEN, STEREO_LEN, SectionId,
        VU_LEN, WAVE_LEN,
    };
    use crate::audio_source::{FrameSink, frame_ring};
    use std::sync::mpsc;

    const RATE: u32 = 48_000;

    fn push_sine(sink: &FrameSink, frames: usize, amplitude: f32) {
        let samples: Vec<f32> = (0..frames)
            .flat_map(|n| {
                let v = amplitude * (n as f32 * 0.13).sin();
                [v, v]
            })
            .collect();
        sink.push(&samples);
    }

    fn decode_ok(bytes: &[u8]) -> DecodedFrame {
        decode(bytes).unwrap()
    }

    #[test]
    fn tick_without_a_source_sends_a_stale_header_only() {
        let (_sink, reader) = frame_ring(RATE as usize);
        let mut ticker = Ticker::new(reader, Pipeline::default());
        let frame = decode_ok(&ticker.tick());
        assert_eq!(frame.header.sample_rate, 0);
        assert_eq!(frame.header.flags, FLAG_STALE);
        assert!(frame.sections.is_empty());
    }

    #[test]
    fn tick_sends_all_sections_and_counts_seq() {
        let (sink, reader) = frame_ring(RATE as usize);
        sink.reset(RATE);
        push_sine(&sink, 4_800, 0.5);
        let mut ticker = Ticker::new(reader, Pipeline::default());

        let first = decode_ok(&ticker.tick());
        assert_eq!(first.header.seq, 0);
        assert_eq!(first.header.flags, 0);
        assert_eq!(first.header.sample_rate, RATE);
        let ids: Vec<u8> = first.sections.iter().map(|(id, _)| *id).collect();
        let all: Vec<u8> = SectionId::ALL.iter().map(|id| id.as_u8()).collect();
        assert_eq!(ids, all);
        let lens: Vec<usize> = first.sections.iter().map(|(_, v)| v.len()).collect();
        assert_eq!(
            lens,
            [
                LEVEL_LEN,
                WAVE_LEN,
                SPECTRUM_LEN,
                STEREO_LEN,
                LOUDNESS_LEN,
                VU_LEN,
                CHROMA_LEN,
                CENTROID_LEN
            ]
        );
        assert!((first.sections[0].1[0] - 0.5).abs() < 0.01);

        // 新しいフレームが届いていなければ STALE
        let second = decode_ok(&ticker.tick());
        assert_eq!(second.header.seq, 1);
        assert_eq!(second.header.flags, FLAG_STALE);

        push_sine(&sink, 800, 0.25);
        let third = decode_ok(&ticker.tick());
        assert_eq!(third.header.flags, 0);
        assert!((third.sections[0].1[0] - 0.25).abs() < 0.01);
    }

    #[test]
    fn only_new_frames_feed_the_level() {
        let (sink, reader) = frame_ring(RATE as usize);
        sink.reset(RATE);
        push_sine(&sink, 4_800, 1.0);
        let mut ticker = Ticker::new(reader, Pipeline::default());
        ticker.tick();

        // 大きな音の後に、無音が800フレーム届いた
        sink.push(&vec![0.0; 800 * 2]);
        let frame = decode_ok(&ticker.tick());
        assert_eq!(frame.sections[0].1, [0.0; LEVEL_LEN]);
    }

    #[test]
    fn transport_sends_about_sixty_frames_per_second_and_applies_controls() {
        let (sink, reader) = frame_ring(RATE as usize);
        sink.reset(RATE);
        push_sine(&sink, 4_800, 0.5);
        let (tx, rx) = mpsc::channel();
        let mut transport = FrameTransport::start(reader, Pipeline::default(), move |bytes| {
            let _ = tx.send((Instant::now(), bytes));
        });

        thread::sleep(Duration::from_millis(500));
        let frames: Vec<_> = rx.try_iter().collect();
        if let (Some((first, _)), Some((last, _))) = (frames.first(), frames.last()) {
            let gaps = frames.len().saturating_sub(1).max(1) as f64;
            eprintln!(
                "sent {} frames, mean interval {:.2}ms",
                frames.len(),
                last.duration_since(*first).as_secs_f64() * 1_000.0 / gaps
            );
        }
        // 約30回のはず。CI の負荷で多少ずれても通るように幅を持たせる
        assert!(
            (20..=36).contains(&frames.len()),
            "sent {} frames in 500ms",
            frames.len()
        );
        let seqs: Vec<u32> = frames
            .iter()
            .map(|(_, b)| decode_ok(b).header.seq)
            .collect();
        assert!(seqs.windows(2).all(|p| p[1] == p[0] + 1));

        // セクションの切り替えは次の回から
        transport.set_active_sections(vec![SectionId::Level.as_u8()]);
        thread::sleep(Duration::from_millis(100));
        let _ = rx.try_iter().count();
        thread::sleep(Duration::from_millis(100));
        let (_, last) = rx.try_iter().last().unwrap();
        let ids: Vec<u8> = decode_ok(&last)
            .sections
            .iter()
            .map(|(id, _)| *id)
            .collect();
        assert_eq!(ids, [SectionId::Level.as_u8()]);

        // 一時停止中は送らない
        transport.set_paused(true);
        thread::sleep(Duration::from_millis(50));
        let _ = rx.try_iter().count();
        thread::sleep(Duration::from_millis(200));
        assert_eq!(rx.try_iter().count(), 0);

        // 再開すると、seq は続きから
        let before = seqs.last().copied().unwrap();
        transport.set_paused(false);
        thread::sleep(Duration::from_millis(100));
        let resumed: Vec<_> = rx.try_iter().collect();
        assert!(!resumed.is_empty());
        assert!(decode_ok(&resumed[0].1).header.seq > before);

        // 停止は一時停止中でもすぐ終わる
        transport.set_paused(true);
        let started = Instant::now();
        transport.stop();
        assert!(started.elapsed() < Duration::from_millis(200));
    }
}
