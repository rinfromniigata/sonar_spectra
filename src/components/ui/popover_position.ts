// ポップオーバーの置き場所（モックのインスタンスの設定と同じ規則）。
// 座標はすべて、ポップオーバーを置く領域（container）の左上を原点にした値。

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PopoverPlacementInput {
  /** 開く元（モジュールなど）の位置 */
  anchor: Box;
  containerWidth: number;
  containerHeight: number;
  /** これより右には出さない（編集パネルの左端など）。省略時は領域の右端 */
  limitRight?: number;
  /** ポップオーバーの今の高さ（はみ出しの判定に使う） */
  popoverHeight: number;
  maxWidth: number;
  /** 元との間と、領域の端との間に空ける量 */
  gap: number;
}

export interface PopoverPlacement {
  left: number;
  top: number;
  width: number;
}

/** 使える幅のうち、ポップオーバーが占めてよい割合 */
const WIDTH_RATIO = 0.45;
/** 上端は、領域の高さのこの割合より下に置く */
const TOP_RATIO = 0.08;
/** 下端には、gap のこの倍数だけ余白を残す */
const BOTTOM_GAPS = 5;

export function placePopover(input: PopoverPlacementInput): PopoverPlacement {
  const { anchor, containerWidth, containerHeight, popoverHeight, maxWidth, gap } = input;
  const limit = (input.limitRight ?? containerWidth) - gap;
  const width = Math.max(0, Math.min(maxWidth, limit * WIDTH_RATIO));

  // 右に置く → 入らなければ左に置く → それも入らなければ、元の内側に寄せて収める
  let left = anchor.right + gap;
  if (left + width > limit) left = anchor.left - width - gap;
  if (left < gap) left = Math.max(gap, Math.min(limit - width, anchor.left + gap));

  const top = Math.max(
    containerHeight * TOP_RATIO,
    Math.min(anchor.top, containerHeight - gap * BOTTOM_GAPS - popoverHeight),
  );
  return { left, top, width };
}
