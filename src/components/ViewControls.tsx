import React from 'react';

interface ViewControlsProps {
  onPreset: (preset: 'top' | 'side' | 'persp') => void;
}

const ViewControls: React.FC<ViewControlsProps> = ({ onPreset }) => {
  return (
    <div className="section" style={{ padding: '10px 16px' }}>
      <div className="btn-group" style={{ margin: 0 }}>
        <button className="btn" onClick={() => onPreset('top')}>⬆ Top</button>
        <button className="btn" onClick={() => onPreset('side')}>◀ Side</button>
        <button className="btn" onClick={() => onPreset('persp')}>↗ 3D</button>
      </div>
    </div>
  );
};

export default ViewControls;
