// GPU Gaussian blur for whole layers (depth of field, glow). WebGL2, premultiplied alpha.
// blur(src, r) returns a W x H canvas holding src blurred with radius r (px at full size);
// draw it right away: the next call reuses the same canvas.
import {H, W} from '../config';

const VS = `#version 300 es
in vec2 p; out vec2 vUv;
void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

const DOWN = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uTexel;
in vec2 vUv; out vec4 o;
void main(){
  o = 0.25 * (texture(uTex, vUv + uTexel * vec2(-0.5, -0.5)) + texture(uTex, vUv + uTexel * vec2(0.5, -0.5))
            + texture(uTex, vUv + uTexel * vec2(-0.5, 0.5)) + texture(uTex, vUv + uTexel * vec2(0.5, 0.5)));
}`;

const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uDir; uniform float uSigma;
in vec2 vUv; out vec4 o;
void main(){
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int i = -14; i <= 14; i++) {
    float x = float(i);
    float w = exp(-0.5 * x * x / (uSigma * uSigma));
    acc += texture(uTex, vUv + uDir * x) * w;
    ws += w;
  }
  o = acc / ws;
}`;

const COPY = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv; out vec4 o;
void main(){ o = texture(uTex, vUv); }`;

type RT = {fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number};

class Blur {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  progs: Record<string, WebGLProgram> = {};
  src: WebGLTexture;
  levels: RT[][] = []; // levels[k] = two targets at size / 2^k

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    const gl = this.canvas.getContext('webgl2', {premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true, antialias: false})!;
    this.gl = gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    for (const [k, fs] of Object.entries({down: DOWN, blur: BLUR, copy: COPY})) this.progs[k] = this.prog(fs);
    this.src = this.texture(W, H);
  }

  prog(fs: string) {
    const gl = this.gl;
    const sh = (type: number, s: string) => {
      const x = gl.createShader(type)!;
      gl.shaderSource(x, s);
      gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x) ?? 'shader');
      return x;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    return p;
  }

  texture(w: number, h: number) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  level(k: number): RT[] {
    if (!this.levels[k]) {
      const gl = this.gl;
      const w = Math.max(1, Math.round(W / 2 ** k));
      const h = Math.max(1, Math.round(H / 2 ** k));
      this.levels[k] = [0, 1].map(() => {
        const tex = this.texture(w, h);
        const fb = gl.createFramebuffer()!;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        return {fb, tex, w, h};
      });
    }
    return this.levels[k];
  }

  pass(name: string, from: WebGLTexture, to: RT | null, set: (u: (n: string) => WebGLUniformLocation | null) => void) {
    const gl = this.gl;
    const p = this.progs[name];
    gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to ? to.fb : null);
    gl.viewport(0, 0, to ? to.w : W, to ? to.h : H);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, from);
    gl.uniform1i(gl.getUniformLocation(p, 'uTex'), 0);
    set((n) => gl.getUniformLocation(p, n));
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  run(src: TexImageSource, radius: number): HTMLCanvasElement {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const sigma = Math.max(0.01, radius / 2);
    // work at a size where sigma is at most ~3.5 texels (the kernel covers 4 sigma)
    const k = Math.min(5, Math.max(0, Math.ceil(Math.log2(sigma / 3.5))));
    let cur: WebGLTexture = this.src;
    for (let i = 1; i <= k; i++) {
      const prev = i === 1 ? {w: W, h: H} : this.level(i - 1)[0];
      const t = this.level(i)[0];
      this.pass('down', cur, t, (u) => gl.uniform2f(u('uTexel'), 1 / prev.w, 1 / prev.h));
      cur = t.tex;
    }
    if (radius > 0.5) {
      const [a, b] = k === 0 ? this.level(0) : this.level(k);
      const s = sigma / 2 ** k;
      if (k === 0) {
        this.pass('copy', cur, a, () => undefined);
        cur = a.tex;
      }
      const tgtA = k === 0 ? b : b;
      this.pass('blur', cur, tgtA, (u) => {
        gl.uniform2f(u('uDir'), 1 / tgtA.w, 0);
        gl.uniform1f(u('uSigma'), s);
      });
      const tgtB = k === 0 ? a : this.level(k)[0];
      this.pass('blur', tgtA.tex, tgtB, (u) => {
        gl.uniform2f(u('uDir'), 0, 1 / tgtB.h);
        gl.uniform1f(u('uSigma'), s);
      });
      cur = tgtB.tex;
    }
    gl.clearColor(0, 0, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.pass('copy', cur, null, () => undefined);
    return this.canvas;
  }
}

let inst: Blur | null = null;

/** Blur a full-frame layer (W x H). Draw the result before calling again. */
export const gpuBlur = (src: TexImageSource, radius: number) => (inst ??= new Blur()).run(src, radius);

/** Draw a layer onto ctx with a blur radius (0 = sharp, drawn directly). */
export const drawBlurred = (ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, radius: number, alpha = 1, op: GlobalCompositeOperation = 'source-over') => {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.globalCompositeOperation = op;
  ctx.drawImage(radius > 0.5 ? gpuBlur(src, radius) : src, 0, 0, W, H);
  ctx.restore();
};

const layers = new Map<string, HTMLCanvasElement>();
/** A cleared full-frame scratch canvas (one per name). */
export const layer = (name: string) => {
  let c = layers.get(name);
  if (!c) {
    c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    layers.set(name, c);
  }
  const g = c.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.filter = 'none';
  g.clearRect(0, 0, W, H);
  return {c, g};
};
