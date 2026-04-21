import React, { useState } from 'react';

interface SectionBlockProps {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const SectionBlock: React.FC<SectionBlockProps> = ({ title, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="section">
      <div
        className="section-title"
        style={{ cursor: 'pointer', userSelect: 'none', display: 'flex', justifyContent: 'space-between' }}
        onClick={() => setOpen(o => !o)}
      >
        <span>{title}</span>
        <span style={{ opacity: 0.5, fontSize: '10px' }}>{open ? '▲' : '▾'}</span>
      </div>
      {open && children}
    </div>
  );
};

export default SectionBlock;
