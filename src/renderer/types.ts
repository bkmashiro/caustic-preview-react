export interface RenderParams {
  azimuth: number;       // 0-360 deg
  elevation: number;     // 0-90 deg
  intensity: number;     // 0.1-10
  ior: number;           // 1.0-3.0
  exposure: number;      // 0.1-12
  spread: number;
  sigma: number;         // 0.005-0.3
  blockW: number;        // 0.5-4
  blockD: number;        // 0.5-4
  blockH: number;        // 0.05-4
  groundDist: number;    // 0.1-12
  groundY: number;       // -6 to 2
  surfaceMode: 'sinusoidal' | 'concentric' | 'diagonal' | 'random' | 'flat' | 'obj';
  bumpAmp: number;       // 0-0.3
  bumpFreq: number;      // 0.5-20
  surfaceRes: number;    // 16-256
  causticColor: [number, number, number];
  groundColor: [number, number, number];
  blockColor: [number, number, number];
  showBlock: boolean;
  showGrid: boolean;
  showCausticOnly: boolean;
}

export const DEFAULT_PARAMS: RenderParams = {
  azimuth: 45,
  elevation: 90,   // actual renderer default — NOT 45
  intensity: 2.0,  // actual renderer default — NOT 1.5
  ior: 1.62,
  exposure: 4.0,
  spread: 0.0,
  sigma: 0.05,
  blockW: 2.0,
  blockD: 2.0,
  blockH: 0.4,
  groundDist: 2.0,
  groundY: 0.0,
  surfaceMode: 'sinusoidal',
  bumpAmp: 0.05,
  bumpFreq: 4.0,
  surfaceRes: 128,
  causticColor: [1.0, 0.878, 0.565],
  groundColor: [0.125, 0.125, 0.157],
  blockColor: [0.541, 0.706, 0.816],
  showBlock: true,
  showGrid: true,
  showCausticOnly: false,
};

export interface CameraState {
  theta: number;
  phi: number;
  radius: number;
  target: [number, number, number];
  fov: number;
}

export const DEFAULT_CAMERA: CameraState = {
  theta: 0.6,
  phi: 0.9,
  radius: 6.0,
  target: [0, 0, 0],
  fov: 45,
};

export interface ObjSurface {
  positions: Float32Array;
  normals: Float32Array;
  gridW: number;
  gridH: number;
  blockTopAtParse?: number;
  requiredBlockH?: number;
}
