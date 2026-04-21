import React, { useState } from 'react';
import type { RenderParams } from '../renderer/types';
import SliderRow from './SliderRow';
import ColorRow from './ColorRow';
import SectionBlock from './SectionBlock';
import HemisphereCanvas from './HemisphereCanvas';
import GeneratePanel from './GeneratePanel';
import ViewControls from './ViewControls';

interface ControlPanelProps {
  params: RenderParams;
  onChange: (partial: Partial<RenderParams>) => void;
  onPreset: (preset: 'top' | 'side' | 'persp') => void;
  onObjLoaded: (text: string) => void;
  onCausticObjGenerated: (text: string, blockH: number, groundDist: number) => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  params, onChange, onPreset, onObjLoaded, onCausticObjGenerated,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div id="sidebar">
      <div id="sidebar-header">
        <h1>Caustic Lens Preview</h1>
        <p>Resin block · Forward ray tracing · WebGL2</p>
      </div>

      {/* ── Generate from Image ── */}
      <GeneratePanel
        blockW={params.blockW}
        blockD={params.blockD}
        onBlockWChange={v => onChange({ blockW: v })}
        onBlockDChange={v => onChange({ blockD: v })}
        onGenerated={onCausticObjGenerated}
      />

      {/* ── View preset buttons ── */}
      <ViewControls onPreset={onPreset} />

      {/* ── Advanced toggle ── */}
      <div style={{ padding: '8px 16px' }}>
        <button
          id="btn-advanced"
          className="btn"
          style={{ width: '100%', justifyContent: 'center', fontSize: 11, color: '#445', borderColor: '#222230', background: '#111118' }}
          onClick={() => setShowAdvanced(v => !v)}
        >
          ⚙ Advanced controls {showAdvanced ? '▲' : '▾'}
        </button>
      </div>

      {/* ── Advanced sections ── */}
      {showAdvanced && (
        <>
          <SectionBlock title="☀ Light Direction">
            <HemisphereCanvas
              azimuth={params.azimuth}
              elevation={params.elevation}
              onChange={(az, el) => onChange({ azimuth: az, elevation: el })}
            />
            <SliderRow
              label="Azimuth" value={params.azimuth}
              min={0} max={360} step={1} decimals={0} suffix="°"
              onChange={v => onChange({ azimuth: v })}
            />
            <SliderRow
              label="Elevation" value={params.elevation}
              min={0} max={90} step={1} decimals={0} suffix="°"
              onChange={v => onChange({ elevation: v })}
            />
            <SliderRow
              label="Intensity" value={params.intensity}
              min={0.1} max={10} step={0.05} decimals={1}
              onChange={v => onChange({ intensity: v })}
              warnThreshold={0.05}
            />
          </SectionBlock>

          <SectionBlock title="🔬 Optics">
            <div className="control-row">
              <label>Refractive Index</label>
              <input
                type="number" min={1.0} max={3.0} step={0.01}
                value={params.ior}
                onChange={e => onChange({ ior: parseFloat(e.target.value) })}
                style={{ width: 70, background: '#1a1e2e', color: '#e0e4f0', border: '1px solid #2a3050', borderRadius: 4, padding: '2px 6px', fontSize: 13 }}
              />
            </div>
            <SliderRow
              label="Caustic Exposure" value={params.exposure}
              min={0.1} max={12} step={0.05} decimals={1}
              onChange={v => onChange({ exposure: v })}
            />
            <SliderRow
              label="Sharpness σ" value={params.sigma}
              min={0.005} max={0.3} step={0.005} decimals={3}
              onChange={v => onChange({ sigma: v })}
            />
          </SectionBlock>

          <SectionBlock title="📦 Block">
            <SliderRow
              label="Width" value={params.blockW}
              min={0.5} max={4} step={0.05} decimals={1}
              onChange={v => onChange({ blockW: v })}
            />
            <SliderRow
              label="Depth" value={params.blockD}
              min={0.5} max={4} step={0.05} decimals={1}
              onChange={v => onChange({ blockD: v })}
            />
            <SliderRow
              label="Thickness" value={params.blockH}
              min={0.05} max={4} step={0.025} decimals={2}
              onChange={v => onChange({ blockH: v })}
            />
            <SliderRow
              label="Lens → Floor" value={params.groundDist}
              min={0.1} max={12} step={0.05} decimals={1}
              onChange={v => onChange({ groundDist: v })}
            />
            <SliderRow
              label="Ground Y" value={params.groundY}
              min={-6} max={2} step={0.05} decimals={2}
              onChange={v => onChange({ groundY: v })}
            />
            {/* Warning when ground-dist and ground-y semantics might overlap */}
            {params.groundY !== 0 && (
              <div style={{ fontSize: 10, color: '#c08040', marginTop: -4, marginBottom: 6, paddingLeft: 4 }}>
                Note: Ground Y offsets the floor independently from Lens→Floor distance.
              </div>
            )}
          </SectionBlock>

          <SectionBlock title="〰 Surface Profile">
            <div className="control-row">
              <label>Mode</label>
              <select
                value={params.surfaceMode}
                onChange={e => onChange({ surfaceMode: e.target.value as RenderParams['surfaceMode'] })}
                style={{ flex: 1 }}
              >
                <option value="sinusoidal">Sinusoidal bumps</option>
                <option value="concentric">Concentric rings</option>
                <option value="diagonal">Diagonal waves</option>
                <option value="random">Random (Perlin-like)</option>
                <option value="flat">Flat (no caustic)</option>
                <option value="obj">Loaded OBJ ↓</option>
              </select>
            </div>
            <SliderRow
              label="Bump Amplitude" value={params.bumpAmp}
              min={0} max={0.3} step={0.002} decimals={3}
              onChange={v => onChange({ bumpAmp: v })}
              warnThreshold={0.05}
            />
            {params.bumpAmp > 0.2 && (
              <div style={{ fontSize: 10, color: '#e07070', marginTop: -4, marginBottom: 6, paddingLeft: 4 }}>
                Warning: high amplitude may produce rendering artifacts.
              </div>
            )}
            <SliderRow
              label="Bump Frequency" value={params.bumpFreq}
              min={0.5} max={20} step={0.1} decimals={1}
              onChange={v => onChange({ bumpFreq: v })}
              warnThreshold={0.05}
            />
            {params.bumpFreq > 15 && (
              <div style={{ fontSize: 10, color: '#e07070', marginTop: -4, marginBottom: 6, paddingLeft: 4 }}>
                Warning: very high frequency may alias at this resolution.
              </div>
            )}
            <SliderRow
              label="Resolution" value={params.surfaceRes}
              min={16} max={256} step={8} decimals={0}
              onChange={v => onChange({ surfaceRes: v })}
            />
          </SectionBlock>

          <SectionBlock title="📂 Load OBJ Surface">
            <div style={{ marginTop: 4 }}>
              <button className="btn" onClick={() => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.obj';
                input.onchange = (e) => {
                  const file = (e.target as HTMLInputElement).files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = evt => onObjLoaded(evt.target!.result as string);
                  reader.readAsText(file);
                };
                input.click();
              }}>
                📁 Choose OBJ…
              </button>
              <p className="tip" style={{ marginTop: 6 }}>
                Load the OBJ output from poisson_caustic_design. The top surface vertices are used directly.
              </p>
            </div>
          </SectionBlock>

          <SectionBlock title="🎨 Appearance">
            <ColorRow label="Caustic Color" value={params.causticColor} onChange={v => onChange({ causticColor: v })} />
            <ColorRow label="Ground Color" value={params.groundColor} onChange={v => onChange({ groundColor: v })} />
            <ColorRow label="Block Color" value={params.blockColor} onChange={v => onChange({ blockColor: v })} />
            <div className="control-row">
              <label>Show Block</label>
              <input type="checkbox" checked={params.showBlock}
                onChange={e => onChange({ showBlock: e.target.checked })} style={{ cursor: 'pointer' }} />
            </div>
            <div className="control-row">
              <label>Show Grid</label>
              <input type="checkbox" checked={params.showGrid}
                onChange={e => onChange({ showGrid: e.target.checked })} style={{ cursor: 'pointer' }} />
            </div>
            <div className="control-row">
              <label>Caustic Map Only</label>
              <input type="checkbox" checked={params.showCausticOnly}
                onChange={e => onChange({ showCausticOnly: e.target.checked })} style={{ cursor: 'pointer' }} />
            </div>
          </SectionBlock>
        </>
      )}
    </div>
  );
};

export default ControlPanel;
