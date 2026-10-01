// Estado de navegação da janela.
import { createContext, useContext, useState, type ReactNode } from 'react';

export type View = 'hoje' | 'calendario' | 'demandas' | 'rotinas' | 'foco' | 'config';
export type CfgTab = 'ia' | 'jornada' | 'outlook' | 'conta';

interface UI {
  view: View;
  groupFilter: string | null;
  sel: string | null;
  aiOpen: boolean;
  cfgTab: CfgTab;
  /** Configurações aberta porque "Nova com IA" foi pedida sem chave. */
  aiGate: boolean;
  go: (v: View, groupFilter?: string | null) => void;
  open: (id: string | null) => void;
  setAiOpen: (b: boolean) => void;
  openConfig: (tab: CfgTab, gate?: boolean) => void;
  setCfgTab: (t: CfgTab) => void;
}

const Ctx = createContext<UI | null>(null);
export const useUI = () => useContext(Ctx)!;

export function UIProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>('hoje');
  const [groupFilter, setGF] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [cfgTab, setCfgTab] = useState<CfgTab>('ia');
  const [aiGate, setAiGate] = useState(false);
  const go = (v: View, g: string | null = null) => { setView(v); setGF(g); setSel(null); setAiGate(false); };
  const openConfig = (tab: CfgTab, gate = false) => { setView('config'); setGF(null); setSel(null); setCfgTab(tab); setAiGate(gate); setAiOpen(false); };
  return (
    <Ctx.Provider value={{ view, groupFilter, sel, aiOpen, cfgTab, aiGate, go, open: setSel, setAiOpen, openConfig, setCfgTab }}>
      {children}
    </Ctx.Provider>
  );
}
