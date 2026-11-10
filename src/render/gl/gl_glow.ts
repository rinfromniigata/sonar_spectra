// 発光（imple 4.6・T9-1 の推奨案 (a)）の WebGL2 の部分。計算は glow.ts（純粋関数でテストする）。
// 発光する図形の命令ごとに、次の順で描く：
//   1. 等倍のフレームバッファの左下（枠の大きさ）を透明にし、図形を1回だけ描く（paint）
//   2. 縮小する（factor × factor のピクセルの平均）→ 縮小した1枚目
//   3. 横のぼかしで2枚目へ、縦のぼかしで1枚目へ（分離型のガウス。枠の範囲の外は透明として読む）
//   4. 共有キャンバスの枠の範囲へ、拡大して（線形補間）敷く
// 等倍の図形は、このあと呼び出し側（GlRenderer）が枠へ直接重ねる。頂点は送ってあるので同じ範囲をもう一度描くだけで、
// 展開はし直さない。共有キャンバスに直接描くので、塗りのふちはふだんの図形と同じくマルチサンプルでならされる
// （等倍の画像を写して重ねると、画像の側にもマルチサンプルの領域と解決の手間が要る）。
// フレームバッファは共有キャンバスの大きさで作り、全部の枠で使い回す。大きさが変わったときだけ作り直す（GlowTargets）。
// 色はすべて不透明度を掛けた値（premultiplied）のまま扱う（ぼかしも、重ねるときの合成も）。

import { link, type Program } from "./gl_program";
import { GlowTargets, MAX_GLOW_RADIUS, glowSampling, type GlowPlan } from "./glow";

/** 共有キャンバス（WebGL の座標。y は下から）での枠の範囲 */
export interface GlRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

const QUAD_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
uniform vec2 u_uv_scale;
out vec2 v_uv;
void main() {
  v_uv = (a_pos * 0.5 + 0.5) * u_uv_scale;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const DOWNSAMPLE_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_source;
uniform int u_factor;
uniform ivec2 u_bounds;
out vec4 out_color;
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * u_factor;
  vec4 sum = vec4(0.0);
  for (int j = 0; j < u_factor; j++) {
    for (int i = 0; i < u_factor; i++) {
      ivec2 p = base + ivec2(i, j);
      if (p.x < u_bounds.x && p.y < u_bounds.y) sum += texelFetch(u_source, p, 0);
    }
  }
  out_color = sum / float(u_factor * u_factor);
}`;

const BLUR_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_source;
uniform ivec2 u_dir;
uniform ivec2 u_bounds;
uniform int u_radius;
uniform float u_weights[${MAX_GLOW_RADIUS + 1}];
out vec4 out_color;
vec4 tap(ivec2 p) {
  return (p.x >= 0 && p.y >= 0 && p.x < u_bounds.x && p.y < u_bounds.y) ? texelFetch(u_source, p, 0) : vec4(0.0);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 sum = tap(c) * u_weights[0];
  for (int i = 1; i <= u_radius; i++) {
    sum += (tap(c + u_dir * i) + tap(c - u_dir * i)) * u_weights[i];
  }
  out_color = sum;
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec4 u_clamp;
in vec2 v_uv;
out vec4 out_color;
void main() {
  out_color = texture(u_source, clamp(v_uv, u_clamp.xy, u_clamp.zw));
}`;

type Uniforms<K extends string> = Program & Record<K, WebGLUniformLocation | null>;

function withUniforms<K extends string>(gl: WebGL2RenderingContext, program: Program | null, names: readonly K[]): Uniforms<K> | null {
  if (!program) return null;
  const out = { ...program } as Uniforms<K>;
  for (const name of names) (out as Record<string, unknown>)[name] = gl.getUniformLocation(program.program, `u_${name}`);
  return out;
}

export class GlowRenderer {
  private downsample: Uniforms<"source" | "factor" | "bounds"> | null = null;
  private blur: Uniforms<"source" | "dir" | "bounds" | "radius" | "weights"> | null = null;
  private composite: Uniforms<"source" | "clamp" | "uv_scale"> | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private readonly weights = new Float32Array(MAX_GLOW_RADIUS + 1);
  private readonly targets: GlowTargets<Target>;
  /** フレームバッファを作れなかった（大きさが変わるまで発光を飛ばす。記録は1度だけ） */
  private failed = false;
  private width = 0;
  private height = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.targets = new GlowTargets<Target>({
      create: (width, height) => this.createTarget(width, height),
      destroy: (target) => {
        gl.deleteFramebuffer(target.framebuffer);
        gl.deleteTexture(target.texture);
      },
    });
  }

  /** シェーダーとバッファを作る。作れなければ false */
  init(): boolean {
    const gl = this.gl;
    this.downsample = withUniforms(gl, link(gl, QUAD_VS, DOWNSAMPLE_FS), ["source", "factor", "bounds"] as const);
    this.blur = withUniforms(gl, link(gl, QUAD_VS, BLUR_FS), ["source", "dir", "bounds", "radius", "weights"] as const);
    this.composite = withUniforms(gl, link(gl, QUAD_VS, COMPOSITE_FS), ["source", "clamp", "uv_scale"] as const);
    if (!this.downsample || !this.blur || !this.composite) return false;

    this.quadBuffer = gl.createBuffer();
    this.quadVao = gl.createVertexArray();
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);
    return true;
  }

  /** 共有キャンバスの大きさ（デバイスピクセル）。変わったらフレームバッファを作り直す */
  resize(width: number, height: number): void {
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.targets.resize(width, height);
    this.failed = false;
  }

  /**
   * 発光を枠に敷く。paint は、今のフレームバッファとビューポートに発光する図形を描く関数。
   * 終わると、共有キャンバス（既定のフレームバッファ）・枠のビューポートと切り抜き・重ね合わせを元に戻す
   */
  draw(plan: GlowPlan, frame: GlRect, paint: () => void): void {
    const gl = this.gl;
    const { downsample, blur, composite } = this;
    if (this.failed || !downsample || !blur || !composite) return;
    const full = this.targets.full();
    const pair = full ? this.targets.scaled(plan.factor) : null;
    if (!full || !pair) {
      this.failed = true;
      if (!gl.isContextLost()) console.error("glow framebuffers could not be created");
      return;
    }
    const [a, b] = pair;
    // 枠がキャンバスの端から少しはみ出していても、画像の外は読まない
    const width = Math.min(plan.width, full.width);
    const height = Math.min(plan.height, full.height);
    const smallWidth = Math.min(plan.smallWidth, a.width);
    const smallHeight = Math.min(plan.smallHeight, a.height);

    // 1. 等倍：透明にしてから図形を描く
    this.bindTarget(full, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    paint();

    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.quadVao);

    // 2. 縮小
    this.bindTarget(a, smallWidth, smallHeight);
    gl.useProgram(downsample.program);
    this.bindSource(downsample.source, full.texture);
    gl.uniform1i(downsample.factor, plan.factor);
    gl.uniform2i(downsample.bounds, width, height);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

    // 3. 横、縦の順にぼかす
    this.weights.fill(0);
    this.weights.set(plan.weights.subarray(0, MAX_GLOW_RADIUS + 1));
    gl.useProgram(blur.program);
    gl.uniform1fv(blur.weights, this.weights);
    gl.uniform1i(blur.radius, Math.min(plan.weights.length - 1, MAX_GLOW_RADIUS));
    gl.uniform2i(blur.bounds, smallWidth, smallHeight);

    this.bindTarget(b, smallWidth, smallHeight);
    this.bindSource(blur.source, a.texture);
    gl.uniform2i(blur.dir, 1, 0);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

    this.bindTarget(a, smallWidth, smallHeight);
    this.bindSource(blur.source, b.texture);
    gl.uniform2i(blur.dir, 0, 1);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);

    // 4. 共有キャンバスの枠へ、拡大して敷く
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(frame.x, frame.y, frame.width, frame.height);
    gl.scissor(frame.x, frame.y, frame.width, frame.height);
    gl.enable(gl.BLEND);
    const sampling = glowSampling({ ...plan, smallWidth, smallHeight }, a.width, a.height);
    gl.useProgram(composite.program);
    this.bindSource(composite.source, a.texture);
    gl.uniform2f(composite.uv_scale, sampling.uvScale[0], sampling.uvScale[1]);
    gl.uniform4f(composite.clamp, ...sampling.clamp);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    this.targets.release();
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteVertexArray(this.quadVao);
    for (const program of [this.downsample, this.blur, this.composite]) if (program) gl.deleteProgram(program.program);
  }

  private bindTarget(target: Target, width: number, height: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, width, height);
    gl.scissor(0, 0, width, height);
  }

  private bindSource(location: WebGLUniformLocation | null, texture: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(location, 0);
  }

  private createTarget(width: number, height: number): Target | null {
    const gl = this.gl;
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      return null;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // 縮小した画像を拡大して敷くときは線形補間。縮小とぼかしは texelFetch で読むので、補間の設定によらない
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!complete) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      return null;
    }
    return { framebuffer, texture, width, height };
  }
}
