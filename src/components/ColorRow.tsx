import React from 'react';

interface ColorRowProps {
  label: string;
  value: [number, number, number]; // 0-1 RGB
  onChange: (rgb: [number, number, number]) => void;
}

function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map(v => {
    const h = Math.round(v * 255).toString(16);
    return h.length === 1 ? '0' + h : h;
  }).join('');
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1,3), 16) / 255;
  const g = parseInt(hex.slice(3,5), 16) / 255;
  const b = parseInt(hex.slice(5,7), 16) / 255;
  return [r, g, b];
}

const ColorRow: React.FC<ColorRowProps> = ({ label, value, onChange }) => {
  return (
    <div className="color-row">
      <label>{label}</label>
      <input
        type="color"
        value={rgbToHex(value)}
        onChange={e => onChange(hexToRgb(e.target.value))}
      />
    </div>
  );
};

export default ColorRow;
