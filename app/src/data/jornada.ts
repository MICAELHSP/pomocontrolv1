// Jornada de trabalho do usuário (demandas_app.work_settings). Sem linha no banco = padrão.
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_JORNADA, type Jornada } from '../lib/occupancy';
import { must, sb } from '../lib/supabase';

interface WorkSettings { work_start: string; work_end: string; lunch_minutes: number; workdays: number[] }

const key = ['work_settings'] as const;

export function useJornada(): Jornada {
  const q = useQuery({
    queryKey: key,
    staleTime: Infinity,
    queryFn: async () => must(await sb().from('work_settings').select('work_start, work_end, lunch_minutes, workdays').maybeSingle()) as WorkSettings | null,
  });
  const w = q.data;
  return useMemo(() => (w ? { start: w.work_start.slice(0, 5), end: w.work_end.slice(0, 5), lunch: w.lunch_minutes, days: w.workdays } : DEFAULT_JORNADA), [w]);
}

export function useSaveJornada() {
  const qc = useQueryClient();
  return async (j: Jornada) => {
    const row = {
      work_start: j.start, work_end: j.end, lunch_minutes: j.lunch, workdays: [...j.days].sort(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
    };
    must(await sb().from('work_settings').upsert(row, { onConflict: 'owner_id' }));
    await qc.invalidateQueries({ queryKey: key });
  };
}
