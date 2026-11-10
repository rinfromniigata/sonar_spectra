// モジュールの描画で共通に使う、図形（ShapeSink に出すもの）の補助。

/**
 * 格子線：縦に nx 分割、横に ny 分割した内側の線を、太さ1の四角（x, y, 幅, 高さ の並び）にする
 * （移行前の Canvas 2D の drawGridLines と同じ位置：縦の線は x = round(width × i / nx) から1ピクセル）
 */
export function gridRects(width: number, height: number, nx: number, ny: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(4 * (Math.max(0, nx - 1) + Math.max(0, ny - 1)));
  let o = 0;
  for (let i = 1; i < nx; i++) {
    out.set([Math.round((width * i) / nx), 0, 1, height], o);
    o += 4;
  }
  for (let j = 1; j < ny; j++) {
    out.set([0, Math.round((height * j) / ny), width, 1], o);
    o += 4;
  }
  return out;
}

/**
 * 縦の点線：x から幅1、y = 0 から height まで、on ピクセル引いて off ピクセル空ける（四角の並び。
 * Canvas 2D で x + 0.5 に太さ1の線を setLineDash([on, off]) で引いたときと同じ位置）
 */
export function dashedVerticalRects(x: number, height: number, on: number, off: number): Float32Array<ArrayBuffer> {
  const period = on + off;
  if (!(on > 0) || !(period > 0) || !(height > 0)) return new Float32Array(0);
  const count = Math.ceil(height / period);
  const out = new Float32Array(4 * count);
  for (let k = 0; k < count; k++) {
    const y = k * period;
    out.set([x, y, 1, Math.min(on, height - y)], k * 4);
  }
  return out;
}

/** 作業用の配列を、長さ n 以上にして返す（足りなければ作り直す。中身は消えてよい） */
export function ensureLength(array: Float32Array<ArrayBuffer>, n: number): Float32Array<ArrayBuffer> {
  return array.length >= n ? array : new Float32Array(Math.max(n, array.length * 2));
}
