// モジュールの描画で共通に使う Canvas の補助（モックの gridLines・glow と同じ描き方）。

/** 格子線：縦に nx 分割、横に ny 分割した内側の線を、太さ1の線で描く */
export function drawGridLines(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  nx: number,
  ny: number,
  color: string,
): void {
  ctx.shadowBlur = 0;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < nx; i++) {
    const x = Math.round((width * i) / nx) + 0.5;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let j = 1; j < ny; j++) {
    const y = Math.round((height * j) / ny) + 0.5;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}

/** 発光：以降の塗りと線に、その色の影をつける（0 で消す） */
export function setGlow(ctx: CanvasRenderingContext2D, color: string, blur: number): void {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}
