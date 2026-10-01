-- Eventos importados de arquivo .ics (Configurações > Calendário > Importar arquivo .ics).
-- Ficam em calendar_events com source 'ics' e entram em daily_occupancy como as reuniões do Outlook.
-- external_id = UID do evento + início da ocorrência (reimportar atualiza, sem duplicar).
alter table demandas_app.calendar_events drop constraint if exists calendar_events_source_check;
alter table demandas_app.calendar_events add constraint calendar_events_source_check check (source in ('outlook', 'ics'));
