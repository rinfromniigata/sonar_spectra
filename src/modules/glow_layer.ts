// 発光の層：shadowBlur の代わりに、形を縮小した画像に描いてぼかし、拡大して下に敷いてから、形をそのまま描く。
//
// 負荷（T9-1）：shadowBlur は描く形ごとにぼかしの処理が走り、WebView2 の GPU プロセスで重い（点や列を1つずつ描くと
// 100回以上になる）。発光の層は、まとめて描いた形を1回だけぼかし、ぼかす画像も小さいので、ずっと軽い。
// 広がりは shadowBlur と同じにそろえる：shadowBlur の値 b は、キャンバスのピクセルで標準偏差 b/2 のぼかし
// （実測で、縮小した画像の上で標準偏差 b/2 × 縮小率のぼかしをかけると、明るさの広がりがほぼ一致した）。
// 発光の色は形の色そのもの（shadowColor を形の色にしていた描き方と同じ）。違う色にしたい形は、
// paint が glow の回で色を変える。

import { createBrowserBuffer, type OffscreenBuffer } from "./types";

/** 形を描く関数。発光の回（縮小した画像）と、そのままの回（画面）の2回呼ぶ */
export type GlowPaint = (ctx: CanvasRenderingContext2D, pass: "glow" | "sharp") => void;

export interface GlowLayer {
  /** 描画の座標系の大きさ（CSS ピクセル）と DPR。変わったら画像を作り直す */
  resize(width: number, height: number, devicePixelRatio: number): void;
  /** paint の形を、発光（ぼかした写し）を下に敷いてから描く。blur は shadowBlur と同じ意味の値（0 以下なら発光なし） */
  draw(target: CanvasRenderingContext2D, blur: number, paint: GlowPaint): void;
  dispose(): void;
}

/** 縮小率：ぼかしが大きいほど小さくできる（縮小した画像の上での標準偏差が 1.5〜3ピクセル程度になるように） */
export function glowScale(blur: number): number {
  return blur > 12 ? 0.25 : 0.5;
}

/** 縮小した画像の上での、ぼかしの標準偏差（px） */
export function glowDeviation(blur: number): number {
  return (blur / 2) * glowScale(blur);
}

interface ScaledBuffers {
  /** 形を描く画像と、それをぼかした画像（同じ大きさ） */
  shapes: OffscreenBuffer;
  blurred: OffscreenBuffer;
}

export function createGlowLayer(createBuffer: (width: number, height: number) => OffscreenBuffer = createBrowserBuffer): GlowLayer {
  let width = 0;
  let height = 0;
  let dpr = 1;
  const byScale = new Map<number, ScaledBuffers>();

  function buffers(scale: number): ScaledBuffers {
    let pair = byScale.get(scale);
    if (!pair) {
      const w = Math.max(1, Math.ceil(width * dpr * scale));
      const h = Math.max(1, Math.ceil(height * dpr * scale));
      pair = { shapes: createBuffer(w, h), blurred: createBuffer(w, h) };
      byScale.set(scale, pair);
    }
    return pair;
  }

  return {
    resize(nextWidth, nextHeight, devicePixelRatio) {
      if (nextWidth === width && nextHeight === height && devicePixelRatio === dpr) return;
      width = nextWidth;
      height = nextHeight;
      dpr = devicePixelRatio;
      byScale.clear();
    },

    draw(target, blur, paint) {
      if (blur > 0 && width > 0 && height > 0) {
        const scale = glowScale(blur);
        const { shapes, blurred } = buffers(scale);
        const pw = shapes.canvas.width;
        const ph = shapes.canvas.height;

        const s = shapes.ctx;
        s.setTransform(1, 0, 0, 1, 0, 0);
        s.clearRect(0, 0, pw, ph);
        s.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
        s.save();
        paint(s, "glow");
        s.restore();

        const b = blurred.ctx;
        b.setTransform(1, 0, 0, 1, 0, 0);
        b.clearRect(0, 0, pw, ph);
        b.filter = `blur(${glowDeviation(blur)}px)`;
        b.drawImage(shapes.canvas, 0, 0);
        b.filter = "none";

        // 画面へは描画の座標系のまま、縮小した分だけ拡大して敷く
        target.save();
        target.globalAlpha = 1;
        target.shadowBlur = 0;
        target.drawImage(blurred.canvas, 0, 0, pw / (dpr * scale), ph / (dpr * scale));
        target.restore();
      }
      paint(target, "sharp");
    },

    dispose() {
      byScale.clear();
    },
  };
}
