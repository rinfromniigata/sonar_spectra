// モジュールの描画で共通に使う Canvas の補助（モックの gridLines・glow と同じ描き方）。
//
// 負荷（T9-1）：WebView2 の Canvas は GPU で描かれるが、長い折れ線・大きな塗りのパスは、GPU プロセスの CPU で
// 形を作る処理が重い（実測で、300点の折れ線1本の線が約3.5ms/回、格子線を1本のパスにすると約1.2ms/回）。
// そこで、折れ線は短い区間に分けて描き、塗りは縦の帯に分けて描き、格子線は1ピクセル幅の四角で描く。見た目は同じになる。

/** 格子線：縦に nx 分割、横に ny 分割した内側の線を、太さ1の線で描く（1ピクセル幅の四角で塗る。線のパスより軽い） */
export function drawGridLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  nx: number,
  ny: number,
  color: string,
): void {
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  for (let i = 1; i < nx; i++) ctx.fillRect(Math.round((width * i) / nx), 0, 1, height);
  for (let j = 1; j < ny; j++) ctx.fillRect(0, Math.round((height * j) / ny), width, 1);
}

/** 発光：以降の塗りと線に、その色の影をつける（0 で消す） */
export function setGlow(ctx: CanvasRenderingContext2D, color: string, blur: number): void {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}

/** 折れ線・塗りを分ける区間の数（実測で、8〜16 区間のパスが最も軽かった） */
export const POLYLINE_CHUNK = 8;

/**
 * 点 0〜n−1 を結ぶ折れ線を、今の線の色・太さで描く。POLYLINE_CHUNK 区間ずつの短いパスに分け、
 * 隣どうしは端の点を共有する（つなぎ目は角の形がつかないだけで、細い線では見分けがつかない）
 */
export function strokePolyline(
  ctx: CanvasRenderingContext2D,
  n: number,
  x: (i: number) => number,
  y: (i: number) => number,
): void {
  for (let start = 0; start < n - 1; start += POLYLINE_CHUNK) {
    const end = Math.min(n - 1, start + POLYLINE_CHUNK);
    ctx.beginPath();
    ctx.moveTo(x(start), y(start));
    for (let i = start + 1; i <= end; i++) ctx.lineTo(x(i), y(i));
    ctx.stroke();
  }
}

/**
 * 描画の座標系の x を、デバイスピクセルの境目に丸める関数。流れる方向で座標系を 90° 単位で回していても、
 * x 軸が写るデバイスの軸で丸める。行列を読めない Canvas（テストの代わり）では丸めない
 */
export function deviceSnapX(ctx: CanvasRenderingContext2D): (x: number) => number {
  if (typeof ctx.getTransform !== "function") return (x) => x;
  const m = ctx.getTransform();
  const horizontal = Math.abs(m.a) >= Math.abs(m.b);
  const scale = horizontal ? m.a : m.b;
  const offset = horizontal ? m.e : m.f;
  if (scale === 0) return (x) => x;
  return (x) => (Math.round(x * scale + offset) - offset) / scale;
}

/**
 * x が増える向きに並んだ点 0〜n−1 の、上の線 top と下の線 bottom の間を、今の塗りで塗る。
 * POLYLINE_CHUNK 区間ずつの縦の帯に分け、帯の境目をデバイスピクセルの境目にそろえて、境目の点を両側で共有する
 * （境目のピクセルはどちらか一方の帯だけに入るので、半透明でも継ぎ目が出ない）
 */
export function fillBetween(
  ctx: CanvasRenderingContext2D,
  n: number,
  x: (i: number) => number,
  top: (i: number) => number,
  bottom: (i: number) => number,
): void {
  if (n < 2) return;
  const snap = deviceSnapX(ctx);
  const lastX = x(n - 1);
  let fromX = x(0);
  let fromTop = top(0);
  let fromBottom = bottom(0);
  /** まだ帯に入れていない最初の点（x(i) > fromX） */
  let i = 1;
  for (let j = POLYLINE_CHUNK; ; j += POLYLINE_CHUNK) {
    const final = j >= n - 1;
    let toX = lastX;
    let toTop = top(n - 1);
    let toBottom = bottom(n - 1);
    /** 帯の内側の点は i〜end−1（x < toX） */
    let end = n - 1;
    if (!final) {
      toX = snap(x(j));
      // 丸めて前の境目・右端と重なったら、この境目は使わない（隣の帯とまとめる）
      if (toX <= fromX || toX >= lastX) continue;
      end = i;
      while (end < n - 1 && x(end) < toX) end++;
      // x(end−1) < toX <= x(end)。この区間を直線で補って、境目の高さを求める
      const s = end - 1;
      const x0 = x(s);
      const x1 = x(end);
      const u = x1 === x0 ? 0 : (toX - x0) / (x1 - x0);
      toTop = top(s) + (top(end) - top(s)) * u;
      toBottom = bottom(s) + (bottom(end) - bottom(s)) * u;
    }
    ctx.beginPath();
    ctx.moveTo(fromX, fromTop);
    for (let k = i; k < end; k++) ctx.lineTo(x(k), top(k));
    ctx.lineTo(toX, toTop);
    ctx.lineTo(toX, toBottom);
    for (let k = end - 1; k >= i; k--) ctx.lineTo(x(k), bottom(k));
    ctx.lineTo(fromX, fromBottom);
    ctx.closePath();
    ctx.fill();
    if (final) return;
    fromX = toX;
    fromTop = toTop;
    fromBottom = toBottom;
    // 境目のちょうど上にある点は、境目そのものとして使い終えている
    i = end;
    while (i < n - 1 && x(i) <= toX) i++;
  }
}
