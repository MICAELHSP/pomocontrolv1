import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export interface ToastAction { label: string; run: () => void }
type Show = (msg: string, action?: ToastAction) => void;

const Ctx = createContext<Show>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; action?: ToastAction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback<Show>((msg, action) => {
    setT({ msg, action });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), action ? 6000 : 4200);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {t && (
        <div className="toast" role="status" onClick={() => !t.action && setT(null)}>
          {t.msg}
          {t.action && <button className="btn" onClick={() => { t.action!.run(); setT(null); }}>{t.action.label}</button>}
        </div>
      )}
    </Ctx.Provider>
  );
}
