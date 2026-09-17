import { useEffect, useSyncExternalStore } from 'react';
import { ImportForm } from '../pages/Import';

let isOpen = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Open the import popup from anywhere: importDialog.open() */
export const importDialog = {
  open: () => {
    isOpen = true;
    emit();
  },
  close: () => {
    isOpen = false;
    emit();
  },
  get: () => isOpen,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function ImportDialog() {
  const open = useSyncExternalStore(importDialog.subscribe, importDialog.get);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') importDialog.close();
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && importDialog.close()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="modal-head">
          <h2 id="import-title">Import endpoints</h2>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" onClick={importDialog.close}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <ImportForm onClose={importDialog.close} />
        </div>
      </div>
    </div>
  );
}
