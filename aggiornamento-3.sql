-- =====================================================================
--  FARO · aggiornamento 3 (5 ottobre 2026)
--  Aggiunge alle attività quattro campi facoltativi: note, luogo,
--  ora di inizio e ora di fine.
--
--  NON cancella e NON modifica nulla: le attività già presenti restano
--  identiche e hanno semplicemente i nuovi campi vuoti.
--  Si può eseguire anche più volte senza danni.
--
--  Dove: Supabase → SQL Editor → New query → incolla tutto → Run.
-- =====================================================================

alter table public.attivita
  add column if not exists note       text,
  add column if not exists luogo      text,
  add column if not exists ora_inizio time,
  add column if not exists ora_fine   time;

-- L'ora di fine, se indicata, non può precedere quella di inizio.
-- (Le attività esistenti hanno entrambe vuote, quindi rispettano già la regola.)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'attivita_orario_ok') then
    alter table public.attivita
      add constraint attivita_orario_ok
      check (ora_inizio is null or ora_fine is null or ora_fine >= ora_inizio);
  end if;
end $$;

-- Fa sapere subito all'interfaccia dati di Supabase che ci sono colonne nuove.
notify pgrst, 'reload schema';

-- Controllo finale: deve elencare le quattro colonne e il numero di attività
-- che avevi prima di eseguire lo script.
select
  (select count(*) from public.attivita)                                   as attivita_presenti,
  (select string_agg(column_name, ', ' order by column_name)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'attivita'
      and column_name in ('note','luogo','ora_inizio','ora_fine'))          as colonne_nuove;
