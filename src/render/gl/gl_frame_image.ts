// 枠の画像（imple 4.6）の WebGL2 の部分：枠の図形を、共有キャンバスへ直接ではなく、枠の大きさの画像に描いてから重ねる。
// - 残光（ShapeSink.trail）：枠ごとに画像を持ち続け、前の回の絵を残す。毎回、地の色を薄く重ねてから描く
//   （Canvas 2D で毎回消さずに地の色を重ねていた描き方と同じ）。枠の大きさが変わったら透明から描き直す
// - 薄くする（レイアウト編集中）：重なった図形がまとめて薄くなるよう、一時の画像に描いてから、不透明度を掛けて重ねる
// 画像は、マルチサンプルの描く先（renderbuffer）と読む先（texture）の組。描いたあとで解決（blit）してから重ねる
// （塗りのふちが、共有キャンバスに直接描いたときと同じくならされる）。マルチサンプルを使えなければ texture に直接描く。
// 枠の画像は、共有キャンバスに描き始める前に、全部の枠の分を描いて解決しておく（描く先の切り替えを減らす。T15-1）。
// そのため、薄くするための画像も枠ごとに持つ。
// 重ねるときは1ピクセルずつそのまま写す（texelFetch）。色は不透明度を掛けた値（premultiplied）のまま扱う。

import type { Rgba } from "./color";
import type { GlRect } from "./gl_glow";
import { link, type Program } from "./gl_program";

export interface FrameImage {
  width: number;
  height: number;
  /** 描く先（マルチサンプルなら renderbuffer の、そうでなければ texture のフレームバッファ） */
  drawFramebuffer: WebGLFramebuffer;
  /** 読む先（texture のフレームバッファ。drawFramebuffer と違えば、重ねる前に解決する） */
  textureFramebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  renderbuffer: WebGLRenderbuffer | null;
}

const QUAD_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FILL_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 out_color;
void main() {
  out_color = u_color;
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_source;
uniform ivec2 u_origin;
uniform float u_opacity;
out vec4 out_color;
void main() {
  out_color = texelFetch(u_source, ivec2(gl_FragCoord.xy) - u_origin, 0) * u_opacity;
}`;

/** 残光の画像を、描かれなくなってから捨てるまでの回数（約2秒） */
const TRAIL_IDLE_TICKS = 120;
/** マルチサンプルの数の上限（共有キャンバスの antialias と同じ程度） */
const SAMPLES = 4;

export class FrameImages {
  private fillProgram: (Program & { color: WebGLUniformLocation | null }) | null = null;
  private compositeProgram:
    | (Program & { source: WebGLUniformLocation | null; origin: WebGLUniformLocation | null; opacity: WebGLUniformLocation | null })
    | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private samples = 0;
  private readonly trails = new Map<string, { image: FrameImage; lastUsed: number }>();
  /** 薄くするための画像（枠ごと。毎回透明にしてから描く） */
  private readonly temporaries = new Map<string, { image: FrameImage; lastUsed: number }>();
  private tick = 0;
  /** 画像を作れなかった（記録は1度だけ） */
  private reported = false;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** シェーダーとバッファを作る。作れなければ false */
  init(): boolean {
    const gl = this.gl;
    const fill = link(gl, QUAD_VS, FILL_FS);
    const composite = link(gl, QUAD_VS, COMPOSITE_FS);
    if (!fill || !composite) return false;
    this.fillProgram = { ...fill, color: gl.getUniformLocation(fill.program, "u_color") };
    this.compositeProgram = {
      ...composite,
      source: gl.getUniformLocation(composite.program, "u_source"),
      origin: gl.getUniformLocation(composite.program, "u_origin"),
      opacity: gl.getUniformLocation(composite.program, "u_opacity"),
    };
    this.quadBuffer = gl.createBuffer();
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
    const max = Number(gl.getParameter(gl.MAX_SAMPLES)) || 0;
    this.samples = max >= 2 ? Math.min(SAMPLES, max) : 0;
    return true;
  }

  /** 1回の描画の初め */
  begin(): void {
    this.tick++;
  }

  /** 枠 id の残光の画像（前の回の絵が残っている）。大きさが変わったら作り直して透明にする。作れなければ null */
  trail(id: string, width: number, height: number): FrameImage | null {
    return this.keep(this.trails, id, width, height);
  }

  /** 枠 id の薄くするための画像（中身は前の回のまま。呼び出し側が透明にしてから描く）。作れなければ null */
  temporary(id: string, width: number, height: number): FrameImage | null {
    return this.keep(this.temporaries, id, width, height);
  }

  /** 今のフレームバッファのビューポート全体に、色（不透明度で掛けない値）を alpha の濃さで重ねる */
  fill(color: Rgba, alpha: number): void {
    const gl = this.gl;
    const program = this.fillProgram;
    if (!program) return;
    const a = color[3] * alpha;
    gl.useProgram(program.program);
    gl.uniform4f(program.color, color[0] * a, color[1] * a, color[2] * a, a);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.bindVertexArray(null);
  }

  /**
   * 画像を、今のフレームバッファの rect に、不透明度 opacity で重ねる
   * （ビューポートと切り抜きは呼ぶ側が rect にしておく。マルチサンプルの画像は、先に resolve しておく）
   */
  composite(image: FrameImage, rect: GlRect, opacity: number): void {
    const gl = this.gl;
    const program = this.compositeProgram;
    if (!program) return;
    gl.useProgram(program.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, image.texture);
    gl.uniform1i(program.source, 0);
    gl.uniform2i(program.origin, rect.x, rect.y);
    gl.uniform1f(program.opacity, opacity);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.bindVertexArray(null);
  }

  /** 1回の描画の終わり：しばらく描かれなかった残光・薄くするための画像を捨てる */
  end(): void {
    for (const images of [this.trails, this.temporaries]) {
      for (const [id, entry] of images) {
        if (this.tick - entry.lastUsed > TRAIL_IDLE_TICKS) {
          this.destroy(entry.image);
          images.delete(id);
        }
      }
    }
  }

  dispose(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    for (const images of [this.trails, this.temporaries]) {
      for (const entry of images.values()) this.destroy(entry.image);
      images.clear();
    }
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteVertexArray(this.quadVao);
    for (const program of [this.fillProgram, this.compositeProgram]) if (program) gl.deleteProgram(program.program);
  }

  /**
   * マルチサンプルの描く先を、読む先（texture）へ解決する（描き終えたあと、重ねる前に1回）。
   * 終わると、フレームバッファは決まっていない（呼び出し側が描く先を選び直す）
   */
  resolve(image: FrameImage): void {
    const gl = this.gl;
    if (image.drawFramebuffer === image.textureFramebuffer) return;
    gl.disable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, image.drawFramebuffer);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, image.textureFramebuffer);
    gl.blitFramebuffer(0, 0, image.width, image.height, 0, 0, image.width, image.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.SCISSOR_TEST);
  }

  /** 枠 id の画像を、images から取り出す（なければ作る）。大きさが変わったら作り直して透明にする。作れなければ null */
  private keep(images: Map<string, { image: FrameImage; lastUsed: number }>, id: string, width: number, height: number): FrameImage | null {
    let entry = images.get(id);
    if (entry && (entry.image.width !== width || entry.image.height !== height)) {
      this.destroy(entry.image);
      images.delete(id);
      entry = undefined;
    }
    if (!entry) {
      const image = this.create(width, height);
      if (!image) return null;
      entry = { image, lastUsed: this.tick };
      images.set(id, entry);
    }
    entry.lastUsed = this.tick;
    return entry.image;
  }

  private create(width: number, height: number): FrameImage | null {
    const gl = this.gl;
    if (width <= 0 || height <= 0) return null;
    const texture = gl.createTexture();
    const textureFramebuffer = gl.createFramebuffer();
    let renderbuffer: WebGLRenderbuffer | null = null;
    let drawFramebuffer: WebGLFramebuffer | null = textureFramebuffer;
    const fail = () => {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(textureFramebuffer);
      if (drawFramebuffer !== textureFramebuffer) gl.deleteFramebuffer(drawFramebuffer);
      gl.deleteRenderbuffer(renderbuffer);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!this.reported && !gl.isContextLost()) console.error("frame image framebuffers could not be created");
      this.reported = true;
      return null;
    };
    if (!texture || !textureFramebuffer) return fail();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, textureFramebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return fail();
    if (this.samples > 0) {
      renderbuffer = gl.createRenderbuffer();
      drawFramebuffer = gl.createFramebuffer();
      if (!renderbuffer || !drawFramebuffer) return fail();
      gl.bindRenderbuffer(gl.RENDERBUFFER, renderbuffer);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, this.samples, gl.RGBA8, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, drawFramebuffer);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, renderbuffer);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return fail();
    }
    // 中身は決まっていないので、透明にしておく
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { width, height, drawFramebuffer: drawFramebuffer!, textureFramebuffer, texture, renderbuffer };
  }

  private destroy(image: FrameImage): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.deleteTexture(image.texture);
    gl.deleteFramebuffer(image.textureFramebuffer);
    if (image.drawFramebuffer !== image.textureFramebuffer) gl.deleteFramebuffer(image.drawFramebuffer);
    gl.deleteRenderbuffer(image.renderbuffer);
  }
}
