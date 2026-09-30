// Janela sobre o conteúdo; fecha com Esc, clique fora ou no X.
import { useEffect, type ReactNode } from 'react';
import { I } from './Icons';

export function Modal({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={label}>
        <button className="iconbtn modal-x" aria-label="Fechar" onClick={onClose}><I.x /></button>
        {children}
      </div>
    </div>
  );
}
