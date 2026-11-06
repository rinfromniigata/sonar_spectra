//! 取得方式がまだない OS 向けの入力源
//!
//! 初版の取得方式は Windows の WASAPI だけ。ほかの OS でもアプリを組み立てて起動できるよう、
//! 常に「使えない」を返す入力源を置く（Mac の取得方式を足したら置き換える）。

use super::{AudioFormat, AudioSource, DeviceInfo, FrameSink, SourceError, StatusSink};

/// 常に「使えない」を返す入力源
#[derive(Debug, Default)]
pub struct UnsupportedSource;

impl AudioSource for UnsupportedSource {
    fn list_devices(&self) -> Result<Vec<DeviceInfo>, SourceError> {
        Ok(Vec::new())
    }

    fn start(
        &mut self,
        _device_id: Option<&str>,
        _sink: FrameSink,
        on_status: StatusSink,
    ) -> Result<AudioFormat, SourceError> {
        let err = SourceError::Backend("no capture backend for this OS".into());
        on_status.emit(
            super::SourceStatus::Unavailable {
                reason: err.reason(),
            },
            None,
        );
        Err(err)
    }

    fn stop(&mut self) {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio_source::{SourceStatus, UnavailableReason, frame_ring};
    use std::sync::{Arc, Mutex};

    #[test]
    fn always_reports_unavailable() {
        let mut source = UnsupportedSource;
        assert!(source.list_devices().unwrap().is_empty());
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_in = Arc::clone(&seen);
        let (sink, _reader) = frame_ring(16);
        let err = source
            .start(
                None,
                sink,
                StatusSink::new(move |e| seen_in.lock().unwrap().push(e.status)),
            )
            .unwrap_err();
        assert_eq!(err.reason(), UnavailableReason::Other);
        assert_eq!(
            *seen.lock().unwrap(),
            [SourceStatus::Unavailable {
                reason: UnavailableReason::Other
            }]
        );
    }
}
