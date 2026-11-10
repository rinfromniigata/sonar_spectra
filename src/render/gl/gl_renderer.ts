// WebGL2 に渡す部分（imple 4.6・4.8：薄く保ち、実機の撮影で確かめる）。
// - 図形：まとめ（ShapeBatch）の頂点と番号を1回で送り、枠ごとに命令の範囲を描く。色は不透明度で掛けてから重ねる
//   （キャンバスは premultipliedAlpha）。ふちの覆う割合は頂点の u, v, w からシェーダーで決める（tessellate の説明）
// - 色の移り変わり：命令が持つ移り変わり（gradient）を、描画の座標系の位置から求めて頂点の色に掛ける（式は gradient.ts と同じ）
// - 発光：発光の値を持つ命令は、図形を描く前に発光（ぼかした写し）を枠に敷く（gl_glow）。発光だけの命令は図形を描かない
// - 枠の画像：残光と、薄くする枠（レイアウト編集中）は、枠の図形を枠の画像に描いてから共有キャンバスに重ねる（gl_frame_image）
// - 流れる画像：StreamImage ごとに輪の形のテクスチャを持ち、足された列だけを書く。描くときは読み始めの位置から1周を読む
//   （横は REPEAT、最も近いテクセル）。しばらく描かれなかった画像のテクスチャは捨てる
// - コンテキストを失ったら、この描き手は捨てて、復元したら作り直す（shape_layer）

import type { StreamImage } from "../../modules/stream_image";
import { MAX_GRADIENT_STOPS, type Rect } from "../../modules/types";
import type { Rgba } from "./color";
import type { DeviceRect } from "./frame_rects";
import { FrameImages, type FrameImage } from "./gl_frame_image";
import { FLOATS_PER_VERTEX, type ShapeBatch } from "./shape_batch";
import { imageQuad } from "./tessellate";
import type { Mat3 } from "./transform";
import { GlowRenderer, type GlDestination } from "./gl_glow";
import { link, type Program } from "./gl_program";
import { glowPlan } from "./glow";
import type { ResolvedGradient } from "./gradient";

const SHAPE_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
layout(location = 1) in vec4 a_color;
layout(location = 2) in vec3 a_aa;
uniform mat3 u_matrix;
out vec4 v_color;
out vec3 v_aa;
out vec2 v_pos;
void main() {
  vec3 p = u_matrix * vec3(a_pos, 1.0);
  gl_Position = vec4(p.xy, 0.0, 1.0);
  v_color = a_color;
  v_aa = a_aa;
  v_pos = a_pos;
}`;

const SHAPE_FS = `#version 300 es
precision highp float;
precision highp int;
in vec4 v_color;
in vec3 v_aa;
in vec2 v_pos;
uniform int u_grad_kind;
uniform vec4 u_grad_geom;
uniform int u_grad_count;
uniform float u_grad_offsets[${MAX_GRADIENT_STOPS}];
uniform vec4 u_grad_colors[${MAX_GRADIENT_STOPS}];
out vec4 out_color;
vec4 gradientAt(float t) {
  if (t <= u_grad_offsets[0]) return u_grad_colors[0];
  for (int i = 1; i < ${MAX_GRADIENT_STOPS}; i++) {
    if (i >= u_grad_count) break;
    float o0 = u_grad_offsets[i - 1];
    float o1 = u_grad_offsets[i];
    if (t <= o1) return o1 > o0 ? mix(u_grad_colors[i - 1], u_grad_colors[i], (t - o0) / (o1 - o0)) : u_grad_colors[i];
  }
  return u_grad_colors[u_grad_count - 1];
}
void main() {
  float cov = v_aa.z > 0.0
    ? clamp(v_aa.z + 0.5 - length(v_aa.xy), 0.0, 1.0)
    : clamp(v_aa.y + 0.5 - abs(v_aa.x), 0.0, 1.0);
  vec4 color = v_color;
  if (u_grad_kind == 1) {
    vec2 d = u_grad_geom.zw - u_grad_geom.xy;
    color *= gradientAt(dot(v_pos - u_grad_geom.xy, d) / dot(d, d));
  } else if (u_grad_kind == 2) {
    color *= gradientAt((length(v_pos - u_grad_geom.xy) - u_grad_geom.z) / (u_grad_geom.w - u_grad_geom.z));
  }
  float a = color.a * cov;
  out_color = vec4(color.rgb * a, a);
}`;

interface ShapeProgram extends Program {
  gradKind: WebGLUniformLocation | null;
  gradGeom: WebGLUniformLocation | null;
  gradCount: WebGLUniformLocation | null;
  gradOffsets: WebGLUniformLocation | null;
  gradColors: WebGLUniformLocation | null;
}

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
  private shape: ShapeProgram | null = null;
  /** 発光（作れなければ null。そのときは発光なしで図形だけを描く） */
  private glow: GlowRenderer | null = null;
  /** 枠の画像（作れなければ null。そのときは残光を残さず・薄くせずに、共有キャンバスへ直接描く） */
  private images: FrameImages | null = null;
  /** 今の枠の、共有キャンバスの上の範囲（WebGL の座標。frame で決まる） */
  private frameDest: GlDestination | null = null;
  /** 今の描く先（ふだんは frameDest。枠の画像に描いているあいだは、その画像） */
  private dest: GlDestination | null = null;
  /** 描いている枠の画像 */
  private image: FrameImage | null = null;
  private imageProgram: (Program & { alpha: WebGLUniformLocation | null; sampler: WebGLUniformLocation | null }) | null = null;
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
    const uniform = (name: string) => gl.getUniformLocation(shape.program, name);
    this.shape = {
      ...shape,
      gradKind: uniform("u_grad_kind"),
      gradGeom: uniform("u_grad_geom"),
      gradCount: uniform("u_grad_count"),
      gradOffsets: uniform("u_grad_offsets"),
      gradColors: uniform("u_grad_colors"),
    };
    this.imageProgram = { ...image, alpha: gl.getUniformLocation(image.program, "u_alpha"), sampler: gl.getUniformLocation(image.program, "u_image") };

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
    const images = new FrameImages(gl);
    if (images.init()) {
      this.images = images;
    } else {
      images.dispose();
      if (!gl.isContextLost()) console.error("frame images are unavailable");
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
    this.frameDest = null;
    this.dest = null;
    this.image = null;
    this.glow?.resize(canvasWidth, canvasHeight);
    this.images?.begin(canvasWidth, canvasHeight);
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
    this.frameDest = { framebuffer: null, rect: { x: rect.x, y, width: rect.width, height: rect.height } };
    this.dest = this.frameDest;
    this.image = null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.scissor(rect.x, y, rect.width, rect.height);
    gl.viewport(rect.x, y, rect.width, rect.height);
    const a = bg[3];
    gl.clearColor(bg[0] * a, bg[1] * a, bg[2] * a, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /**
   * 今の枠の図形を、枠の画像に描き始める（frame のあと、図形より先に呼ぶ）。
   * trail があれば、枠の残光の画像（trailId ごとに持ち続ける）に color を alpha の濃さで重ねてから描く。
   * なければ一時の画像を透明にしてから描く（endFrameImage で不透明度を掛けて重ねる）。画像を使えなければ false
   * （そのときは共有キャンバスへ直接描く）
   */
  beginFrameImage(trailId: string, trail: { color: Rgba; alpha: number } | null): boolean {
    const gl = this.gl;
    const frame = this.frameDest;
    if (!frame || !this.images) return false;
    const { width, height } = frame.rect;
    const image = trail ? this.images.trail(trailId, width, height) : this.images.scratch(width, height);
    if (!image) return false;
    const rect = { x: 0, y: 0, width, height };
    gl.bindFramebuffer(gl.FRAMEBUFFER, image.drawFramebuffer);
    gl.viewport(0, 0, width, height);
    gl.scissor(0, 0, width, height);
    if (trail) {
      this.images.fill(trail.color, trail.alpha);
    } else {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.image = image;
    this.dest = { framebuffer: image.drawFramebuffer, rect };
    return true;
  }

  /** 枠の画像を、共有キャンバスの枠に不透明度 opacity で重ねる（beginFrameImage が true のとき、図形のあとで呼ぶ） */
  endFrameImage(opacity: number): void {
    const gl = this.gl;
    const frame = this.frameDest;
    const image = this.image;
    if (!frame || !image || !this.images) return;
    const { rect } = frame;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(rect.x, rect.y, rect.width, rect.height);
    gl.scissor(rect.x, rect.y, rect.width, rect.height);
    this.images.composite(image, rect, opacity);
    this.image = null;
    this.dest = frame;
  }

  /**
   * まとめた図形のうち、番号の first から count 個を、今の描く先に描く。
   * glow が 0 より大きければ、先に発光（ぼかした写し）を敷いてから、図形を重ねる。glowOnly なら発光だけを敷く。
   * gradient があれば、色の移り変わりを頂点の色に掛ける
   */
  shapes(matrix: Mat3, first: number, count: number, glow = 0, glowOnly = false, gradient: ResolvedGradient | null = null): void {
    if (!this.shape || count <= 0) return;
    const dest = this.dest;
    const plan = this.glow && dest ? glowPlan(glow, dest.rect.width, dest.rect.height) : null;
    if (plan && this.glow && dest) {
      this.glow.draw(plan, dest, () => this.drawShapes(matrix, first, count, gradient));
    }
    if (!glowOnly) this.drawShapes(matrix, first, count, gradient);
  }

  private drawShapes(matrix: Mat3, first: number, count: number, gradient: ResolvedGradient | null): void {
    const gl = this.gl;
    const shape = this.shape;
    if (!shape) return;
    gl.useProgram(shape.program);
    gl.uniformMatrix3fv(shape.matrix, false, matrix);
    if (gradient) {
      gl.uniform1i(shape.gradKind, gradient.kind);
      gl.uniform4fv(shape.gradGeom, gradient.geometry);
      gl.uniform1i(shape.gradCount, gradient.count);
      gl.uniform1fv(shape.gradOffsets, gradient.offsets);
      gl.uniform4fv(shape.gradColors, gradient.colors);
    } else {
      gl.uniform1i(shape.gradKind, 0);
    }
    gl.bindVertexArray(this.shapeVao);
    gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_INT, first * 4);
    gl.bindVertexArray(null);
  }

  /** 流れる画像を描く（足された列を書いてから） */
  streamImage(matrix: Mat3, stream: StreamImage, dest: Rect, alpha: number): void {
    const gl = this.gl;
    if (!this.imageProgram) return;
    const texture = this.updateTexture(stream);
    gl.useProgram(this.imageProgram.program);
    gl.uniformMatrix3fv(this.imageProgram.matrix, false, matrix);
    gl.uniform1f(this.imageProgram.alpha, alpha);
    gl.uniform1i(this.imageProgram.sampler, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.bindVertexArray(this.imageVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.imageBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, imageQuad(dest, stream.start, stream.width), gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.bindVertexArray(null);
  }

  /** 1回の描画の終わり：しばらく描かれなかった流れる画像のテクスチャと、残光の画像を捨てる */
  end(): void {
    for (const [stream, entry] of this.textures) {
      if (this.tick - entry.lastUsed > TEXTURE_IDLE_TICKS) {
        this.gl.deleteTexture(entry.texture);
        this.textures.delete(stream);
      }
    }
    this.images?.end();
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
    if (this.imageProgram) gl.deleteProgram(this.imageProgram.program);
    this.glow?.dispose();
    this.images?.dispose();
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
