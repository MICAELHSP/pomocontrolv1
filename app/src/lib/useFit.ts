// Altura disponível até o fim da área visível (.view), para a agenda caber sem rolagem.
import { useLayoutEffect, useState, type RefObject } from 'react';

export function useFitHeight(ref: RefObject<HTMLElement | null>, fallback: number, bottomPad = 28): number {
  const [h, setH] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const view = el.closest('.view') as HTMLElement | null;
    const measure = () => {
      const bottom = view ? view.getBoundingClientRect().bottom : window.innerHeight;
      const top = el.getBoundingClientRect().top + (view?.scrollTop ?? 0) - (view ? 0 : 0);
      const v = Math.floor(bottom - top - bottomPad);
      if (v > 0) setH(v);
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (view) ro.observe(view);
    window.addEventListener('resize', measure);
    return () => { ro.disconnect(); window.removeEventListener('resize', measure); };
  }, [ref, bottomPad]);
  return h;
}
