//! 解析結果のセクション：識別子と、解析が書き出す先
//!
//! 1つの解析は1つのセクションを書き出す。セクションの中身は f32 の並びで、並びの意味は
//! 解析ごとのファイル（`level.rs` など）の冒頭に書く。バイト列への符号化は送出（frame_transport）が行う。

/// セクションの識別子。値はバイト列の section_id としてそのまま送るので、一度決めたら変えない
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum SectionId {
    /// レベル（`level.rs`）
    Level = 1,
    /// 波形：履歴用の要約と今の波形（`waveform.rs`）
    Waveform = 2,
}

impl SectionId {
    /// 定義済みのすべてのセクション
    pub const ALL: [SectionId; 2] = [SectionId::Level, SectionId::Waveform];

    pub fn as_u8(self) -> u8 {
        self as u8
    }

    /// 知らない値なら `None`（UI から届いた一覧の検証に使う）
    pub fn from_u8(value: u8) -> Option<Self> {
        Self::ALL.into_iter().find(|id| id.as_u8() == value)
    }
}

#[derive(Debug, Clone, Copy)]
struct Section {
    id: SectionId,
    start: usize,
    len: usize,
}

/// 1回分の解析結果。解析はここに自分のセクションの値を書き出す
///
/// セクションの開始と終了は `Pipeline` が行い、解析は `push`・`extend_from_slice` だけを使う。
#[derive(Debug, Default)]
pub struct SectionWriter {
    data: Vec<f32>,
    sections: Vec<Section>,
    open: Option<(SectionId, usize)>,
}

impl SectionWriter {
    pub fn new() -> Self {
        Self::default()
    }

    /// 前回の結果を捨てる（確保した領域は使い回す）
    pub fn clear(&mut self) {
        self.data.clear();
        self.sections.clear();
        self.open = None;
    }

    pub(crate) fn begin(&mut self, id: SectionId) {
        debug_assert!(self.open.is_none(), "section {id:?} begun inside another");
        self.open = Some((id, self.data.len()));
    }

    pub(crate) fn end(&mut self) {
        if let Some((id, start)) = self.open.take() {
            self.sections.push(Section {
                id,
                start,
                len: self.data.len() - start,
            });
        }
    }

    pub fn push(&mut self, value: f32) {
        debug_assert!(self.open.is_some(), "push outside a section");
        self.data.push(value);
    }

    pub fn extend_from_slice(&mut self, values: &[f32]) {
        debug_assert!(self.open.is_some(), "extend outside a section");
        self.data.extend_from_slice(values);
    }

    /// 書き出された順のセクション
    pub fn sections(&self) -> impl Iterator<Item = (SectionId, &[f32])> {
        self.sections
            .iter()
            .map(|s| (s.id, &self.data[s.start..s.start + s.len]))
    }

    /// 指定のセクションの中身。書き出されていなければ `None`
    pub fn section(&self, id: SectionId) -> Option<&[f32]> {
        self.sections().find(|(s, _)| *s == id).map(|(_, v)| v)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_round_trip_and_unknown_values_are_rejected() {
        for id in SectionId::ALL {
            assert_eq!(SectionId::from_u8(id.as_u8()), Some(id));
        }
        assert_eq!(SectionId::from_u8(0), None);
        assert_eq!(SectionId::from_u8(255), None);
    }

    #[test]
    fn writer_keeps_sections_in_order_and_clears() {
        let mut w = SectionWriter::new();
        w.begin(SectionId::Waveform);
        w.extend_from_slice(&[1.0, 2.0]);
        w.end();
        w.begin(SectionId::Level);
        w.push(3.0);
        w.end();

        let got: Vec<_> = w.sections().map(|(id, v)| (id, v.to_vec())).collect();
        assert_eq!(
            got,
            [
                (SectionId::Waveform, vec![1.0, 2.0]),
                (SectionId::Level, vec![3.0])
            ]
        );
        assert_eq!(w.section(SectionId::Level), Some(&[3.0][..]));

        w.clear();
        assert_eq!(w.sections().count(), 0);
        assert_eq!(w.section(SectionId::Level), None);
    }

    #[test]
    fn empty_section_is_still_listed() {
        let mut w = SectionWriter::new();
        w.begin(SectionId::Level);
        w.end();
        assert_eq!(w.section(SectionId::Level), Some(&[][..]));
    }
}
