import React, { useRef, useState, useEffect, useCallback } from 'react';

const DEVICE_PRESETS: Record<string, { resW: number; thicknessRatio: number }> = {
  form4_fast:  { resW: 48,  thicknessRatio: 0.15 },
  form4_fine:  { resW: 80,  thicknessRatio: 0.12 },
  form4_ultra: { resW: 128, thicknessRatio: 0.10 },
  hubs_sla:    { resW: 64,  thicknessRatio: 0.15 },
  preview:     { resW: 32,  thicknessRatio: 0.20 },
};

// Inline worker source (verbatim from ui.js)
const WORKER_SRC = `
'use strict';
let mod = null;
self.addEventListener('message', async (e) => {
  const { type, payload } = e.data;
  if (type === 'init') {
    try {
      self.postMessage({ type: 'status', text: 'Loading WASM module\u2026' });
      importScripts(payload.wasmJsUrl);
      self.postMessage({ type: 'status', text: 'Instantiating WASM\u2026' });
      mod = await CausticModule({
        locateFile(path) {
          if (path.endsWith('.wasm')) return payload.wasmBinUrl;
          return path;
        },
        print: () => {},
        printErr: () => {},
      });
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', text: 'WASM init failed: ' + err.message });
    }
    return;
  }
  if (type === 'generate') {
    const { pngData, resW, focalL, thickness } = payload;
    try {
      self.postMessage({ type: 'status', text: 'Writing input image to WASM FS\u2026' });
      mod.FS.writeFile('/input.png', pngData);
      self.postMessage({ type: 'status', text: 'Running caustic solver\u2026' });
      const args = [
        '--input_png',  '/input.png',
        '--output',     '/',
        '--res_w',      String(resW),
        '--focal_l',    String(focalL),
        '--thickness',  String(thickness),
      ];
      try { mod.callMain(args); } catch(e) {
        const isExit = (e && (e.name === 'ExitStatus' || (e.message && e.message.toLowerCase().includes('exit'))));
        self.postMessage({ type: 'status', text: 'Solver exited: ' + (isExit ? 'OK (exit code)' : 'ERROR: ' + (e && e.message)) });
        if (!isExit) throw e;
      }
      let fsRoot = [];
      try { fsRoot = mod.FS.readdir('/'); } catch(_) {}
      self.postMessage({ type: 'status', text: 'FS root: ' + JSON.stringify(fsRoot) });
      self.postMessage({ type: 'status', text: 'Reading output mesh\u2026' });
      const objText = mod.FS.readFile('/output.obj', { encoding: 'utf8' });
      try { mod.FS.unlink('/input.png');  } catch(_) {}
      try { mod.FS.unlink('/output.obj'); } catch(_) {}
      self.postMessage({ type: 'done', objText });
    } catch (err) {
      self.postMessage({ type: 'error', text: 'Generation failed: ' + err.message });
    }
    return;
  }
});
`;

interface GeneratePanelProps {
  blockW: number;
  blockD: number;
  onBlockWChange?: (v: number) => void;
  onBlockDChange: (v: number) => void;
  onGenerated: (objText: string, blockH: number, groundDist: number) => void;
}

const GeneratePanel: React.FC<GeneratePanelProps> = ({
  blockW, onBlockDChange, onGenerated,
}) => {
  const [devicePreset, setDevicePreset] = useState('form4_fine');
  const [lensSizeMm, setLensSizeMm] = useState(50);
  const [baseThickMm, setBaseThickMm] = useState(50);
  const [projDistMm, setProjDistMm] = useState(2);

  const [pngFileData, setPngFileData] = useState<Uint8Array | null>(null);
  const [imgPreviewUrl, setImgPreviewUrl] = useState<string | null>(null);
  const [wasmReady, setWasmReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [lastObjText, setLastObjText] = useState<string | null>(null);

  const pngInputRef = useRef<HTMLInputElement>(null);
  const objInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);

  // Poll for CausticModule
  useEffect(() => {
    const poll = () => {
      if (typeof (window as unknown as Record<string,unknown>).CausticModule === 'function') {
        setWasmReady(true);
        setStatus('WASM module ready');
        setTimeout(() => setStatus(''), 800);
      } else {
        setTimeout(poll, 200);
      }
    };
    poll();
  }, []);

  const computedParams = (() => {
    const preset = DEVICE_PRESETS[devicePreset] || DEVICE_PRESETS.form4_fine;
    const focalL = +((baseThickMm + projDistMm) / lensSizeMm).toFixed(4);
    const thickness = +(projDistMm / lensSizeMm).toFixed(4);
    return { resW: preset.resW, focalL, thickness };
  })();

  const handlePngUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      const buf = evt.target!.result as ArrayBuffer;
      const data = new Uint8Array(buf);
      setPngFileData(data);

      const blob = new Blob([data], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      if (imgPreviewUrl) URL.revokeObjectURL(imgPreviewUrl);
      setImgPreviewUrl(url);

      // Read image to fix block aspect ratio
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          const aspect = img.naturalWidth / img.naturalHeight;
          const newD = +(blockW / aspect).toFixed(2);
          onBlockDChange(Math.max(0.5, Math.min(4, newD)));
        }
      };
      img.src = url;

      setStatus('Image loaded — click Generate');
    };
    reader.onerror = () => { setStatus('Failed to read image file'); setStatusError(true); };
    reader.readAsArrayBuffer(file);
  };

  const handleObjUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>, loadOBJ: (text: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => loadOBJ(evt.target!.result as string);
    reader.onerror = () => { setStatus('Error reading OBJ file'); setStatusError(true); };
    reader.readAsText(file);
  }, []);

  const handleGenerate = () => {
    if (!pngFileData || !wasmReady || working) return;
    const { resW, focalL, thickness } = computedParams;

    setWorking(true);
    setProgress(null);
    setStatus('Starting Web Worker…');
    setStatusError(false);

    const blob = new Blob([WORKER_SRC], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);
    workerRef.current = worker;

    const wasmJsUrl  = new URL('wasm/caustic.js', window.location.href).href;
    const wasmBinUrl = new URL('wasm/caustic.wasm', window.location.href).href;

    worker.onmessage = (e) => {
      const { type, text, objText } = e.data;
      if (type === 'status') { setStatus(text); return; }
      if (type === 'ready') {
        setStatus('Sending image data to worker…');
        const buf = pngFileData!.buffer.slice(0);
        worker.postMessage(
          { type: 'generate', payload: { pngData: new Uint8Array(buf), resW, focalL, thickness } },
          [buf]
        );
        return;
      }
      if (type === 'done') {
        setStatus('Parsing OBJ mesh…');
        setProgress(90);
        try {
          const nominalH = focalL * blockW;
          const minSafeH = thickness * blockW + 0.05;
          const targetBlockH = +(Math.max(nominalH, minSafeH)).toFixed(2);
          setLastObjText(objText);
          onGenerated(objText, targetBlockH, targetBlockH + 0.01);
          setProgress(100);
          setStatus(`Done — blockH: ${targetBlockH.toFixed(2)}`);
        } catch (err) {
          setStatus('OBJ parse error: ' + (err as Error).message);
          setStatusError(true);
        }
        cleanup();
        return;
      }
      if (type === 'error') {
        setStatus(text);
        setStatusError(true);
        cleanup(false);
        return;
      }
    };

    worker.onerror = (err) => {
      setStatus('Worker error: ' + (err.message || 'unknown'));
      setStatusError(true);
      cleanup(false);
    };

    worker.postMessage({ type: 'init', payload: { wasmJsUrl, wasmBinUrl } });

    function cleanup(hideProgress = true) {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      workerRef.current = null;
      setWorking(false);
      if (hideProgress) {
        setTimeout(() => setProgress(null), 2000);
      }
    }
  };

  const handleDownloadObj = () => {
    if (!lastObjText) return;
    const blob = new Blob([lastObjText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'caustic.obj';
    a.click();
    URL.revokeObjectURL(url);
  };

  const canGenerate = !!pngFileData && wasmReady && !working;

  return (
    <div className="section">
      <div className="section-title">Generate from Image</div>

      <div style={{ fontSize: '11px', color: '#667', margin: '2px 0 5px' }}>
        ① Upload a high-contrast PNG<br />
        <span style={{ color: '#445' }}>(white pattern on black background)</span>
      </div>

      <div style={{ marginBottom: 8 }}>
        <button className="btn" onClick={() => pngInputRef.current?.click()}>Choose PNG…</button>
        <input ref={pngInputRef} type="file" accept="image/png" style={{ display: 'none' }} onChange={handlePngUpload} />
      </div>

      {imgPreviewUrl && (
        <div style={{
          margin: '8px 0', borderRadius: 5, overflow: 'hidden',
          border: '1px solid #2a2a3a', background: '#0d0d16',
          height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <img src={imgPreviewUrl} alt="Preview" style={{ maxWidth: '100%', maxHeight: 120, objectFit: 'contain' }} />
        </div>
      )}

      <div style={{ fontSize: '11px', color: '#667', margin: '8px 0 4px' }}>② Set physical dimensions (mm)</div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: '10px', color: '#6699cc', marginBottom: 2 }}>Lens depth</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="number" min={1} max={50} value={projDistMm} step={0.5}
              onChange={e => setProjDistMm(parseFloat(e.target.value))}
              style={{ width: 48, background: '#1a1e2e', color: '#e0e4f0', border: '1px solid #2a3050', borderRadius: 4, padding: '2px 4px', fontSize: 12 }} />
            <span style={{ fontSize: 10, color: '#556' }}>mm</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#66cc99', marginBottom: 2 }}>Base thickness</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="number" min={0} max={200} value={baseThickMm} step={0.5}
              onChange={e => setBaseThickMm(parseFloat(e.target.value))}
              style={{ width: 48, background: '#1a1e2e', color: '#e0e4f0', border: '1px solid #2a3050', borderRadius: 4, padding: '2px 4px', fontSize: 12 }} />
            <span style={{ fontSize: 10, color: '#556' }}>mm</span>
          </div>
        </div>
        <div>
          <div style={{ fontSize: '10px', color: '#aaa', marginBottom: 2 }}>Width</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="number" min={10} max={200} value={lensSizeMm} step={1}
              onChange={e => setLensSizeMm(parseFloat(e.target.value))}
              style={{ width: 48, background: '#1a1e2e', color: '#e0e4f0', border: '1px solid #2a3050', borderRadius: 4, padding: '2px 4px', fontSize: 12 }} />
            <span style={{ fontSize: 10, color: '#556' }}>mm</span>
          </div>
        </div>
      </div>

      <div style={{ fontSize: '10px', color: '#445', marginBottom: 4 }}>
        focal_l: {computedParams.focalL.toFixed(3)} · thickness: {computedParams.thickness.toFixed(3)} · res_w: {computedParams.resW}
      </div>

      <div style={{ fontSize: '11px', color: '#667', margin: '4px 0 5px' }}>③ Choose print resolution</div>
      <select
        value={devicePreset}
        onChange={e => setDevicePreset(e.target.value)}
        style={{ width: '100%', marginBottom: 6 }}
      >
        <option value="preview">Quick preview (low-res, 32pt)</option>
        <option value="form4_fast">Form 4 SLA 25μm — fast (48pt)</option>
        <option value="form4_fine">Form 4 SLA 25μm — fine (80pt)</option>
        <option value="form4_ultra">Form 4 SLA 25μm — ultra (128pt)</option>
        <option value="hubs_sla">Hubs.com Premium SLA (64pt)</option>
      </select>

      <button
        className="btn"
        id="btn-generate"
        disabled={!canGenerate}
        onClick={handleGenerate}
        style={{ width: '100%', justifyContent: 'center', fontSize: 14, padding: 9, marginTop: 4 }}
      >
        ⚡ Generate
      </button>
      <button
        className="btn"
        disabled={!lastObjText}
        onClick={handleDownloadObj}
        style={{ marginTop: 6, width: '100%', justifyContent: 'center' }}
      >
        ⬇ Download OBJ
      </button>

      {progress !== null && (
        <div style={{ marginTop: 8 }}>
          <div style={{ height: 4, borderRadius: 2, background: '#2a2a3a', overflow: 'hidden', marginBottom: 5 }}>
            <div style={{
              height: '100%',
              width: progress === null ? '40%' : `${progress}%`,
              background: 'linear-gradient(90deg, #3a6fff, #82aaff)',
              borderRadius: 2,
              transition: 'width 0.3s ease',
              animation: progress === null ? 'wasm-slide 1.2s ease-in-out infinite' : undefined,
            }} />
          </div>
        </div>
      )}

      {status && (
        <div style={{ fontSize: 11, color: statusError ? '#e07070' : '#6a8caf', marginTop: 4 }}>
          {status}
        </div>
      )}

      {/* OBJ file upload (for custom OBJ surfaces) */}
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #222230' }}>
        <div style={{ fontSize: '11px', color: '#667', marginBottom: 4 }}>Or load OBJ surface directly:</div>
        <button className="btn" onClick={() => objInputRef.current?.click()}>📁 Choose OBJ…</button>
        <input ref={objInputRef} type="file" accept=".obj" style={{ display: 'none' }}
          onChange={e => handleObjUpload(e, (text) => {
            // This is handled by parent via onGenerated with a special path
            // We emit a custom event that App.tsx listens to
            const ev = new CustomEvent('caustic-load-obj', { detail: text });
            window.dispatchEvent(ev);
          })} />
      </div>
    </div>
  );
};

export default GeneratePanel;
