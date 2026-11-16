// 発光（imple 4.6・T9-1 の推奨案 (a)）の WebGL2 の部分。計算は glow.ts（純粋関数でテストする）。
// 1回の描画の発光は、描く先（共有キャンバス・枠の画像）に敷く前に、まとめて用意する（T15-1）：
//   1. 発光ごとに、図形のある範囲にぼかしの届く幅を足した範囲（glowRegion）だけを、等倍の作業用の画像に詰めて置き
//      （packShelves）、透明にしてから、発光する図形を1回だけ描く。入りきらなければ、次の回に分ける
//   2. その回の発光を、縮小した画像（発光ごとの置き場所は packShelves で詰める）へ縮小する（factor × factor のピクセルの平均）
//   3. 全部の発光を、横のぼかしで2枚目へ、縦のぼかしで1枚目へ（分離型のガウス。発光の範囲の外は透明として読む）
//   4. 描く先の枠の範囲へ、拡大して（線形補間）敷く（draw。呼び出し側が描く先を選んでから、図形の順に呼ぶ）
// 範囲の外は、枠全体で計算しても 0 になる（ぼかしが届かない）ので、敷く結果は枠全体で計算したときと同じ。
// 描く先（とくにマルチサンプルの共有キャンバス）を発光ごとに切り替えると、タイル型の GPU（Apple Silicon）では
// 切り替えのたびに画像全体の読み書きが起きて重いため、切り替えは 1〜3 の段階ごとにまとめる。
// 等倍の図形は、このあと呼び出し側（GlRenderer）が描く先へ直接重ねる。頂点は送ってあるので同じ範囲をもう一度描くだけで、
// 展開はし直さない。描く先に直接描くので、塗りのふちはふだんの図形と同じくマルチサンプルでならされる。
// 色はすべて不透明度を掛けた値（premultiplied）のまま扱う（ぼかしも、重ねるときの合成も）。

import { link, type Program } from "./gl_program";
import { MAX_GLOW_RADIUS, glowSampling, packShelves, type GlowPlan, type PixelRect } from "./glow";

/** 描く先のフレームバッファ（WebGL の座標。y は下から）での範囲 */
export type GlRect = PixelRect;

/** 図形を描く先：フレームバッファ（null は共有キャンバス）と、その上の枠の範囲 */
export interface GlDestination {
  framebuffer: WebGLFramebuffer | null;
  rect: GlRect;
}

interface Target {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  width: number;
  height: number;
}

/** 用意する発光1つ分 */
interface GlowJob {
  plan: GlowPlan;
  /** 用意する範囲（枠の左下を原点とするデバイスピクセル。glowRegion） */
  region: GlRect;
  paint: () => void;
  /** 等倍の作業用の画像の上の置き場所と、描く回（prepare で決める） */
  paintAt: { x: number; y: number };
  batch: number;
  /** 縮小した画像の上の置き場所と大きさ（prepare で決める） */
  small: GlRect;
}

type TargetName = "full" | "a" | "b";

/** 作業用の画像の高さを切り上げる単位（段が少し増えたくらいでは作り直さない） */
const HEIGHT_STEP = 64;

const QUAD_VS = `#version 300 es
layout(location = 0) in vec2 a_pos;
uniform vec2 u_uv_scale;
uniform vec2 u_uv_offset;
out vec2 v_uv;
void main() {
  v_uv = (a_pos * 0.5 + 0.5) * u_uv_scale + u_uv_offset;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const DOWNSAMPLE_FS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_source;
uniform int u_factor;
uniform ivec2 u_bounds;
uniform ivec2 u_src_origin;
uniform ivec2 u_dst_origin;
out vec4 out_color;
void main() {
  ivec2 base = (ivec2(gl_FragCoord.xy) - u_dst_origin) * u_factor;
  vec4 sum = vec4(0.0);
  for (int j = 0; j < u_factor; j++) {
    for (int i = 0; i < u_factor; i++) {
      ivec2 p = base + ivec2(i, j);
      if (p.x < u_bounds.x && p.y < u_bounds.y) sum += texelFetch(u_source, u_src_origin + p, 0);
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
uniform ivec2 u_origin;
uniform int u_radius;
uniform float u_weights[${MAX_GLOW_RADIUS + 1}];
out vec4 out_color;
vec4 tap(ivec2 p) {
  return (p.x >= 0 && p.y >= 0 && p.x < u_bounds.x && p.y < u_bounds.y) ? texelFetch(u_source, u_origin + p, 0) : vec4(0.0);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy) - u_origin;
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
  private downsample: Uniforms<"source" | "factor" | "bounds" | "src_origin" | "dst_origin"> | null = null;
  private blur: Uniforms<"source" | "dir" | "bounds" | "origin" | "radius" | "weights"> | null = null;
  private composite: Uniforms<"source" | "clamp" | "uv_scale" | "uv_offset"> | null = null;
  private quadBuffer: WebGLBuffer | null = null;
  private quadVao: WebGLVertexArrayObject | null = null;
  private readonly weights = new Float32Array(MAX_GLOW_RADIUS + 1);
  /** 作業用の画像：等倍の1枚（full）と、縮小した2枚（a・b。全部の発光を詰めて置き、a に仕上がる） */
  private readonly targets = new Map<TargetName, Target>();
  private jobs: GlowJob[] = [];
  /** 今の回の発光を用意できた（できなければ composite は何もしない） */
  private prepared = false;
  /** 作業用の画像を作れなかった（大きさが変わるまで発光を飛ばす。記録は1度だけ） */
  private failed = false;
  private width = 0;
  private height = 0;

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /** シェーダーとバッファを作る。作れなければ false */
  init(): boolean {
    const gl = this.gl;
    this.downsample = withUniforms(gl, link(gl, QUAD_VS, DOWNSAMPLE_FS), ["source", "factor", "bounds", "src_origin", "dst_origin"] as const);
    this.blur = withUniforms(gl, link(gl, QUAD_VS, BLUR_FS), ["source", "dir", "bounds", "origin", "radius", "weights"] as const);
    this.composite = withUniforms(gl, link(gl, QUAD_VS, COMPOSITE_FS), ["source", "clamp", "uv_scale", "uv_offset"] as const);
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

  /** 1回の描画の初め：共有キャンバスの大きさ（デバイスピクセル）を受け取り、用意する発光を空にする。大きさが変わったら作業用の画像を作り直す */
  begin(width: number, height: number): void {
    this.jobs = [];
    this.prepared = false;
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.release();
    this.failed = false;
  }

  /**
   * 発光を1つ用意に加える。region は用意する範囲（glowRegion）。paint は、今のフレームバッファとビューポート（枠の大きさ）に
   * 発光する図形を描く関数（prepare の中で呼ぶ）。返す番号を draw に渡す
   */
  add(plan: GlowPlan, region: GlRect, paint: () => void): number {
    this.jobs.push({ plan, region, paint, paintAt: { x: 0, y: 0 }, batch: 0, small: { x: 0, y: 0, width: 0, height: 0 } });
    return this.jobs.length - 1;
  }

  /**
   * 加えた発光を全部用意する（描く先に敷く前に1回呼ぶ）。終わると、フレームバッファ・ビューポート・切り抜きは決まっていない
   * （呼び出し側が描く先を選び直す）。重ね合わせは有効に戻す
   */
  prepare(): void {
    const gl = this.gl;
    const { downsample, blur, jobs } = this;
    this.prepared = false;
    if (jobs.length === 0 || this.failed || !downsample || !blur) return;

    // 等倍の置き場所と回（キャンバスの大きさの画像に入る分ずつ）、縮小した画像の置き場所を決める
    const paints = packShelves(
      jobs.map((job) => job.region),
      this.width,
      this.height,
    );
    const smalls = packShelves(
      jobs.map((job) => ({ width: Math.ceil(job.region.width / job.plan.factor), height: Math.ceil(job.region.height / job.plan.factor) })),
      Math.ceil(this.width / 2),
    );
    jobs.forEach((job, i) => {
      job.paintAt = paints.origins[i];
      job.batch = paints.origins[i].page;
      const size = smalls.origins[i];
      job.small = { x: size.x, y: size.y, width: Math.ceil(job.region.width / job.plan.factor), height: Math.ceil(job.region.height / job.plan.factor) };
    });

    const full = this.target("full", Math.max(paints.width, 1), paints.height);
    const a = full ? this.target("a", smalls.width, smalls.height) : null;
    const b = a ? this.target("b", smalls.width, smalls.height) : null;
    if (!full || !a || !b) {
      this.failed = true;
      if (!gl.isContextLost()) console.error("glow framebuffers could not be created");
      return;
    }

    for (let batch = 0; batch < paints.pages; batch++) {
      const members = jobs.filter((job) => job.batch === batch);
      // 1. 等倍：全体を透明にしてから、この回の発光の図形を、それぞれの置き場所に描く（枠の左下を、置き場所から範囲の分だけ戻す）
      gl.bindFramebuffer(gl.FRAMEBUFFER, full.framebuffer);
      gl.disable(gl.SCISSOR_TEST);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.SCISSOR_TEST);
      for (const job of members) {
        const { paintAt: at, region } = job;
        gl.viewport(at.x - region.x, at.y - region.y, job.plan.width, job.plan.height);
        gl.scissor(at.x, at.y, region.width, region.height);
        job.paint();
      }

      // 2. 縮小
      gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer);
      gl.bindVertexArray(this.quadVao);
      gl.useProgram(downsample.program);
      this.bindSource(downsample.source, full.texture);
      for (const job of members) {
        const s = job.small;
        gl.viewport(s.x, s.y, s.width, s.height);
        gl.scissor(s.x, s.y, s.width, s.height);
        gl.uniform1i(downsample.factor, job.plan.factor);
        gl.uniform2i(downsample.bounds, job.region.width, job.region.height);
        gl.uniform2i(downsample.src_origin, job.paintAt.x, job.paintAt.y);
        gl.uniform2i(downsample.dst_origin, s.x, s.y);
        gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
      }
      gl.bindVertexArray(null);
      gl.enable(gl.BLEND);
    }

    // 3. 横、縦の順にぼかす（全部の発光をまとめて）
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.quadVao);
    gl.useProgram(blur.program);
    this.blurPass(b, a, 1, 0);
    this.blurPass(a, b, 0, 1);
    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    this.prepared = true;
  }

  /**
   * 用意した発光 job を、今のフレームバッファの dest の範囲（枠）に、拡大して敷く（用意した範囲の外は 0 なので、範囲だけを塗る）。
   * 終わると、ビューポートは dest、切り抜きは用意した範囲。呼び出し側は、続けて描く前に切り抜きを dest に戻す
   */
  draw(job: number, dest: GlRect): void {
    const gl = this.gl;
    const { composite } = this;
    const a = this.targets.get("a");
    const entry = this.jobs[job];
    if (!this.prepared || !composite || !a || !entry) return;
    const { region, plan } = entry;
    gl.viewport(dest.x, dest.y, dest.width, dest.height);
    gl.scissor(dest.x + region.x, dest.y + region.y, region.width, region.height);
    const s = entry.small;
    const sampling = glowSampling(
      { ...plan, smallWidth: s.width, smallHeight: s.height },
      a.width,
      a.height,
      s.x,
      s.y,
      region.x / plan.factor,
      region.y / plan.factor,
    );
    gl.useProgram(composite.program);
    this.bindSource(composite.source, a.texture);
    gl.uniform2f(composite.uv_scale, sampling.uvScale[0], sampling.uvScale[1]);
    gl.uniform2f(composite.uv_offset, sampling.uvOffset[0], sampling.uvOffset[1]);
    gl.uniform4f(composite.clamp, ...sampling.clamp);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    this.release();
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteVertexArray(this.quadVao);
    for (const program of [this.downsample, this.blur, this.composite]) if (program) gl.deleteProgram(program.program);
  }

  /** 全部の発光の縮小した範囲を、source から target へ、dir の向きにぼかす */
  private blurPass(target: Target, source: Target, dx: number, dy: number): void {
    const gl = this.gl;
    const blur = this.blur;
    if (!blur) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    this.bindSource(blur.source, source.texture);
    gl.uniform2i(blur.dir, dx, dy);
    for (const job of this.jobs) {
      const s = job.small;
      gl.viewport(s.x, s.y, s.width, s.height);
      gl.scissor(s.x, s.y, s.width, s.height);
      this.weights.fill(0);
      this.weights.set(job.plan.weights.subarray(0, MAX_GLOW_RADIUS + 1));
      gl.uniform1fv(blur.weights, this.weights);
      gl.uniform1i(blur.radius, Math.min(job.plan.weights.length - 1, MAX_GLOW_RADIUS));
      gl.uniform2i(blur.bounds, s.width, s.height);
      gl.uniform2i(blur.origin, s.x, s.y);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    }
  }

  /**
   * 作業用の画像（name ごとに1枚。width × height 以上）。足りなければ大きくして作り直す（高さは HEIGHT_STEP の倍数に
   * 切り上げる。小さくはしない。キャンバスの大きさが変わったときに捨てる）。作れなければ null
   */
  private target(name: TargetName, width: number, height: number): Target | null {
    const current = this.targets.get(name);
    if (current && current.width >= width && current.height >= height) return current;
    const w = Math.max(width, current?.width ?? 0, 1);
    const h = Math.max(Math.ceil(height / HEIGHT_STEP) * HEIGHT_STEP, current?.height ?? 0, 1);
    if (current) this.destroyTarget(current);
    this.targets.delete(name);
    const max = Number(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE)) || 0;
    if (w > max || h > max) return null;
    const created = this.createTarget(w, h);
    if (created) this.targets.set(name, created);
    return created;
  }

  private release(): void {
    for (const target of this.targets.values()) this.destroyTarget(target);
    this.targets.clear();
  }

  private bindSource(location: WebGLUniformLocation | null, texture: WebGLTexture): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(location, 0);
  }

  private destroyTarget(target: Target): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    gl.deleteFramebuffer(target.framebuffer);
    gl.deleteTexture(target.texture);
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
