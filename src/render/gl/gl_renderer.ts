// WebGL2 に渡す部分（imple 4.6・4.8：薄く保ち、実機の撮影で確かめる）。
// - 図形：まとめ（ShapeBatch）の頂点と番号を1回で送り、枠ごとに命令の範囲を描く。色は不透明度で掛けてから重ねる
//   （キャンバスは premultipliedAlpha）。ふちの覆う割合は頂点の u, v, w からシェーダーで決める（tessellate の説明）
// - 発光：発光の値を持つ命令は、図形を描く前に発光（ぼかした写し）を枠に敷く（gl_glow）
// - 流れる画像：StreamImage ごとに輪の形のテクスチャを持ち、足された列だけを書く。描くときは読み始めの位置から1周を読む
//   （横は REPEAT、最も近いテクセル）。しばらく描かれなかった画像のテクスチャは捨てる
// - コンテキストを失ったら、この描き手は捨てて、復元したら作り直す（shape_layer）

import type { StreamImage } from "../../modules/stream_image";
import type { Rect } from "../../modules/types";
import type { Rgba } from "./color";
import type { DeviceRect } from "./frame_rects";
import { FLOATS_PER_VERTEX, type ShapeBatch } from "./shape_batch";
import { imageQuad } from "./tessellate";
import type { Mat3 } from "./transform";
import { GlowRenderer, type GlRect } from "./gl_glow";
import { link, type Program } from "./gl_program";
import { glowPlan } from "./glow";

const SHAPE_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;
layout(location = 2) in vec3 a_aa;
uniform mat3 u_matrix;
out vec4 v_color;
out vec3 v_aa;
void main() {
  vec3 p = u_matrix * vec3(a_pos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  v_color = a_color;
  v_aa = a_aa;
}`;

const SHAPE_FS = `#version 300 es
precision highp float;
in vec4 v_color;
in vec3 v_aa;
out vec4 out_color;
void main() {
  float cov = v_aa.z > 0.0
    ? clamp(v_aa.z + 0.5 - length(v_aa.xy), 0.0, 1.0)
    : clamp(v_aa.y + 0.5 - abs(v_aa.x), 0.0, 1.0);
  float a = v_color.a * cov;
  out_color = vec4(v_color.rgb * a, a);
}`;

const IMAGE_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec2 a_uv;
uniform mat3 u_matrix;
out vec2 v_uv;
void main() {
  vec3 p = u_matrix * vec3(a_pos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  v_uv = a_uv;
}`;

const IMAGE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_image;
uniform float u_alpha;
in vec2 v_uv;
out vec4 out_color;
void main() {
  vec4 c = texture(u_image, v_uv);
  float a = c.a * u_alpha;
  out_color = vec4(c.rgb * a, a);
}`;

/** 描かれなかった流れる画像のテクスチャを捨てるまでの回数（約2秒） */
const TEXTURE_IDLE_TICKS = 120;

interface StreamTexture {
  texture: WebGLTexture;
  lastUsed: number;
}

export class GlRenderer {
  private shape: Program | null = null;
  /** 発光（作れなければ null。そのときは発光なしで図形だけを描く） */
  private glow: GlowRenderer | null = null;
  /** 今の枠の範囲（WebGL の座標。frame で決まる） */
  private frameRect: GlRect | null = null;
  private image: (Program & { alpha: WebGLUniformLocation | null; sampler: WebGLUniformLocation | null }) | null = null;
  private shapeVao: WebGLVertexArrayObject | null = null;
  private imageVao: WebGLVertexArrayObject | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;
  private imageBuffer: WebGLBuffer | null = null;
  private readonly textures = new Map<StreamImage, StreamTexture>();
  private tick = 0;
  /** 今の描画の、キャンバスの高さ（WebGL の y は下から） */
  private canvasHeight = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** シェーダーとバッファを作る。作れなければ false */
  init(): boolean {
    const gl = this.gl;
    const shape = link(gl, SHAPE_VS, SHAPE_FS);
    const image = link(gl, IMAGE_VS, IMAGE_FS);
    if (!shape || !image) return false;
    this.shape = shape;
    this.image = { ...image, alpha: gl.getUniformLocation(image.program, "u_alpha"), sampler: gl.getUniformLocation(image.program, "u_image") };

    this.vertexBuffer = gl.createBuffer();
    this.indexBuffer = gl.createBuffer();
    this.shapeVao = gl.createVertexArray();
    gl.bindVertexArray(this.shapeVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 2 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 6 * 4);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

    this.imageBuffer = gl.createBuffer();
    this.imageVao = gl.createVertexArray();
    gl.bindVertexArray(this.imageVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.imageBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);

    const glow = new GlowRenderer(gl);
    if (glow.init()) {
      this.glow = glow;
    } else {
      glow.dispose();
      if (!gl.isContextLost()) console.error("glow is unavailable");
    }

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    return true;
  }

  /** 1回の描画の初め：全体を透明にし、まとめた図形を送る */
  begin(canvasWidth: number, canvasHeight: number, batch: ShapeBatch): void {
    const gl = this.gl;
    this.tick++;
    this.canvasHeight = canvasHeight;
    this.frameRect = null;
    this.glow?.resize(canvasWidth, canvasHeight);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    if (batch.indexCount > 0) {
      gl.bindVertexArray(this.shapeVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, batch.vertices.subarray(0, batch.vertexCount * FLOATS_PER_VERTEX), gl.STREAM_DRAW);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, batch.indices.subarray(0, batch.indexCount), gl.STREAM_DRAW);
      gl.bindVertexArray(null);
    }
  }

  /** 枠の範囲を切り抜きとビューポートにし、地の色で塗る */
  frame(rect: DeviceRect, bg: Rgba): void {
    const gl = this.gl;
    const y = this.canvasHeight - rect.y - rect.height;
    this.frameRect = { x: rect.x, y, width: rect.width, height: rect.height };
    gl.scissor(rect.x, y, rect.width, rect.height);
    gl.viewport(rect.x, y, rect.width, rect.height);
    const a = bg[3];
    gl.clearColor(bg[0] * a, bg[1] * a, bg[2] * a, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * まとめた図形のうち、番号の first から count 個を、今の枠に描く。
   * glow が 0 より大きければ、先に発光（ぼかした写し）を枠に敷いてから、図形を重ねる
   */
  shapes(matrix: Mat3, first: number, count: number, glow = 0): void {
    if (!this.shape || count <= 0) return;
    const plan = this.glow && this.frameRect ? glowPlan(glow, this.frameRect.width, this.frameRect.height) : null;
    if (plan && this.glow && this.frameRect) {
      this.glow.draw(plan, this.frameRect, () => this.drawShapes(matrix, first, count));
    }
    this.drawShapes(matrix, first, count);
  }

  private drawShapes(matrix: Mat3, first: number, count: number): void {
    const gl = this.gl;
    if (!this.shape) return;
    gl.useProgram(this.shape.program);
    gl.uniformMatrix3fv(this.shape.matrix, false, matrix);
    gl.bindVertexArray(this.shapeVao);
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, first * 4);
    gl.bindVertexArray(null);
  }

  /** 流れる画像を描く（足された列を書いてから） */
  streamImage(matrix: Mat3, stream: StreamImage, dest: Rect, alpha: number): void {
    const gl = this.gl;
    if (!this.image) return;
    const texture = this.updateTexture(stream);
    gl.useProgram(this.image.program);
    gl.uniformMatrix3fv(this.image.matrix, false, matrix);
    gl.uniform1f(this.image.alpha, alpha);
    gl.uniform1i(this.image.sampler, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.bindVertexArray(this.imageVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.imageBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, imageQuad(dest, stream.start, stream.width), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.bindVertexArray(null);
  }

  /** 1回の描画の終わり：しばらく描かれなかった流れる画像のテクスチャを捨てる */
  end(): void {
    for (const [stream, entry] of this.textures) {
      if (this.tick - entry.lastUsed > TEXTURE_IDLE_TICKS) {
        this.gl.deleteTexture(entry.texture);
        this.textures.delete(stream);
      }
    }
  }

  /** 持っている流れる画像に、中身を失ったことを知らせる（コンテキストの喪失） */
  markStreamsLost(): void {
    for (const stream of this.textures.keys()) stream.markLost();
    this.textures.clear();
  }

  dispose(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    for (const entry of this.textures.values()) gl.deleteTexture(entry.texture);
    this.textures.clear();
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteBuffer(this.imageBuffer);
    gl.deleteVertexArray(this.shapeVao);
    gl.deleteVertexArray(this.imageVao);
    if (this.shape) gl.deleteProgram(this.shape.program);
    if (this.image) gl.deleteProgram(this.image.program);
    this.glow?.dispose();
  }

  private updateTexture(stream: StreamImage): WebGLTexture | null {
    const gl = this.gl;
    let entry = this.textures.get(stream);
    const { reset, columns } = stream.takeUpdates();
    if (!entry) {
      const texture = gl.createTexture();
      if (!texture) return null;
      entry = { texture, lastUsed: this.tick };
      this.textures.set(stream, entry);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, stream.width, stream.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      // 作り直し：中身を透明にする（null で作り直すと 0 で埋まる）
      if (reset) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, stream.width, stream.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    entry.lastUsed = this.tick;
    for (const column of columns) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, column.x, 0, 1, stream.height, gl.RGBA, gl.UNSIGNED_BYTE, column.data);
    }
    return entry.texture;
  }
}
