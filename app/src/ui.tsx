// Estado de navegação da janela.
import { createContext, useContext, useState, type ReactNode } from 'react';

export type View = 'hoje' | 'calendario' | 'demandas' | 'rotinas' | 'foco';

interface UI {
  view: View;
  groupFilter: string | null;
  sel: string | null;
  go: (v: View, groupFilter?: string | null) => void;
  open: (id: string | null) => void;
}

const Ctx = createContext<UI | null>(null);
export const useUI = () => useContext(Ctx)!;

export function UIProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>('hoje');
  const [groupFilter, setGF] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const go = (v: View, g: string | null = null) => { setView(v); setGF(g); setSel(null); };
  return <Ctx.Provider value={{ view, groupFilter, sel, go, open: setSel }}>{children}</Ctx.Provider>;
}
