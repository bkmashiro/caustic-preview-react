import { useRef, useEffect, useCallback } from 'react';
import { CausticRenderer } from '../renderer/CausticRenderer';
import type { RenderParams, CameraState } from '../renderer/types';

interface UseCausticRendererOptions {
  params: RenderParams;
  camera: CameraState;
  onPerfUpdate?: (ms: number) => void;
  onCameraChange?: (cam: CameraState) => void;
}

export function useCausticRenderer({
  params,
  camera,
  onPerfUpdate,
  onCameraChange,
}: UseCausticRendererOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CausticRenderer | null>(null);

  // Keep latest callbacks/state in refs to avoid stale closures
  const paramsRef = useRef(params);
  const cameraRef = useRef(camera);
  const onCameraChangeRef = useRef(onCameraChange);
  paramsRef.current = params;
  cameraRef.current = camera;
  onCameraChangeRef.current = onCameraChange;

  // Mount renderer once
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const renderer = new CausticRenderer();
    renderer.onPerfUpdate = (ms) => onPerfUpdate?.(ms);
    const ok = renderer.init(canvas, paramsRef.current, cameraRef.current);
    if (!ok) {
      console.error('Failed to init CausticRenderer');
      return;
    }
    rendererRef.current = renderer;
    renderer.startLoop();

    // ── Mouse / touch interaction ───────────────────────────────────────────
    let dragging = false;
    let rightDrag = false;
    let lastX = 0, lastY = 0;

    const onMouseDown = (e: MouseEvent) => {
      dragging = true;
      rightDrag = e.button === 2;
      lastX = e.clientX;
      lastY = e.clientY;
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const r = rendererRef.current!;
      const newCam = rightDrag ? r.pan(dx, dy) : r.orbit(dx, dy);
      onCameraChangeRef.current?.(newCam);
    };

    const onMouseUp = () => { dragging = false; };

    const onWheel = (e: WheelEvent) => {
      const newCam = rendererRef.current!.zoom(e.deltaY);
      onCameraChangeRef.current?.(newCam);
      e.preventDefault();
    };

    let touches: TouchList | null = null;

    const onTouchStart = (e: TouchEvent) => {
      touches = e.touches;
      e.preventDefault();
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!touches) return;
      const r = rendererRef.current!;
      if (e.touches.length === 1 && touches.length >= 1) {
        const dx = e.touches[0].clientX - touches[0].clientX;
        const dy = e.touches[0].clientY - touches[0].clientY;
        const newCam = r.orbit(dx / 0.007, dy / 0.007);  // compensate for 0.007 factor in orbit
        onCameraChangeRef.current?.(newCam);
      } else if (e.touches.length === 2 && touches.length >= 2) {
        const d0 = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);
        const d1 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        const newCam = r.zoom((d0 - d1) * 0.5);
        onCameraChangeRef.current?.(newCam);
      }
      touches = e.touches;
      e.preventDefault();
    };

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });

    return () => {
      renderer.stopLoop();
      rendererRef.current = null;
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // Sync params to renderer whenever they change
  useEffect(() => {
    rendererRef.current?.updateParams(params);
  }, [params]);

  // Sync camera to renderer whenever it changes externally (preset buttons etc)
  useEffect(() => {
    rendererRef.current?.updateCamera(camera);
  }, [camera]);

  const setCameraPreset = useCallback((preset: 'top' | 'side' | 'persp') => {
    const newCam = rendererRef.current?.setCameraPreset(preset);
    if (newCam) onCameraChangeRef.current?.(newCam);
  }, []);

  const loadOBJ = useCallback((text: string) => {
    return rendererRef.current?.loadOBJ(text) ?? null;
  }, []);

  const loadCausticOBJ = useCallback((text: string) => {
    return rendererRef.current?.loadCausticOBJ(text) ?? null;
  }, []);

  return { canvasRef, setCameraPreset, loadOBJ, loadCausticOBJ };
}
