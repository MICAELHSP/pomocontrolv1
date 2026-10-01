// Conflito de prazo com reunião: a hora do prazo cai dentro de uma reunião do dia.
// Sugestão = fim da reunião, encadeando reuniões seguidas.
import type { Meeting } from './types';
import { hm, toMinutes } from './format';

export function meetingAt(time: string | null | undefined, meetings: Meeting[]): Meeting | null {
  const m = toMinutes(time);
  if (m == null) return null;
  return meetings.find((x) => m >= toMinutes(x.start)! && m < toMinutes(x.end)!) ?? null;
}

export function nextFreeTime(time: string, meetings: Meeting[]): string {
  let m = toMinutes(time)!;
  for (let guard = 0; guard < 50; guard++) {
    const hit = meetings.find((x) => m >= toMinutes(x.start)! && m < toMinutes(x.end)!);
    if (!hit) return hm(m);
    m = toMinutes(hit.end)!;
  }
  return hm(m);
}
