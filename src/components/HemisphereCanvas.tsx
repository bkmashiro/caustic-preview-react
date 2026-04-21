import React, { useRef, useEffect, useCallback } from 'react';

interface HemisphereCanvasProps {
  azimuth: number;
  elevation: number;
  onChange: (az: number, el: number) => void;
}

const SIZE = 140;

const HemisphereCanvas: React.FC<HemisphereCanvasProps> = ({ azimuth, elevation, onChange }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    const R = SIZE / 2;

    const az = azimuth * Math.PI / 180;
    const el = elevation * Math.PI / 180;

    ctx.clearRect(0, 0, SIZE, SIZE);

    // Background
    const grad = ctx.createRadialGradient(R, R, 0, R, R, R);
    grad.addColorStop(0, '#1a2030');
    grad.addColorStop(1, '#0d0d1a');
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#2a3550';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Elevation rings
    ctx.strokeStyle = '#1e2840';
    ctx.lineWidth = 0.5;
    for (let deg = 15; deg < 90; deg += 15) {
      const r = R * (1 - deg / 90);
      ctx.beginPath();
      ctx.arc(R, R, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Cardinal lines
    ctx.beginPath();
    ctx.moveTo(R, 1); ctx.lineTo(R, R*2-1);
    ctx.moveTo(1, R); ctx.lineTo(R*2-1, R);
    ctx.strokeStyle = '#1e2840';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#3a5070';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('N', R, 11);
    ctx.fillText('S', R, R*2 - 3);
    ctx.fillText('E', R*2 - 5, R + 4);
    ctx.fillText('W', 5, R + 4);

    // Light dot
    const projR = R * Math.cos(el);
    const dotX = R + projR * Math.sin(az);
    const dotY = R - projR * Math.cos(az);

    ctx.beginPath();
    ctx.moveTo(R, R);
    ctx.lineTo(dotX, dotY);
    ctx.strokeStyle = 'rgba(255, 220, 100, 0.25)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const grd = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, 12);
    grd.addColorStop(0, 'rgba(255, 220, 80, 0.9)');
    grd.addColorStop(0.4, 'rgba(255, 180, 40, 0.4)');
    grd.addColorStop(1, 'rgba(255, 180, 40, 0)');
    ctx.beginPath();
    ctx.arc(dotX, dotY, 12, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffdc50';
    ctx.fill();
    ctx.strokeStyle = '#ffa020';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Elevation label
    ctx.fillStyle = '#5a7090';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText(`${Math.round(elevation)}°`, dotX + 7, dotY - 5);
  }, [azimuth, elevation]);

  useEffect(() => { draw(); }, [draw]);

  const pointerToAngles = (cx: number, cy: number): { az: number; el: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const R = SIZE / 2;
    const rect = canvas.getBoundingClientRect();
    const px = cx - rect.left - R;
    const py = cy - rect.top - R;
    const dist = Math.sqrt(px*px + py*py);
    if (dist > R) return null;
    let az = Math.atan2(px, -py) * 180 / Math.PI;
    if (az < 0) az += 360;
    const el = Math.max(0, Math.min(90, 90 * (1 - dist / R)));
    return { az: Math.round(az), el: Math.round(el) };
  };

  const handlePointer = (cx: number, cy: number) => {
    const angles = pointerToAngles(cx, cy);
    if (angles) onChange(angles.az, angles.el);
  };

  return (
    <div id="hemisphere-container">
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        style={{ cursor: 'crosshair', borderRadius: '50%', border: '1px solid #2a2a3a' }}
        onMouseDown={e => {
          draggingRef.current = true;
          handlePointer(e.clientX, e.clientY);
          e.preventDefault();
        }}
        onMouseMove={e => {
          if (draggingRef.current) handlePointer(e.clientX, e.clientY);
        }}
        onMouseUp={() => { draggingRef.current = false; }}
        onMouseLeave={() => { draggingRef.current = false; }}
        onTouchStart={e => {
          draggingRef.current = true;
          handlePointer(e.touches[0].clientX, e.touches[0].clientY);
          e.preventDefault();
        }}
        onTouchMove={e => {
          if (draggingRef.current) handlePointer(e.touches[0].clientX, e.touches[0].clientY);
          e.preventDefault();
        }}
        onTouchEnd={() => { draggingRef.current = false; }}
      />
    </div>
  );
};

export default HemisphereCanvas;
