// Arrastar um arquivo .ics para cima da agenda importa direto (a mesma importação de Configurações > Calendário).
import { useState, type DragEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../components/Toast';
import { importIcs } from './ics';
import { calKeys } from './outlook';
import { errMsg } from './supabase';

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
const isIcs = (f: File) => /\.ics$/i.test(f.name) || f.type === 'text/calendar';

export function useIcsDrop() {
  const qc = useQueryClient();
  const toast = useToast();
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!over) setOver(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
  };
  const onDrop = async (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setOver(false);
    const files = Array.from(e.dataTransfer.files).filter(isIcs);
    if (!files.length) { toast('Solte um arquivo .ics para importar a agenda.'); return; }
    setBusy(true);
    try {
      let n = 0;
      for (const f of files) n += await importIcs(await f.text());
      qc.invalidateQueries({ queryKey: calKeys.events });
      qc.invalidateQueries({ queryKey: ['ics'] });
      toast(n ? `${n} ${n === 1 ? 'evento importado' : 'eventos importados'} do .ics.` : 'Nenhum evento entre 1 ano atrás e 1 ano à frente no arquivo.');
    } catch (x) { toast(`Não deu para importar: ${errMsg(x)}`); }
    setBusy(false);
  };

  return { over, busy, dropProps: { onDragOver, onDragLeave, onDrop } };
}
