/**
 * CausticRenderer.ts — WebGL2 Caustic Renderer (migrated from caustic.js)
 *
 * Approach: Per-pixel backward ray tracing in the ground fragment shader.
 *  For each ground pixel, trace a ray backward through the glass block to
 *  determine where light from the source would have refracted and hit,
 *  then compute a Gaussian kernel contribution as the caustic intensity.
 *
 *  Pass 1 (GROUND): Draw ground quad; FS_GROUND does per-pixel backward RT.
 *  Pass 2 (SCENE):  Render the transparent glass block with Phong shading.
 *
 * WebGL2 shader code is verbatim from caustic.js — no GL logic modified.
 * Bug fixes are limited to the parameter validation layer only.
 */

import type { RenderParams, CameraState, ObjSurface } from './types';

// ─── Shader sources (verbatim from caustic.js) ────────────────────────────

const VS_GROUND = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos; // -1..1 quad

uniform mat4 uMVP;
uniform vec3 uGroundCorner; // world space corner of ground quad (-half, y, -half)
uniform vec2 uGroundSize;   // world space size of ground quad (full size)
uniform float uGroundHalf;  // half-size of caustic texture coverage

out vec2 vUV;
out vec3 vWorldPos;

void main() {
  // Map aPos (-1..1) to world XZ
  vec2 t = aPos * 0.5 + 0.5;
  vec3 world = vec3(
    uGroundCorner.x + t.x * uGroundSize.x,
    uGroundCorner.y,
    uGroundCorner.z + t.y * uGroundSize.y
  );
  vWorldPos = world;
  vUV = world.xz / (uGroundHalf * 2.0) + 0.5;
  gl_Position = uMVP * vec4(world, 1.0);
}
`;

const FS_GROUND = `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vWorldPos;

uniform sampler2D uCausticTex; // R32F: accumulated caustic splats
uniform float uIntensity;
uniform float uExposure;
uniform vec3  uLightDir;
uniform vec3  uCausticColor;
uniform vec3  uGroundColor;
uniform bool  uShowGrid;
uniform bool  uShowCausticOnly;

out vec4 fragColor;

float gridLine(vec2 p, float size) {
  vec2 g = abs(fract(p / size - 0.5) - 0.5) / fwidth(p / size);
  return 1.0 - min(min(g.x, g.y), 1.0);
}

void main() {
  float causticRaw = texture(uCausticTex, vUV).r;
  float caustic    = 1.0 - exp(-causticRaw * uIntensity * uExposure);

  vec3 col;
  if (uShowCausticOnly) {
    col = uCausticColor * caustic;
  } else {
    vec3 Lup  = normalize(-uLightDir);
    float diff = max(dot(vec3(0.0, 1.0, 0.0), Lup), 0.0) * 0.3 + 0.15;
    col = uGroundColor * (diff + 0.1) + uCausticColor * caustic;
    if (uShowGrid) col += vec3(gridLine(vWorldPos.xz, 0.5) * 0.06);
  }
  fragColor = vec4(col, 1.0);
}
`;

const VS_SCENE = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNorm;

uniform mat4 uMVP;
uniform mat4 uModel;
uniform mat3 uNormalMat;

out vec3 vNorm;
out vec3 vWorldPos;
out vec3 vViewPos;

void main() {
  vWorldPos = (uModel * vec4(aPos, 1.0)).xyz;
  vNorm = normalize(uNormalMat * aNorm);
  gl_Position = uMVP * vec4(aPos, 1.0);
}
`;

const FS_SCENE = `#version 300 es
precision highp float;
in vec3 vNorm;
in vec3 vWorldPos;

uniform vec3 uLightDir;    // toward light
uniform vec3 uCameraPos;
uniform vec3 uBlockColor;
uniform float uIOR;

out vec4 fragColor;

void main() {
  vec3 N = normalize(vNorm);
  vec3 L = normalize(-uLightDir);
  vec3 V = normalize(uCameraPos - vWorldPos);
  vec3 H = normalize(L + V);

  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, H), 0.0), 64.0);

  // Fresnel (Schlick)
  float F0 = ((uIOR - 1.0) / (uIOR + 1.0));
  F0 *= F0;
  float fresnel = F0 + (1.0 - F0) * pow(1.0 - max(dot(N, V), 0.0), 5.0);

  vec3 col = uBlockColor * (diff * 0.4 + 0.05);
  col += vec3(1.0) * spec * 0.8;
  col = mix(col, vec3(0.9, 0.95, 1.0), fresnel * 0.5);

  fragColor = vec4(col, 0.35 + fresnel * 0.4);
}
`;

const VS_CAUSTIC = `#version 300 es
precision highp float;

uniform sampler2D uSurfTex;  // RGBA32F: nx,ny,nz,heightOff
uniform int   uSurfW;
uniform int   uSurfH;
uniform float uBlockW;
uniform float uBlockD;
uniform float uBlockTop;
uniform float uBlockBottom;
uniform float uGroundY;
uniform float uIOR;
uniform vec3  uLightDir;
uniform float uGroundHalf;  // half-size of ground coverage (world units)

out vec2 vSurfXZ;   // original surface XZ (world units) — for Jacobian in FS

vec3 snell(vec3 I, vec3 N, float eta) {
  float cosI  = -dot(N, I);
  float sin2T = eta * eta * (1.0 - cosI * cosI);
  if (sin2T > 1.0) return vec3(0.0);
  return eta * I + (eta * cosI - sqrt(1.0 - sin2T)) * N;
}

// Returns gHit.xz on the ground, or (INF,INF) on TIR/invalid
vec2 traceToGround(float wx, float wz, float wy, vec3 Nt, vec3 L) {
  // Refract air → glass at top surface
  vec3 D1 = snell(L, Nt, 1.0 / uIOR);
  if (length(D1) < 0.01 || D1.y >= 0.0) return vec2(1e9);
  D1 = normalize(D1);

  // Trace to block bottom
  float t1 = (uBlockBottom - wy) / D1.y;
  if (t1 < 0.0) return vec2(1e9);
  vec3 B = vec3(wx, wy, wz) + t1 * D1;

  // Refract glass → air at flat bottom (N into glass = upward)
  vec3 D2 = snell(D1, vec3(0.0, 1.0, 0.0), uIOR);
  if (length(D2) < 0.01 || D2.y >= 0.0) return vec2(1e9);
  D2 = normalize(D2);

  // Trace to ground plane
  float t2 = (uGroundY - B.y) / D2.y;
  if (t2 < 0.0) return vec2(1e9);
  return B.xz + t2 * D2.xz;
}

void main() {
  // Each cell = 2 triangles = 6 vertices;  grid has (W-1)×(H-1) cells
  int cellIdx = gl_VertexID / 6;
  int corner  = gl_VertexID % 6;

  int ci = cellIdx % (uSurfW - 1);
  int cj = cellIdx / (uSurfW - 1);

  if (cj >= uSurfH - 1) {
    gl_Position = vec4(2.0, 0.0, 0.0, 1.0);
    vSurfXZ = vec2(0.0);
    return;
  }

  // Map corner index → cell vertex (0,0)(1,0)(1,1) / (0,0)(1,1)(0,1)
  int di = (corner == 1 || corner == 2 || corner == 4) ? 1 : 0;
  int dj = (corner == 2 || corner == 4 || corner == 5) ? 1 : 0;

  int si = ci + di;
  int sj = cj + dj;

  // Sample surface texture at this grid corner
  vec2 uv = (vec2(float(si), float(sj)) + 0.5) / vec2(float(uSurfW), float(uSurfH));
  vec4 sd  = texture(uSurfTex, uv);
  vec3 Nt  = length(sd.rgb) > 0.01 ? normalize(sd.rgb) : vec3(0.0, 1.0, 0.0);
  float h  = sd.a;

  float wx = (float(si) / float(uSurfW - 1) - 0.5) * uBlockW;
  float wz = (float(sj) / float(uSurfH - 1) - 0.5) * uBlockD;
  float wy = uBlockTop + h;

  vec3 L = normalize(uLightDir);
  vec2 gHit = traceToGround(wx, wz, wy, Nt, L);

  vSurfXZ = vec2(wx, wz);

  // Map gHit world XZ → FBO NDC [-1,1]
  vec2 ndc = (length(gHit) < 1e8) ? (gHit / uGroundHalf) : vec2(2.0);
  gl_Position = vec4(ndc, 0.0, 1.0);
}
`;

const FS_CAUSTIC = `#version 300 es
precision highp float;
in  vec2 vSurfXZ;        // interpolated original surface XZ (world units)
uniform float uJacScale; // = (CAUSTIC_W / groundSize)^2  →  flat lens → 1.0 output
out vec4 fragColor;

void main() {
  // Screen-space partial derivatives of original surface position (world units/FBO pixel)
  // Large Jacobian = many surface cells per ground pixel = caustic focus = bright
  vec2 dsx = dFdx(vSurfXZ);
  vec2 dsy = dFdy(vSurfXZ);
  float jac = abs(dsx.x * dsy.y - dsx.y * dsy.x); // 2D cross product (area element)
  float v   = jac * uJacScale;
  fragColor = vec4(v, v, v, v); // all channels for RGBA8 compat
}
`;

// ─── Math helpers ─────────────────────────────────────────────────────────

const mat4 = {
  identity: (): Float32Array => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]),
  multiply: (a: Float32Array, b: Float32Array): Float32Array => {
    const r = new Float32Array(16);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++)
        for (let k = 0; k < 4; k++)
          r[i*4+j] += a[k*4+j] * b[i*4+k];
    return r;
  },
  perspective: (fov: number, aspect: number, near: number, far: number): Float32Array => {
    const f = 1.0 / Math.tan(fov * Math.PI / 360);
    const nf = 1 / (near - far);
    const r = new Float32Array(16);
    r[0] = f / aspect; r[5] = f;
    r[10] = (far + near) * nf; r[11] = -1;
    r[14] = 2 * far * near * nf;
    return r;
  },
  lookAt: (eye: number[], center: number[], up: number[]): Float32Array => {
    const f = normalize(sub3(center, eye));
    const s = normalize(cross3(f, up));
    const u = cross3(s, f);
    const r = new Float32Array(16);
    r[0]=s[0]; r[4]=s[1]; r[8]=s[2];
    r[1]=u[0]; r[5]=u[1]; r[9]=u[2];
    r[2]=-f[0]; r[6]=-f[1]; r[10]=-f[2];
    r[12]=-dot3(s,eye); r[13]=-dot3(u,eye); r[14]=dot3(f,eye); r[15]=1;
    return r;
  },
  translate: (tx: number, ty: number, tz: number): Float32Array => {
    const r = mat4.identity();
    r[12]=tx; r[13]=ty; r[14]=tz;
    return r;
  },
};

const sub3 = (a: number[], b: number[]): number[] => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const dot3 = (a: number[], b: number[]): number => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross3 = (a: number[], b: number[]): number[] => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const normalize = (v: number[]): number[] => { const l = Math.sqrt(dot3(v,v)); return l>1e-10?[v[0]/l,v[1]/l,v[2]/l]:[0,1,0]; };

const CAUSTIC_W = 1024, CAUSTIC_H = 1024;

export class CausticRenderer {
  private gl!: WebGL2RenderingContext;
  private canvas!: HTMLCanvasElement;

  private progScene!: WebGLProgram;
  private progGround!: WebGLProgram;
  private progCaustic!: WebGLProgram;

  private groundVAO!: WebGLVertexArrayObject;
  private blockVAO!: WebGLVertexArrayObject | null;
  private blockIBO!: WebGLBuffer | null;
  private blockVertCount = 0;
  private emptyVAO!: WebGLVertexArrayObject;

  private causticFBO: WebGLFramebuffer | null = null;
  private causticTex: WebGLTexture | null = null;
  private causticUseFloat = false;

  private surfaceTex: WebGLTexture | null = null;
  private floatLinearSupported = false;

  private surfacePositions: Float32Array | null = null;
  private surfaceNormals: Float32Array | null = null;
  private surfaceGridW = 0;
  private surfaceGridH = 0;
  private surfaceDirty = true;

  private objSurface: ObjSurface | null = null;

  private params!: RenderParams;
  private camera!: CameraState;

  private rafId: number | null = null;

  public onPerfUpdate?: (ms: number) => void;
  public onWasmError?: (msg: string) => void;

  init(canvas: HTMLCanvasElement, params: RenderParams, camera: CameraState): boolean {
    this.canvas = canvas;
    this.params = { ...params };
    this.camera = { ...camera, target: [...camera.target] as [number,number,number] };

    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
    if (!gl) {
      console.error('WebGL2 not supported');
      return false;
    }
    this.gl = gl;

    gl.getExtension('EXT_color_buffer_float');
    this.causticUseFloat = !!gl.getExtension('EXT_float_blend');
    this.floatLinearSupported = !!gl.getExtension('OES_texture_float_linear');

    try {
      this.progScene   = this.createProgram(VS_SCENE,   FS_SCENE);
      this.progGround  = this.createProgram(VS_GROUND,  FS_GROUND);
      this.progCaustic = this.createProgram(VS_CAUSTIC, FS_CAUSTIC);
    } catch(e) {
      console.error('Shader compilation failed:', e);
      return false;
    }

    this.buildCausticFBO();
    this.emptyVAO = gl.createVertexArray()!;
    this.buildQuad();
    this.buildSurface();
    this.buildBlock();

    return true;
  }

  startLoop(): void {
    const loop = (now: number) => {
      this.render(now);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  updateParams(newParams: Partial<RenderParams>): void {
    const geometryKeys = new Set([
      'blockW', 'blockD', 'blockH', 'groundDist',
      'surfaceMode', 'bumpAmp', 'bumpFreq', 'surfaceRes'
    ]);
    for (const [k, v] of Object.entries(newParams)) {
      (this.params as unknown as Record<string, unknown>)[k] = v;
      if (geometryKeys.has(k)) this.surfaceDirty = true;
    }
  }

  updateCamera(camera: CameraState): void {
    this.camera = { ...camera, target: [...camera.target] as [number,number,number] };
  }

  setCameraPreset(preset: 'top' | 'side' | 'persp'): CameraState {
    const midY = this.params.groundDist * 0.4;
    const sceneR = Math.max(this.params.blockW, this.params.blockD, this.params.groundDist) * 1.8;

    let theta = 0, phi = 0, radius = 0;
    if (preset === 'top') {
      phi = Math.PI / 2 - 0.01;
      theta = 0;
      radius = sceneR * 1.2;
    } else if (preset === 'side') {
      phi = 0.08;
      theta = 0;
      radius = sceneR * 1.4;
    } else {
      phi = 0.75;
      theta = 0.6;
      radius = sceneR * 1.3;
    }

    this.camera = { ...this.camera, theta, phi, radius, target: [0, midY, 0] };
    return { ...this.camera };
  }

  loadOBJ(text: string): { gridW: number; gridH: number } | null {
    const result = this.parseOBJ(text);
    if (!result) return null;
    this.objSurface = result;
    this.params.surfaceMode = 'obj';
    this.surfaceDirty = true;
    return { gridW: result.gridW, gridH: result.gridH };
  }

  loadCausticOBJ(text: string): { requiredBlockH: number; gridW: number; gridH: number } | null {
    const result = this.parseCausticOBJ(text);
    if (!result) return null;
    this.objSurface = result;
    this.params.surfaceMode = 'obj';
    this.surfaceDirty = true;
    return {
      requiredBlockH: result.requiredBlockH ?? 0,
      gridW: result.gridW,
      gridH: result.gridH,
    };
  }

  getCamera(): CameraState {
    return { ...this.camera, target: [...this.camera.target] as [number,number,number] };
  }

  // ─── Interaction helpers ───────────────────────────────────────────────────

  orbit(dx: number, dy: number): CameraState {
    this.camera.theta -= dx * 0.007;
    this.camera.phi = Math.max(0.01, Math.min(Math.PI / 2, this.camera.phi - dy * 0.007));
    return this.getCamera();
  }

  pan(dx: number, dy: number): CameraState {
    const scale = this.camera.radius * 0.003;
    const t = this.camera.theta;
    this.camera.target[0] -= Math.cos(t) * dx * scale;
    this.camera.target[2] -= Math.sin(t) * dx * scale;
    this.camera.target[1] -= dy * scale;
    return this.getCamera();
  }

  zoom(delta: number): CameraState {
    this.camera.radius = Math.max(1, Math.min(20, this.camera.radius + delta * 0.01));
    return this.getCamera();
  }

  // ─── GL utilities ──────────────────────────────────────────────────────────

  private createShader(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const err = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`Shader compile error:\n${err}`);
    }
    return s;
  }

  private createProgram(vsSrc: string, fsSrc: string): WebGLProgram {
    const gl = this.gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, this.createShader(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(p, this.createShader(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const err = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error(`Program link error:\n${err}`);
    }
    return p;
  }

  private ul(prog: WebGLProgram, name: string): WebGLUniformLocation | null {
    return this.gl.getUniformLocation(prog, name);
  }

  // ─── Surface texture upload ───────────────────────────────────────────────

  private uploadSurfaceTex(): void {
    const gl = this.gl;
    if (!this.surfacePositions) return;
    if (!this.surfaceTex) this.surfaceTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.surfaceTex);

    const N = this.surfaceGridW * this.surfaceGridH;
    const data = new Float32Array(N * 4);
    const blockTopY = this.params.groundDist;
    for (let i = 0; i < N; i++) {
      data[i*4+0] = this.surfaceNormals![i*3+0];
      data[i*4+1] = this.surfaceNormals![i*3+1];
      data[i*4+2] = this.surfaceNormals![i*3+2];
      data[i*4+3] = this.surfacePositions![i*3+1] - blockTopY;
    }

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, this.surfaceGridW, this.surfaceGridH, 0, gl.RGBA, gl.FLOAT, data);
    const filter = this.floatLinearSupported ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // ─── Caustic FBO ─────────────────────────────────────────────────────────

  private buildCausticFBO(): void {
    const gl = this.gl;
    if (this.causticFBO) {
      gl.deleteFramebuffer(this.causticFBO);
      gl.deleteTexture(this.causticTex);
    }
    this.causticTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.causticTex);
    if (this.causticUseFloat) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, CAUSTIC_W, CAUSTIC_H, 0, gl.RED, gl.FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, CAUSTIC_W, CAUSTIC_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.causticFBO = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.causticFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.causticTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  // ─── Surface generation ───────────────────────────────────────────────────

  private heightField(x: number, z: number, mode: string, amp: number, freq: number): number {
    switch (mode) {
      case 'sinusoidal':
        return amp * (Math.sin(x * freq) * Math.cos(z * freq));
      case 'concentric': {
        const r = Math.sqrt(x*x + z*z);
        return amp * Math.cos(r * freq * 1.5);
      }
      case 'diagonal':
        return amp * Math.sin((x + z) * freq * 0.7071);
      case 'random': {
        const px = x * freq * 0.3;
        const pz = z * freq * 0.3;
        const h = Math.sin(px*2.1+1.3)*Math.cos(pz*1.7+0.8)
                + Math.sin(px*4.3+2.1)*Math.cos(pz*3.9+1.4)*0.5
                + Math.sin(px*8.7+0.5)*Math.cos(pz*7.3+2.0)*0.25;
        return amp * h / 1.75;
      }
      case 'flat':
      default:
        return 0;
    }
  }

  private buildSurface(): void {
    const p = this.params;
    const res = p.surfaceRes;
    const hw = p.blockW / 2;
    const hd = p.blockD / 2;
    const topY = p.groundDist;

    let positions: Float32Array, normals: Float32Array, gridW: number, gridH: number;

    if (p.surfaceMode === 'obj' && this.objSurface) {
      const TARGET_RES = 128;
      const srcW = this.objSurface.gridW, srcH = this.objSurface.gridH;
      const srcPos = this.objSurface.positions, srcNrm = this.objSurface.normals;

      if (srcW >= TARGET_RES && srcH >= TARGET_RES) {
        positions = new Float32Array(srcPos);
        normals = new Float32Array(srcNrm);
        gridW = srcW; gridH = srcH;
      } else {
        gridW = TARGET_RES; gridH = TARGET_RES;
        positions = new Float32Array(gridW * gridH * 3);
        normals   = new Float32Array(gridW * gridH * 3);

        for (let dj = 0; dj < gridH; dj++) {
          for (let di = 0; di < gridW; di++) {
            const fx = di / (gridW - 1) * (srcW - 1);
            const fy = dj / (gridH - 1) * (srcH - 1);
            const ix = Math.min(Math.floor(fx), srcW - 2);
            const iy = Math.min(Math.floor(fy), srcH - 2);
            const tx = fx - ix, ty = fy - iy;
            const i00 = (iy * srcW + ix) * 3;
            const i10 = (iy * srcW + ix + 1) * 3;
            const i01 = ((iy + 1) * srcW + ix) * 3;
            const i11 = ((iy + 1) * srcW + ix + 1) * 3;
            const out  = (dj * gridW + di) * 3;
            const w00 = (1-tx)*(1-ty), w10 = tx*(1-ty);
            const w01 = (1-tx)*ty,     w11 = tx*ty;
            for (let c = 0; c < 3; c++) {
              positions[out+c] = srcPos[i00+c]*w00 + srcPos[i10+c]*w10
                               + srcPos[i01+c]*w01 + srcPos[i11+c]*w11;
              normals[out+c]   = srcNrm[i00+c]*w00 + srcNrm[i10+c]*w10
                               + srcNrm[i01+c]*w01 + srcNrm[i11+c]*w11;
            }
            const nx=normals[out], ny=normals[out+1], nz=normals[out+2];
            const nl = Math.sqrt(nx*nx+ny*ny+nz*nz) || 1;
            normals[out] /= nl; normals[out+1] /= nl; normals[out+2] /= nl;
          }
        }
      }
    } else {
      gridW = res; gridH = res;
      const N = gridW * gridH;
      positions = new Float32Array(N * 3);
      normals = new Float32Array(N * 3);

      const mode = p.surfaceMode === 'obj' ? 'sinusoidal' : p.surfaceMode;
      const amp = p.bumpAmp;
      const freq = p.bumpFreq;
      const dx = p.blockW / (gridW - 1);
      const dz = p.blockD / (gridH - 1);

      for (let j = 0; j < gridH; j++) {
        for (let i = 0; i < gridW; i++) {
          const idx = j * gridW + i;
          const wx = -hw + i * dx;
          const wz = -hd + j * dz;
          const wy = topY + this.heightField(wx, wz, mode, amp, freq);
          positions[idx*3+0] = wx;
          positions[idx*3+1] = wy;
          positions[idx*3+2] = wz;

          const eps = dx * 0.5;
          const hL = this.heightField(wx - eps, wz, mode, amp, freq);
          const hR = this.heightField(wx + eps, wz, mode, amp, freq);
          const hD = this.heightField(wx, wz - eps, mode, amp, freq);
          const hU = this.heightField(wx, wz + eps, mode, amp, freq);
          const nx = -(hR - hL) / (2 * eps);
          const nz = -(hU - hD) / (2 * eps);
          const ny = 1.0;
          const nl = Math.sqrt(nx*nx + ny*ny + nz*nz);
          normals[idx*3+0] = nx / nl;
          normals[idx*3+1] = ny / nl;
          normals[idx*3+2] = nz / nl;
        }
      }
    }

    // For OBJ mode: shift Y to reflect current blockTop
    if (p.surfaceMode === 'obj' && this.objSurface && this.objSurface.blockTopAtParse !== undefined) {
      const curBlockTop = p.groundDist;
      const shift = curBlockTop - this.objSurface.blockTopAtParse;
      if (Math.abs(shift) > 1e-6) {
        for (let i = 0; i < positions!.length / 3; i++) {
          positions![i*3+1] += shift;
        }
        this.objSurface.blockTopAtParse = curBlockTop;
      }
    }

    this.surfacePositions = positions!;
    this.surfaceNormals = normals!;
    this.surfaceGridW = gridW!;
    this.surfaceGridH = gridH!;

    this.uploadSurfaceTex();
    this.surfaceDirty = false;
  }

  // ─── Block mesh ────────────────────────────────────────────────────────────

  private buildBlock(): void {
    const gl = this.gl;
    if (this.blockVAO) {
      gl.deleteVertexArray(this.blockVAO);
      if (this.blockIBO) gl.deleteBuffer(this.blockIBO);
    }
    this.blockVAO = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;
    this.blockIBO = gl.createBuffer()!;

    const p = this.params;
    const hw = p.blockW / 2;
    const hd = p.blockD / 2;
    const top = p.groundDist;
    const bot = p.groundDist - p.blockH;

    const verts: number[] = [];
    const indices: number[] = [];

    const useOBJ = p.surfaceMode === 'obj' && this.surfacePositions && this.surfaceGridW >= 2 && this.surfaceGridH >= 2;

    if (useOBJ && this.surfacePositions) {
      const gW = this.surfaceGridW, gH = this.surfaceGridH;
      const P = this.surfacePositions;

      const topBase = verts.length / 6;
      for (let j = 0; j < gH; j++) {
        for (let i = 0; i < gW; i++) {
          const idx = j * gW + i;
          verts.push(
            P[idx*3+0], P[idx*3+1], P[idx*3+2],
            this.surfaceNormals![idx*3+0], this.surfaceNormals![idx*3+1], this.surfaceNormals![idx*3+2]
          );
        }
      }
      for (let j = 0; j < gH - 1; j++) {
        for (let i = 0; i < gW - 1; i++) {
          const a = topBase + j*gW + i;
          const b = a + 1, c = a + gW, d = a + gW + 1;
          indices.push(a, b, d, a, d, c);
        }
      }

      // Bottom face
      {
        const b = verts.length / 6;
        verts.push(-hw, bot, -hd,  0,-1,0,
                    hw, bot, -hd,  0,-1,0,
                    hw, bot,  hd,  0,-1,0,
                   -hw, bot,  hd,  0,-1,0);
        indices.push(b, b+2, b+1, b, b+3, b+2);
      }

      const sideQuad = (i0: number, i1: number, nx: number, ny: number, nz: number) => {
        const x0=P[i0*3], y0=P[i0*3+1], z0=P[i0*3+2];
        const x1=P[i1*3], y1=P[i1*3+1], z1=P[i1*3+2];
        const b = verts.length / 6;
        verts.push(
          x0, y0, z0,  nx, ny, nz,
          x1, y1, z1,  nx, ny, nz,
          x1, bot, z1, nx, ny, nz,
          x0, bot, z0, nx, ny, nz
        );
        indices.push(b, b+1, b+2, b, b+2, b+3);
      };

      for (let i = 0; i < gW - 1; i++) sideQuad(0*gW + i, 0*gW + i+1, 0, 0, -1);
      for (let i = 0; i < gW - 1; i++) sideQuad((gH-1)*gW + i+1, (gH-1)*gW + i, 0, 0, 1);
      for (let j = 0; j < gH - 1; j++) sideQuad((j+1)*gW, j*gW, -1, 0, 0);
      for (let j = 0; j < gH - 1; j++) sideQuad(j*gW + (gW-1), (j+1)*gW + (gW-1), 1, 0, 0);

    } else {
      const res  = Math.min(p.surfaceRes, 64);
      const mode = p.surfaceMode;
      const amp  = p.bumpAmp;
      const freq = p.bumpFreq;

      {
        const base = verts.length / 6;
        verts.push(-hw, bot, -hd,  0,-1,0,
                    hw, bot, -hd,  0,-1,0,
                    hw, bot,  hd,  0,-1,0,
                   -hw, bot,  hd,  0,-1,0);
        indices.push(base, base+1, base+2, base, base+2, base+3);
      }

      {
        const dx = p.blockW / (res - 1);
        const dz = p.blockD / (res - 1);
        const base = verts.length / 6;
        for (let j = 0; j < res; j++) {
          for (let i = 0; i < res; i++) {
            const wx = -hw + i * dx;
            const wz = -hd + j * dz;
            const wy = top + this.heightField(wx, wz, mode, amp, freq);
            const eps = dx * 0.5;
            const hL = this.heightField(wx-eps, wz, mode, amp, freq);
            const hR = this.heightField(wx+eps, wz, mode, amp, freq);
            const hD = this.heightField(wx, wz-eps, mode, amp, freq);
            const hU = this.heightField(wx, wz+eps, mode, amp, freq);
            const nx = -(hR-hL)/(2*eps), nz = -(hU-hD)/(2*eps), ny = 1.0;
            const nl = Math.sqrt(nx*nx+ny*ny+nz*nz);
            verts.push(wx, wy, wz, nx/nl, ny/nl, nz/nl);
          }
        }
        for (let j = 0; j < res-1; j++) {
          for (let i = 0; i < res-1; i++) {
            const a = base + j*res+i;
            const b = a+1, c = a+res, d = a+res+1;
            indices.push(a, b, d, a, d, c);
          }
        }
      }

      const sides: number[][][] = [
        [[-hw,bot,-hd,-1,0,0], [-hw,bot,hd,-1,0,0], [-hw,top,-hd,-1,0,0], [-hw,top,hd,-1,0,0]],
        [[ hw,bot, hd, 1,0,0], [ hw,bot,-hd, 1,0,0], [ hw,top, hd, 1,0,0], [ hw,top,-hd, 1,0,0]],
        [[ hw,bot,-hd,0,0,-1], [-hw,bot,-hd,0,0,-1], [ hw,top,-hd,0,0,-1], [-hw,top,-hd,0,0,-1]],
        [[-hw,bot, hd,0,0, 1], [ hw,bot, hd,0,0, 1], [-hw,top, hd,0,0, 1], [ hw,top, hd,0,0, 1]],
      ];
      for (const side of sides) {
        const base = verts.length / 6;
        for (const v of side) verts.push(...v);
        indices.push(base, base+1, base+2, base+1, base+3, base+2);
      }
    }

    const va = new Float32Array(verts);
    const ia = new Uint32Array(indices);
    this.blockVertCount = indices.length;

    gl.bindVertexArray(this.blockVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, va, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.blockIBO);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ia, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  // ─── Ground quad ──────────────────────────────────────────────────────────

  private buildQuad(): void {
    const gl = this.gl;
    const data = new Float32Array([-1,-1, 1,-1, -1,1, 1,1]);
    this.groundVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.groundVAO);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  // ─── Light direction ──────────────────────────────────────────────────────

  private getLightDir(): [number,number,number] {
    const az = this.params.azimuth * Math.PI / 180;
    const el = this.params.elevation * Math.PI / 180;
    return [
      -Math.cos(el) * Math.sin(az),
      -Math.sin(el),
      -Math.cos(el) * Math.cos(az),
    ];
  }

  // ─── Camera matrices ───────────────────────────────────────────────────────

  private getCameraPos(): number[] {
    const { theta, phi, radius, target } = this.camera;
    return [
      target[0] + radius * Math.cos(phi) * Math.sin(theta),
      target[1] + radius * Math.sin(phi),
      target[2] + radius * Math.cos(phi) * Math.cos(theta),
    ];
  }

  private getMVP(model?: Float32Array): Float32Array {
    const V = mat4.lookAt(this.getCameraPos(), this.camera.target, [0,1,0]);
    const aspect = this.canvas.width / this.canvas.height;
    const P = mat4.perspective(this.camera.fov, aspect, 0.01, 100);
    if (model) return mat4.multiply(P, mat4.multiply(V, model));
    return mat4.multiply(P, V);
  }

  private getNormalMatrix(model: Float32Array): Float32Array {
    return new Float32Array([
      model[0], model[1], model[2],
      model[4], model[5], model[6],
      model[8], model[9], model[10],
    ]);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  private render(_now: number): void {
    const gl = this.gl;

    if (this.surfaceDirty) {
      this.buildSurface();
      this.buildBlock();
    }

    const t0 = performance.now();
    const p = this.params;
    const lightDir = this.getLightDir();
    const groundY  = p.groundY;
    const blockTop    = p.groundDist;
    const blockBottom = p.groundDist - p.blockH;
    const groundSize  = Math.max(p.blockW, p.blockD) * 2 + Math.max(blockBottom, 0.1) * 4;
    const groundHalf  = groundSize / 2;

    const W = this.canvas.width, H = this.canvas.height;

    // ── Pass 0: Caustic forward-splat ────────────────────────────────────────
    if (this.surfaceTex) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.causticFBO);
      gl.viewport(0, 0, CAUSTIC_W, CAUSTIC_H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);

      gl.useProgram(this.progCaustic);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.surfaceTex);
      gl.uniform1i(this.ul(this.progCaustic, 'uSurfTex'),    0);
      gl.uniform1i(this.ul(this.progCaustic, 'uSurfW'),      this.surfaceGridW);
      gl.uniform1i(this.ul(this.progCaustic, 'uSurfH'),      this.surfaceGridH);
      gl.uniform1f(this.ul(this.progCaustic, 'uBlockW'),     p.blockW);
      gl.uniform1f(this.ul(this.progCaustic, 'uBlockD'),     p.blockD);
      gl.uniform1f(this.ul(this.progCaustic, 'uBlockTop'),   blockTop);
      gl.uniform1f(this.ul(this.progCaustic, 'uBlockBottom'),blockBottom);
      gl.uniform1f(this.ul(this.progCaustic, 'uGroundY'),    groundY);
      gl.uniform1f(this.ul(this.progCaustic, 'uIOR'),        p.ior);
      gl.uniform3fv(this.ul(this.progCaustic, 'uLightDir'),  lightDir);
      gl.uniform1f(this.ul(this.progCaustic, 'uGroundHalf'), groundHalf);
      const jacScale = (CAUSTIC_W / groundSize) * (CAUSTIC_H / groundSize);
      gl.uniform1f(this.ul(this.progCaustic, 'uJacScale'), jacScale);

      gl.bindVertexArray(this.emptyVAO);
      gl.drawArrays(gl.TRIANGLES, 0, (this.surfaceGridW - 1) * (this.surfaceGridH - 1) * 6);
      gl.bindVertexArray(null);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.disable(gl.BLEND);
    }

    // ── Pass 1: Ground ────────────────────────────────────────────────────────
    const model  = mat4.identity();
    const mvp    = this.getMVP(model);
    const cameraPos = this.getCameraPos();

    gl.viewport(0, 0, W, H);
    gl.clearColor(0.05, 0.05, 0.08, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    gl.useProgram(this.progGround);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.causticTex);
    gl.uniform1i(this.ul(this.progGround, 'uCausticTex'),     0);
    gl.uniform1f(this.ul(this.progGround, 'uIntensity'),       p.intensity);
    gl.uniform1f(this.ul(this.progGround, 'uExposure'),        p.exposure);
    gl.uniform3fv(this.ul(this.progGround, 'uLightDir'),       lightDir);
    gl.uniform3fv(this.ul(this.progGround, 'uCausticColor'),   p.causticColor);
    gl.uniform3fv(this.ul(this.progGround, 'uGroundColor'),    p.groundColor);
    gl.uniform1i(this.ul(this.progGround, 'uShowGrid'),        p.showGrid ? 1 : 0);
    gl.uniform1i(this.ul(this.progGround, 'uShowCausticOnly'), p.showCausticOnly ? 1 : 0);
    gl.uniform3fv(this.ul(this.progGround, 'uGroundCorner'),   [-groundHalf, groundY, -groundHalf]);
    gl.uniform2fv(this.ul(this.progGround, 'uGroundSize'),     [groundSize, groundSize]);
    gl.uniform1f(this.ul(this.progGround, 'uGroundHalf'),      groundHalf);
    gl.uniformMatrix4fv(this.ul(this.progGround, 'uMVP'), false, mvp);

    gl.bindVertexArray(this.groundVAO);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    // ── Pass 2: Glass block ───────────────────────────────────────────────────
    if (p.showBlock && !p.showCausticOnly && this.blockVAO) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);

      gl.useProgram(this.progScene);
      gl.uniformMatrix4fv(this.ul(this.progScene, 'uMVP'), false, mvp);
      gl.uniformMatrix4fv(this.ul(this.progScene, 'uModel'), false, model);
      gl.uniformMatrix3fv(this.ul(this.progScene, 'uNormalMat'), false, this.getNormalMatrix(model));
      gl.uniform3fv(this.ul(this.progScene, 'uLightDir'), lightDir);
      gl.uniform3fv(this.ul(this.progScene, 'uCameraPos'), cameraPos);
      gl.uniform3fv(this.ul(this.progScene, 'uBlockColor'), p.blockColor);
      gl.uniform1f(this.ul(this.progScene, 'uIOR'), p.ior);

      gl.bindVertexArray(this.blockVAO);
      gl.drawElements(gl.TRIANGLES, this.blockVertCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);

      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    const ms = performance.now() - t0;
    this.onPerfUpdate?.(ms);
  }

  // ─── OBJ parsers (verbatim from caustic.js) ───────────────────────────────

  private parseOBJ(text: string): ObjSurface | null {
    const rawVerts: number[][] = [];
    const rawNorms: number[][] = [];

    for (const line of text.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === 'v') {
        rawVerts.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
      } else if (parts[0] === 'vn') {
        rawNorms.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
      }
    }

    if (rawVerts.length === 0) return null;

    let maxY = -Infinity;
    for (const v of rawVerts) maxY = Math.max(maxY, v[1]);

    const allVerts = [...rawVerts];
    allVerts.sort((a,b) => a[2] === b[2] ? a[0]-b[0] : a[2]-b[2]);

    const xs = [...new Set(allVerts.map(v => Math.round(v[0]*1000)))].sort((a,b)=>a-b);
    const zs = [...new Set(allVerts.map(v => Math.round(v[2]*1000)))].sort((a,b)=>a-b);
    const gridW = xs.length;
    const gridH = zs.length;

    if (gridW < 2 || gridH < 2) {
      const N = Math.min(rawVerts.length, 65536);
      const positions = new Float32Array(N * 3);
      const normals = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        positions[i*3+0] = rawVerts[i][0];
        positions[i*3+1] = rawVerts[i][1];
        positions[i*3+2] = rawVerts[i][2];
        normals[i*3+0] = 0; normals[i*3+1] = 1; normals[i*3+2] = 0;
      }
      return { positions, normals, gridW: N, gridH: 1 };
    }

    const N = gridW * gridH;
    const positions = new Float32Array(N * 3);
    const normals = new Float32Array(N * 3);

    const vertMap = new Map<string, number[]>();
    for (const v of rawVerts) {
      const key = `${Math.round(v[0]*1000)},${Math.round(v[2]*1000)}`;
      vertMap.set(key, v);
    }

    for (let j = 0; j < gridH; j++) {
      for (let i = 0; i < gridW; i++) {
        const idx = j * gridW + i;
        const key = `${xs[i]},${zs[j]}`;
        const v = vertMap.get(key) || [xs[i]/1000, maxY, zs[j]/1000];
        positions[idx*3+0] = v[0];
        positions[idx*3+1] = v[1];
        positions[idx*3+2] = v[2];
        normals[idx*3+0] = 0;
        normals[idx*3+1] = 1;
        normals[idx*3+2] = 0;
      }
    }

    for (let j = 1; j < gridH-1; j++) {
      for (let i = 1; i < gridW-1; i++) {
        const idx = j*gridW+i;
        const L = Array.from(positions.slice((j*gridW+i-1)*3, (j*gridW+i-1)*3+3));
        const R = Array.from(positions.slice((j*gridW+i+1)*3, (j*gridW+i+1)*3+3));
        const D = Array.from(positions.slice(((j-1)*gridW+i)*3, ((j-1)*gridW+i)*3+3));
        const U = Array.from(positions.slice(((j+1)*gridW+i)*3, ((j+1)*gridW+i)*3+3));
        const dx = [R[0]-L[0], R[1]-L[1], R[2]-L[2]];
        const dz = [U[0]-D[0], U[1]-D[1], U[2]-D[2]];
        const n = cross3(dz, dx);
        const nl = Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]) || 1;
        normals[idx*3+0] = n[0]/nl;
        normals[idx*3+1] = Math.abs(n[1]/nl);
        normals[idx*3+2] = n[2]/nl;
      }
    }

    return { positions, normals, gridW, gridH };
  }

  private parseCausticOBJ(text: string): ObjSurface | null {
    const rawVerts: number[][] = [];
    for (const line of text.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === 'v') {
        rawVerts.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
      }
    }

    if (rawVerts.length === 0) return null;

    const N = Math.floor(rawVerts.length / 2);
    const topVerts = rawVerts.slice(0, N);

    const xSet = [...new Set(topVerts.map(v => Math.round(v[0] * 100000)))].sort((a, b) => a - b);
    const ySet = [...new Set(topVerts.map(v => Math.round(v[1] * 100000)))].sort((a, b) => a - b);
    const gridW = xSet.length;
    const gridH = ySet.length;

    if (gridW < 2 || gridH < 2) return null;

    const p = this.params;
    const { blockW, blockD } = p;

    const positions = new Float32Array(gridW * gridH * 3);
    const normals   = new Float32Array(gridW * gridH * 3);

    const vertMap = new Map<string, number[]>();
    for (const v of topVerts) {
      const xi = Math.round(v[0] * 100000);
      const yi = Math.round(v[1] * 100000);
      vertMap.set(`${xi},${yi}`, v);
    }

    for (let j = 0; j < gridH; j++) {
      for (let i = 0; i < gridW; i++) {
        const idx = j * gridW + i;
        const key = `${xSet[i]},${ySet[j]}`;
        const v = vertMap.get(key) || [xSet[i] / 100000, ySet[j] / 100000, 0];
        const obj_x = v[0];
        const obj_y = v[1];
        const obj_z = v[2];

        positions[idx*3+0] = (obj_x - 0.5) * blockW;
        positions[idx*3+1] = p.groundDist + obj_z * blockW;
        positions[idx*3+2] = (obj_y - 0.5) * blockD;

        normals[idx*3+0] = 0;
        normals[idx*3+1] = 1;
        normals[idx*3+2] = 0;
      }
    }

    for (let j = 1; j < gridH - 1; j++) {
      for (let i = 1; i < gridW - 1; i++) {
        const idx = j * gridW + i;
        const L = Array.from(positions.slice((j*gridW + i - 1)*3, (j*gridW + i - 1)*3 + 3));
        const R = Array.from(positions.slice((j*gridW + i + 1)*3, (j*gridW + i + 1)*3 + 3));
        const D = Array.from(positions.slice(((j-1)*gridW + i)*3, ((j-1)*gridW + i)*3 + 3));
        const U = Array.from(positions.slice(((j+1)*gridW + i)*3, ((j+1)*gridW + i)*3 + 3));
        const dx = [R[0]-L[0], R[1]-L[1], R[2]-L[2]];
        const dz = [U[0]-D[0], U[1]-D[1], U[2]-D[2]];
        const n = cross3(dz, dx);
        const nl = Math.sqrt(n[0]*n[0] + n[1]*n[1] + n[2]*n[2]) || 1;
        normals[idx*3+0] = n[0] / nl;
        normals[idx*3+1] = Math.abs(n[1] / nl);
        normals[idx*3+2] = n[2] / nl;
      }
    }

    let maxAbsObjZ = 0;
    for (const v of topVerts) maxAbsObjZ = Math.max(maxAbsObjZ, Math.abs(v[2]));
    const requiredBlockH = maxAbsObjZ * blockW + 0.02;

    const blockBottomY = p.groundDist - p.blockH;
    for (let i = 0; i < gridW * gridH; i++) {
      if (positions[i*3+1] < blockBottomY) {
        positions[i*3+1] = blockBottomY;
      }
    }

    return { positions, normals, gridW, gridH,
             blockTopAtParse: p.groundDist,
             requiredBlockH };
  }
}
