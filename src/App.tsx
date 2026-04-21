import { useState, useCallback, useEffect } from 'react';
import { DEFAULT_PARAMS, DEFAULT_CAMERA } from './renderer/types';
import type { RenderParams, CameraState } from './renderer/types';
import { useCausticRenderer } from './hooks/useCausticRenderer';
import ControlPanel from './components/ControlPanel';
import './styles/global.css';

export default function App() {
  const [params, setParams] = useState<RenderParams>(DEFAULT_PARAMS);
  const [camera, setCamera] = useState<CameraState>(DEFAULT_CAMERA);
  const [perfMs, setPerfMs] = useState<number | null>(null);
  const [infoVisible, setInfoVisible] = useState(true);

  const handleParamsChange = useCallback((partial: Partial<RenderParams>) => {
    setParams(prev => ({ ...prev, ...partial }));
  }, []);

  const handleCameraChange = useCallback((cam: CameraState) => {
    setCamera(cam);
  }, []);

  const { canvasRef, setCameraPreset, loadOBJ, loadCausticOBJ } = useCausticRenderer({
    params,
    camera,
    onPerfUpdate: setPerfMs,
    onCameraChange: handleCameraChange,
  });

  const handlePreset = useCallback((preset: 'top' | 'side' | 'persp') => {
    setCameraPreset(preset);
  }, [setCameraPreset]);

  const handleObjLoaded = useCallback((text: string) => {
    const result = loadOBJ(text);
    if (!result) {
      console.error('Failed to parse OBJ');
    }
    setParams(prev => ({ ...prev, surfaceMode: 'obj' }));
  }, [loadOBJ]);

  const handleCausticObjGenerated = useCallback((objText: string, blockH: number, groundDist: number) => {
    setParams(prev => ({
      ...prev,
      blockH: Math.max(0.1, Math.min(8, blockH)),
      groundDist: Math.max(0.1, Math.min(12, groundDist)),
      groundY: 0,
    }));

    setTimeout(() => {
      const result = loadCausticOBJ(objText);
      if (result && result.requiredBlockH > blockH) {
        const finalH = +(result.requiredBlockH + 0.02).toFixed(2);
        setParams(prev => ({
          ...prev,
          blockH: Math.max(0.1, Math.min(8, finalH)),
          groundDist: Math.max(0.1, Math.min(12, finalH + 0.01)),
          surfaceMode: 'obj',
        }));
        loadCausticOBJ(objText);
      } else {
        setParams(prev => ({ ...prev, surfaceMode: 'obj' }));
      }
      setCameraPreset('top');
    }, 50);
  }, [loadCausticOBJ, setCameraPreset]);

  // Listen for OBJ load events from GeneratePanel
  useEffect(() => {
    const handler = (e: Event) => handleObjLoaded((e as CustomEvent).detail as string);
    window.addEventListener('caustic-load-obj', handler);
    return () => window.removeEventListener('caustic-load-obj', handler);
  }, [handleObjLoaded]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case '1': setCameraPreset('persp'); break;
        case '2': setCameraPreset('side');  break;
        case '3': setCameraPreset('top');   break;
        case 'b': case 'B':
          setParams(prev => ({ ...prev, showBlock: !prev.showBlock }));
          break;
        case 'g': case 'G':
          setParams(prev => ({ ...prev, showGrid: !prev.showGrid }));
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setCameraPreset]);

  // Fade info bar after 6s
  useEffect(() => {
    const t = setTimeout(() => setInfoVisible(false), 6000);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <ControlPanel
        params={params}
        onChange={handleParamsChange}
        onPreset={handlePreset}
        onObjLoaded={handleObjLoaded}
        onCausticObjGenerated={handleCausticObjGenerated}
      />

      <div id="canvas-container">
        <canvas ref={canvasRef} id="main-canvas" />

        <div
          id="info-bar"
          style={{ opacity: infoVisible ? 1 : 0.3, transition: infoVisible ? undefined : 'opacity 1.5s' }}
        >
          Drag to orbit · Scroll to zoom · Right-drag to pan · Keys: 1/2/3 = views · B = block · G = grid
        </div>

        <div id="perf-display">
          {perfMs !== null ? `⏱ ${perfMs.toFixed(1)}ms · RT` : '⏱ — ms · RT'}
        </div>
      </div>
    </>
  );
}
