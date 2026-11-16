// WebGL2 に渡す部分（imple 4.6・4.8：薄く保ち、実機の撮影で確かめる）。
// - 図形：まとめ（ShapeBatch）の頂点と番号を1回で送り、枠ごとに命令の範囲を描く。色は不透明度で掛けてから重ねる
//   （キャンバスは premultipliedAlpha）。ふちの覆う割合は頂点の u, v, w からシェーダーで決める（tessellate の説明）
// - 色の移り変わり：命令が持つ移り変わり（gradient）を、描画の座標系の位置から求めて頂点の色に掛ける（式は gradient.ts と同じ）
// - 発光：発光の値を持つ命令は、図形を描く前に発光（ぼかした写し）を枠に敷く（gl_glow）。発光だけの命令は図形を描かない
// - 枠の画像：残光と、薄くする枠（レイアウト編集中）は、枠の図形を枠の画像に描いてから共有キャンバスに重ねる（gl_frame_image）
// - 流れる画像：StreamImage ごとに輪の形のテクスチャを持ち、足された列だけを書く。描くときは読み始めの位置から1周を読む
//   （横は REPEAT、最も近いテクセル）。しばらく描かれなかった画像のテクスチャは捨てる
// - 文字の発光：文字を発光の色で画像にし（text_glow）、テクスチャにして、発光の命令の図形の代わりに描く。文字そのものは
//   文字の層が描くので、ここでは発光だけを敷く。同じ文字・見た目の画像は使い回し、しばらく使われなかったものは捨てる
// - コンテキストを失ったら、この描き手は捨てて、復元したら作り直す（shape_layer）

import type { StreamImage } from "../../modules/stream_image";
import { MAX_GRADIENT_STOPS, type Rect } from "../../modules/types";
import type { Rgba } from "./color";
import type { DeviceRect } from "./frame_rects";
import { FrameImages, type FrameImage } from "./gl_frame_image";
import { FLOATS_PER_VERTEX, type BatchCommand, type ShapeBatch } from "./shape_batch";
import { imageQuad } from "./tessellate";
import type { Mat3 } from "./transform";
import { GlowRenderer, type GlRect } from "./gl_glow";
import { link, type Program } from "./gl_program";
import { glowPlan, glowRegion, type ClipBounds } from "./glow";
import type { ResolvedGradient } from "./gradient";
import { rasterizeText, textGlowKey } from "./text_glow";
import type { TextGlowStyle } from "../../modules/types";

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

/** 文字の発光の画像のテクスチャ。dest は基準の点 (0, 0) から見た置き場所（描画の座標系） */
interface TextTexture extends StreamTexture {
  dest: Rect;
  /** 書体を読み込み中に作った（読み込みが済んだら作り直す） */
  provisional: boolean;
}

/** 描画の座標系の矩形 (x0, y0)〜(x1, y1) を変換した、クリップ座標の上の範囲（向きは1/4回転ずつなので、角を写せば足りる） */
function rectClipBounds(x0: number, y0: number, x1: number, y1: number, m: Mat3): ClipBounds {
  const xs = [m[0] * x0 + m[3] * y0, m[0] * x1 + m[3] * y0, m[0] * x0 + m[3] * y1, m[0] * x1 + m[3] * y1];
  const ys = [m[1] * x0 + m[4] * y0, m[1] * x1 + m[4] * y0, m[1] * x0 + m[4] * y1, m[1] * x1 + m[4] * y1];
  return { minX: Math.min(...xs) + m[6], maxX: Math.max(...xs) + m[6], minY: Math.min(...ys) + m[7], maxY: Math.max(...ys) + m[7] };
}

/** まとめた図形の、番号の first から count 個が使う頂点の、クリップ座標の上の範囲 */
function shapeClipBounds(batch: ShapeBatch, first: number, count: number, m: Mat3): ClipBounds {
  const { vertices, indices } = batch;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = first; i < first + count; i++) {
    const v = indices[i] * FLOATS_PER_VERTEX;
    const x = vertices[v];
    const y = vertices[v + 1];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return rectClipBounds(x0, y0, x1, y1, m);
}

/** 枠1つ分の描き方（ShapeLayer が、配置の順に組み立てる） */
export interface FramePass {
  /** 枠のインスタンスID（残光・薄くするための画像を持ち続ける鍵） */
  id: string;
  /** 共有キャンバスの上の範囲（デバイスピクセル。y は上から） */
  rect: DeviceRect;
  /** 枠の描画の座標系から、枠のクリップ座標への変換 */
  matrix: Mat3;
  commands: readonly BatchCommand[];
  /** 残光（あれば、枠の画像に前の回の絵を残す） */
  trail: { color: Rgba; alpha: number } | null;
  /** 枠の図形の不透明度（1 未満なら、枠の画像にしてから薄くして重ねる） */
  opacity: number;
}

/** 枠1つ分の、下ごしらえの結果 */
interface PreparedPass {
  pass: FramePass;
  /** 共有キャンバスの上の範囲（WebGL の座標。y は下から） */
  rect: GlRect;
  /** 命令ごとの、用意した発光の番号 */
  glows: number[];
  /** 命令ごとの、流れる画像のテクスチャ */
  textures: (WebGLTexture | null)[];
  /** 描いて解決した枠の画像（使わない・使えなければ null） */
  image: FrameImage | null;
}

export class GlRenderer {
  private shape: ShapeProgram | null = null;
  /** 発光（作れなければ null。そのときは発光なしで図形だけを描く） */
  private glow: GlowRenderer | null = null;
  /** 枠の画像（作れなければ null。そのときは残光を残さず・薄くせずに、共有キャンバスへ直接描く） */
  private images: FrameImages | null = null;
  private imageProgram: (Program & { alpha: WebGLUniformLocation | null; sampler: WebGLUniformLocation | null }) | null = null;
  private shapeVao: WebGLVertexArrayObject | null = null;
  private imageVao: WebGLVertexArrayObject | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;
  private imageBuffer: WebGLBuffer | null = null;
  private readonly textures = new Map<StreamImage, StreamTexture>();
  private readonly textTextures = new Map<string, TextTexture>();
  /** 文字を画像にする Canvas 2D（使い回す） */
  private textCanvas: HTMLCanvasElement | null = null;
  private tick = 0;

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

  /**
   * 1回の描画。まとめた図形を送り、枠ごとの描き方（passes。並びの順に描く）に従って描く。描く先の切り替えを減らすため、
   * 次の順に進める（T15-1。重ねる順と計算は、枠ごとに順に描いていたときと同じ）：
   *   1. 流れる画像・文字の発光のテクスチャを書き、全部の発光を用意する（gl_glow）
   *   2. 残光と薄くする枠を、枠の画像に描いて解決する（gl_frame_image）
   *   3. 共有キャンバスを透明にし、枠ごとに、地の色で塗ってから、枠の画像を重ねるか、図形を描く
   */
  render(canvasWidth: number, canvasHeight: number, batch: ShapeBatch, bg: Rgba, passes: readonly FramePass[]): void {
    const gl = this.gl;
    this.tick++;
    this.glow?.begin(canvasWidth, canvasHeight);
    this.images?.begin();
    gl.enable(gl.SCISSOR_TEST);
    if (batch.indexCount > 0) {
      gl.bindVertexArray(this.shapeVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, batch.vertices.subarray(0, batch.vertexCount * FLOATS_PER_VERTEX), gl.STREAM_DRAW);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, batch.indices.subarray(0, batch.indexCount), gl.STREAM_DRAW);
      gl.bindVertexArray(null);
    }

    // 1. テクスチャと発光
    const prepared = passes.map((pass) => this.preparePass(pass, canvasHeight, batch));
    this.glow?.prepare();

    // 2. 枠の画像（画像を使えなければ、共有キャンバスへ直接描く）
    for (const entry of prepared) {
      if (entry.pass.trail !== null || entry.pass.opacity < 1) entry.image = this.drawFrameImage(entry);
    }

    // 3. 共有キャンバス
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, canvasWidth, canvasHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    const a = bg[3];
    for (const entry of prepared) {
      const { rect } = entry;
      gl.viewport(rect.x, rect.y, rect.width, rect.height);
      gl.scissor(rect.x, rect.y, rect.width, rect.height);
      gl.clearColor(bg[0] * a, bg[1] * a, bg[2] * a, a);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (entry.image && this.images) this.images.composite(entry.image, rect, entry.pass.opacity);
      else this.replay(entry, rect);
    }
  }

  /** 枠1つ分の下ごしらえ：共有キャンバスの上の範囲を求め、流れる画像・文字の発光のテクスチャを書き、発光を用意に加える */
  private preparePass(pass: FramePass, canvasHeight: number, batch: ShapeBatch): PreparedPass {
    const rect: GlRect = { x: pass.rect.x, y: canvasHeight - pass.rect.y - pass.rect.height, width: pass.rect.width, height: pass.rect.height };
    const entry: PreparedPass = { pass, rect, glows: [], textures: [], image: null };
    const { matrix } = pass;
    const glow = this.glow;
    pass.commands.forEach((command, i) => {
      if (command.kind === "shapes") {
        if (!this.shape || command.count <= 0 || !glow) return;
        const plan = glowPlan(command.glow, rect.width, rect.height);
        const region = plan ? glowRegion(shapeClipBounds(batch, command.first, command.count, matrix), plan) : null;
        if (plan && region) entry.glows[i] = glow.add(plan, region, () => this.drawShapes(matrix, command.first, command.count, command.gradient));
      } else if (command.kind === "image") {
        if (this.imageProgram) entry.textures[i] = this.updateTexture(command.stream);
      } else {
        if (!glow || !this.imageProgram) return;
        const plan = glowPlan(command.style.glow, rect.width, rect.height);
        const text = plan ? this.textTexture(command.text, command.style, command.pixelScale) : null;
        if (!plan || !text) return;
        const dest = { ...text.dest, x: text.dest.x + command.x, y: text.dest.y + command.y };
        const alpha = Math.min(1, Math.max(0, command.style.alpha ?? 1));
        const region = glowRegion(rectClipBounds(dest.x, dest.y, dest.x + dest.width, dest.y + dest.height, matrix), plan);
        if (region) entry.glows[i] = glow.add(plan, region, () => this.drawTexture(matrix, text.texture, imageQuad(dest, 0, 1), alpha));
      }
    });
    return entry;
  }

  /**
   * 枠の図形を、枠の画像に描いて解決する。trail があれば、枠の残光の画像（枠の id ごとに持ち続ける）に color を alpha の濃さで
   * 重ねてから描く。なければ薄くするための画像を透明にしてから描く（共有キャンバスに重ねるときに不透明度を掛ける）。
   * 画像を使えなければ null
   */
  private drawFrameImage(entry: PreparedPass): FrameImage | null {
    const gl = this.gl;
    const images = this.images;
    if (!images) return null;
    const { id, trail } = entry.pass;
    const { width, height } = entry.rect;
    const image = trail ? images.trail(id, width, height) : images.temporary(id, width, height);
    if (!image) return null;
    const rect = { x: 0, y: 0, width, height };
    gl.bindFramebuffer(gl.FRAMEBUFFER, image.drawFramebuffer);
    gl.viewport(0, 0, width, height);
    gl.scissor(0, 0, width, height);
    if (trail) {
      images.fill(trail.color, trail.alpha);
    } else {
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    this.replay(entry, rect);
    images.resolve(image);
    return image;
  }

  /**
   * 枠の命令を、今のフレームバッファの dest の範囲に、順に描く。発光を持つ図形は、用意した発光を敷いてから図形を重ねる
   * （発光だけの命令は図形を描かない）。色の移り変わりは頂点の色に掛ける
   */
  private replay(entry: PreparedPass, dest: GlRect): void {
    const gl = this.gl;
    const { matrix, commands } = entry.pass;
    gl.viewport(dest.x, dest.y, dest.width, dest.height);
    gl.scissor(dest.x, dest.y, dest.width, dest.height);
    commands.forEach((command, i) => {
      const glow = entry.glows[i];
      if (command.kind === "shapes") {
        if (!this.shape || command.count <= 0) return;
        if (glow !== undefined) {
          this.glow?.draw(glow, dest);
          gl.scissor(dest.x, dest.y, dest.width, dest.height);
        }
        if (!command.glowOnly) this.drawShapes(matrix, command.first, command.count, command.gradient);
      } else if (command.kind === "image") {
        if (!this.imageProgram) return;
        const texture = entry.textures[i] ?? null;
        this.drawTexture(matrix, texture, imageQuad(command.dest, command.stream.start, command.stream.width), command.alpha);
      } else if (glow !== undefined) {
        this.glow?.draw(glow, dest);
        gl.scissor(dest.x, dest.y, dest.width, dest.height);
      }
    });
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

  private drawTexture(matrix: Mat3, texture: WebGLTexture | null, quad: Float32Array, alpha: number): void {
    const gl = this.gl;
    if (!this.imageProgram) return;
    gl.useProgram(this.imageProgram.program);
    gl.uniformMatrix3fv(this.imageProgram.matrix, false, matrix);
    gl.uniform1f(this.imageProgram.alpha, alpha);
    gl.uniform1i(this.imageProgram.sampler, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.bindVertexArray(this.imageVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.imageBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STREAM_DRAW);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.bindVertexArray(null);
  }

  /** 1回の描画の終わり：しばらく描かれなかった流れる画像・文字の発光のテクスチャと、残光の画像を捨てる */
  end(): void {
    for (const [stream, entry] of this.textures) {
      if (this.tick - entry.lastUsed > TEXTURE_IDLE_TICKS) {
        this.gl.deleteTexture(entry.texture);
        this.textures.delete(stream);
      }
    }
    for (const [key, entry] of this.textTextures) {
      if (this.tick - entry.lastUsed > TEXTURE_IDLE_TICKS) {
        this.gl.deleteTexture(entry.texture);
        this.textTextures.delete(key);
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
    for (const entry of this.textTextures.values()) gl.deleteTexture(entry.texture);
    this.textTextures.clear();
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

  /** 文字の発光の画像のテクスチャ（なければ作る）。文字に大きさがない・作れないときは null */
  private textTexture(text: string, style: TextGlowStyle, pixelScale: number): TextTexture | null {
    const gl = this.gl;
    const key = textGlowKey(text, style, pixelScale);
    let entry = this.textTextures.get(key) ?? null;
    const fontsReady = typeof document === "undefined" || !document.fonts || document.fonts.status === "loaded";
    if (entry && !(entry.provisional && fontsReady)) {
      entry.lastUsed = this.tick;
      return entry;
    }
    this.textCanvas ??= document.createElement("canvas");
    const raster = rasterizeText(this.textCanvas, text, style, 0, 0, pixelScale);
    if (!raster) return null;
    if (!entry) {
      const texture = gl.createTexture();
      if (!texture) return null;
      entry = { texture, lastUsed: this.tick, dest: raster.dest, provisional: !fontsReady };
      this.textTextures.set(key, entry);
    }
    entry.dest = raster.dest;
    entry.provisional = !fontsReady;
    entry.lastUsed = this.tick;
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // 画像の色は不透明度で掛けない値で読む（シェーダーが掛ける）
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, raster.canvas);
    return entry;
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
