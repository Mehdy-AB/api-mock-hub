import { createContext, ReactNode, useCallback, useContext, useState } from 'react';
import { uid } from './util';

type ToastKind = 'ok' | 'error';
type Push = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<Push>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: string; message: string; kind: ToastKind }[]>([]);

  const push = useCallback<Push>((message, kind = 'ok') => {
    const id = uid();
    setItems((xs) => [...xs, { id, message, kind }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
