// Full-frame finishing on the 2D scene, WebGL2, every parameter a pure function of time.
// Pass 1  motion: radial (zoom) blur, spin blur, directional blur, RGB split
// Pass 2  bloom: bright-pass at 1/4 size, two blur sizes (1/4 and 1/8)
// Pass 3  grade: exposure, contrast, saturation, tint, bloom add, vignette, grain, flash, letterbox

export type Fx = {
  zoom: number; // 0..1 radial blur toward the centre
  spin: number; // radians of rotational blur
  dirX: number; // directional blur, px
  dirY: number;
  chroma: number; // px of red/blue split
  flash: number; // 0..1 white
  cx: number; // blur centre, 0..1
  cy: number;
  bloom: number; // bloom strength (0 = off)
  threshold: number; // luminance where bloom starts
  exposure: number; // 1 = unchanged
  contrast: number; // 1 = unchanged
  saturation: number; // 1 = unchanged
  tint: [number, number, number]; // multiplied into the image (1,1,1 = none)
  lift: [number, number, number]; // added to the shadows
  vignette: number; // 0..1
  grain: number; // 0..1
  letterbox: number; // fraction of height covered top and bottom (0..0.2)
  frame: number; // frame number (grain seed)
};

/** Hard switch: radial / spin / directional motion blur never reach the image (user rule, v14). */
export const NO_SMEAR = true;

export const noFx = (): Fx => ({
  zoom: 0,
  spin: 0,
  dirX: 0,
  dirY: 0,
  chroma: 0,
  flash: 0,
  cx: 0.5,
  cy: 0.5,
  // (v15, user: characters over-exposed) the bloom was 0.3 from 0.86: the pastel grounds glowed and the glow
  // spread over the faces (screen blend: dark lines and pupils lifted). Now only the real highlights glow.
  bloom: 0.12,
  // (v15) only real highlights glow (lamps, white letters, sparkles): skin sits at 0.93-0.97 and must not
  threshold: 0.96,
  exposure: 1,
  // (v15, user: characters over-exposed) neutral: a 4 % contrast and 6 % saturation push sent the light skin
  // (0.95-0.97) into pure white (20-50 % of a face clipped against ~1 % in the art) and flattened its shading
  contrast: 1.0,
  saturation: 1.0,
  tint: [1, 1, 1],
  lift: [0, 0, 0],
  vignette: 0.18,
  grain: 0.0,
  letterbox: 0,
  frame: 0,
});

const VS = `#version 300 es
in vec2 p; out vec2 vUv;
void main(){ vUv = p*0.5+0.5; gl_Position = vec4(p,0.,1.); }`;

const MOTION = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uRes;
uniform float uZoom, uSpin, uChroma; uniform vec2 uDir, uC;
in vec2 vUv; out vec4 o;
vec3 samp(vec2 uv){
  uv = clamp(uv, vec2(0.0), vec2(1.0));
  if (uChroma > 0.0) {
    vec2 off = vec2(uChroma / uRes.x, 0.0);
    return vec3(texture(uTex, uv + off).r, texture(uTex, uv).g, texture(uTex, uv - off).b);
  }
  return texture(uTex, uv).rgb;
}
void main(){
  if (uZoom + abs(uSpin) + length(uDir) < 1e-4) { o = vec4(samp(vUv), 1.0); return; }
  const int N = 32;
  vec3 acc = vec3(0.0);
  float asp = uRes.x / uRes.y;
  for (int i = 0; i < N; i++) {
    float k = float(i) / float(N - 1);
    vec2 d = (vUv - uC) * vec2(asp, 1.0);
    d *= 1.0 - uZoom * k;
    float a = uSpin * (k - 0.5);
    d = mat2(cos(a), sin(a), -sin(a), cos(a)) * d;
    vec2 uv = uC + d / vec2(asp, 1.0);
    uv += uDir / uRes * (k - 0.5);
    acc += samp(uv);
  }
  o = vec4(acc / float(N), 1.0);
}`;

const BRIGHT = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uTexel; uniform float uThr;
in vec2 vUv; out vec4 o;
void main(){
  vec3 c = vec3(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++)
    c += texture(uTex, vUv + vec2(x, y) * uTexel).rgb;
  c /= 9.0;
  // luminance soft-knee: only the part above the threshold glows (pastels stay pastel)
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(l - uThr, 0.0) / max(1.0 - uThr, 1e-3);
  k = k * k * (3.0 - 2.0 * k);
  o = vec4(c * k, 1.0);
}`;

const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uStep;
in vec2 vUv; out vec4 o;
void main(){
  float w[7] = float[](0.1964, 0.1748, 0.1232, 0.0688, 0.0304, 0.0106, 0.0029);
  vec3 c = texture(uTex, vUv).rgb * w[0];
  for (int i = 1; i < 7; i++) {
    c += texture(uTex, vUv + uStep * float(i)).rgb * w[i];
    c += texture(uTex, vUv - uStep * float(i)).rgb * w[i];
  }
  o = vec4(c, 1.0);
}`;

const FINAL = `#version 300 es
precision highp float;
uniform sampler2D uTex, uB1, uB2; uniform vec2 uRes;
uniform float uBloom, uExp, uCon, uSat, uVig, uGrain, uFlash, uBox, uFrame;
uniform vec3 uTint, uLift;
in vec2 vUv; out vec4 o;
float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
void main(){
  vec3 c = texture(uTex, vUv).rgb;
  vec3 b = texture(uB1, vUv).rgb * 0.5 + texture(uB2, vUv).rgb * 0.5;
  // screen blend: glow lifts darks and mids toward the light, never past white
  c = 1.0 - (1.0 - c) * (1.0 - clamp(b * uBloom, 0.0, 1.0));
  c *= uExp;
  c = (c - 0.5) * uCon + 0.5;
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, uSat);
  c = c * uTint + uLift * (1.0 - c);
  vec2 q = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
  c *= 1.0 - uVig * smoothstep(0.45, 1.25, length(q));
  c += (hash(vUv * uRes + uFrame * 13.1) - 0.5) * uGrain;
  c = mix(c, vec3(1.0), clamp(uFlash, 0.0, 1.0));
  if (vUv.y < uBox || vUv.y > 1.0 - uBox) c = vec3(1.0);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

type Target = {fb: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number};

export class Post {
  gl: WebGL2RenderingContext;
  progs: Record<string, {p: WebGLProgram; u: Record<string, WebGLUniformLocation | null>}> = {};
  src: WebGLTexture;
  A: Target;
  B1: Target;
  B1b: Target;
  B2: Target;
  B2b: Target;

  constructor(public out: HTMLCanvasElement) {
    const gl = out.getContext('webgl2', {preserveDrawingBuffer: true, antialias: false});
    if (!gl) throw new Error('WebGL2 not available (try --gl=swangle)');
    this.gl = gl;
    const sh = (type: number, s: string) => {
      const x = gl.createShader(type)!;
      gl.shaderSource(x, s);
      gl.compileShader(x);
      if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x) ?? 'shader');
      return x;
    };
    const vs = sh(gl.VERTEX_SHADER, VS);
    const make = (name: string, fs: string, uniforms: string[]) => {
      const p = gl.createProgram()!;
      gl.attachShader(p, vs);
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'p');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
      const u: Record<string, WebGLUniformLocation | null> = {};
      for (const n of uniforms) u[n] = gl.getUniformLocation(p, n);
      this.progs[name] = {p, u};
    };
    make('motion', MOTION, ['uTex', 'uRes', 'uZoom', 'uSpin', 'uChroma', 'uDir', 'uC']);
    make('bright', BRIGHT, ['uTex', 'uTexel', 'uThr']);
    make('blur', BLUR, ['uTex', 'uStep']);
    make('final', FINAL, ['uTex', 'uB1', 'uB2', 'uRes', 'uBloom', 'uExp', 'uCon', 'uSat', 'uVig', 'uGrain', 'uFlash', 'uBox', 'uFrame', 'uTint', 'uLift']);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.src = this.texture();
    const W = out.width;
    const H = out.height;
    this.A = this.target(W, H);
    this.B1 = this.target(W / 4, H / 4);
    this.B1b = this.target(W / 4, H / 4);
    this.B2 = this.target(W / 8, H / 8);
    this.B2b = this.target(W / 8, H / 8);
  }

  texture() {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.texture();
    w = Math.round(w);
    h = Math.round(h);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {fb, tex, w, h};
  }

  pass(name: string, to: Target | null, inputs: WebGLTexture[], set: (u: Record<string, WebGLUniformLocation | null>) => void) {
    const gl = this.gl;
    const {p, u} = this.progs[name];
    gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, to ? to.fb : null);
    gl.viewport(0, 0, to ? to.w : this.out.width, to ? to.h : this.out.height);
    inputs.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
    });
    set(u);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  render(src: HTMLCanvasElement, fx: Fx) {
    const gl = this.gl;
    const W = this.out.width;
    const H = this.out.height;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    // (user, v14) no motion smear of any kind, ever: the radial / spin / directional blur is forced off
    // here, whatever a scene asks for (rigBlur, zoomBlurAt, whipAt). Only the RGB split remains in this pass.
    this.pass('motion', this.A, [this.src], (u) => {
      gl.uniform1i(u.uTex, 0);
      gl.uniform2f(u.uRes, W, H);
      gl.uniform1f(u.uZoom, NO_SMEAR ? 0 : fx.zoom);
      gl.uniform1f(u.uSpin, NO_SMEAR ? 0 : fx.spin);
      gl.uniform1f(u.uChroma, fx.chroma);
      gl.uniform2f(u.uDir, NO_SMEAR ? 0 : fx.dirX, NO_SMEAR ? 0 : -fx.dirY);
      gl.uniform2f(u.uC, fx.cx, 1 - fx.cy);
    });
    const blur2 = (a: Target, b: Target, r: number) => {
      this.pass('blur', b, [a.tex], (u) => {
        gl.uniform1i(u.uTex, 0);
        gl.uniform2f(u.uStep, r / a.w, 0);
      });
      this.pass('blur', a, [b.tex], (u) => {
        gl.uniform1i(u.uTex, 0);
        gl.uniform2f(u.uStep, 0, r / a.h);
      });
    };
    if (fx.bloom > 0) {
      this.pass('bright', this.B1, [this.A.tex], (u) => {
        gl.uniform1i(u.uTex, 0);
        gl.uniform2f(u.uTexel, 1 / W, 1 / H);
        gl.uniform1f(u.uThr, fx.threshold);
      });
      blur2(this.B1, this.B1b, 1.6);
      this.pass('blur', this.B2, [this.B1.tex], (u) => {
        gl.uniform1i(u.uTex, 0);
        gl.uniform2f(u.uStep, 0, 0);
      });
      blur2(this.B2, this.B2b, 2.4);
    }
    this.pass('final', null, [this.A.tex, this.B1.tex, this.B2.tex], (u) => {
      gl.uniform1i(u.uTex, 0);
      gl.uniform1i(u.uB1, 1);
      gl.uniform1i(u.uB2, 2);
      gl.uniform2f(u.uRes, W, H);
      gl.uniform1f(u.uBloom, fx.bloom);
      gl.uniform1f(u.uExp, fx.exposure);
      gl.uniform1f(u.uCon, fx.contrast);
      gl.uniform1f(u.uSat, fx.saturation);
      gl.uniform1f(u.uVig, fx.vignette);
      gl.uniform1f(u.uGrain, fx.grain);
      gl.uniform1f(u.uFlash, fx.flash);
      gl.uniform1f(u.uBox, fx.letterbox);
      gl.uniform1f(u.uFrame, fx.frame % 997);
      gl.uniform3f(u.uTint, ...fx.tint);
      gl.uniform3f(u.uLift, ...fx.lift);
    });
  }
}
