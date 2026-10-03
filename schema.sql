-- =====================================================================
--  Attività e Scadenze di famiglia — struttura del database
--  Da incollare nell'SQL Editor di Supabase ed eseguire una sola volta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. MEMBRI DELLA FAMIGLIA
--    Una riga per ogni utente registrato: serve per mostrare i nomi
--    accanto alle attività. Viene creata da sola alla registrazione.
-- ---------------------------------------------------------------------
create table if not exists public.membri (
  id        uuid primary key references auth.users on delete cascade,
  nome      text not null,
  colore    text not null default '#1f4f8f',
  creato_il timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. ATTIVITÀ
--    privata = true  -> visibile solo a chi l'ha creata
--    privata = false -> elenco condiviso con tutta la famiglia
-- ---------------------------------------------------------------------
create table if not exists public.attivita (
  id            uuid primary key default gen_random_uuid(),
  tag           text not null default 'GENERALE',
  descrizione   text not null,
  scadenza      date,
  fatto         boolean not null default false,
  in_data       date,
  priorita      text not null default 'Media'
                check (priorita in ('Alta','Media','Bassa')),
  ricorrenza    text not null default 'Nessuna'
                check (ricorrenza in ('Nessuna','Giornaliera','Settimanale','Quindicinale',
                                      'Mensile','Bimestrale','Trimestrale','Semestrale','Annuale')),
  importo       numeric(12,2),
  privata       boolean not null default false,
  autore        uuid not null default auth.uid() references auth.users on delete cascade,
  creata_il     timestamptz not null default now(),
  aggiornata_il timestamptz not null default now()
);

create index if not exists attivita_scadenza_idx on public.attivita (scadenza);
create index if not exists attivita_autore_idx   on public.attivita (autore);
create index if not exists attivita_fatto_idx    on public.attivita (fatto);

-- ---------------------------------------------------------------------
-- 3. ISCRIZIONI ALLE NOTIFICHE PUSH (una per telefono/browser)
-- ---------------------------------------------------------------------
create table if not exists public.push_iscrizioni (
  id        uuid primary key default gen_random_uuid(),
  utente    uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint  text not null unique,
  p256dh    text not null,
  auth      text not null,
  etichetta text,
  creata_il timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. AGGIORNAMENTO AUTOMATICO DI aggiornata_il
-- ---------------------------------------------------------------------
create or replace function public.tocca_aggiornata_il()
returns trigger language plpgsql as $$
begin
  new.aggiornata_il = now();
  return new;
end $$;

drop trigger if exists attivita_aggiornata_il on public.attivita;
create trigger attivita_aggiornata_il
  before update on public.attivita
  for each row execute function public.tocca_aggiornata_il();

-- ---------------------------------------------------------------------
-- 5. CREAZIONE AUTOMATICA DEL PROFILO ALLA REGISTRAZIONE
-- ---------------------------------------------------------------------
create or replace function public.crea_membro()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.membri (id, nome)
  values (new.id, coalesce(nullif(new.raw_user_meta_data->>'nome',''), split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists al_nuovo_utente on auth.users;
create trigger al_nuovo_utente
  after insert on auth.users
  for each row execute function public.crea_membro();

-- profili per gli utenti eventualmente già creati prima di questo script
insert into public.membri (id, nome)
select u.id, split_part(u.email,'@',1) from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- 6. REGOLE DI ACCESSO (Row Level Security)
--    Nessuno legge o scrive nulla senza aver effettuato l'accesso.
-- ---------------------------------------------------------------------
alter table public.membri         enable row level security;
alter table public.attivita       enable row level security;
alter table public.push_iscrizioni enable row level security;

-- MEMBRI: tutti i familiari si vedono tra loro; ognuno modifica solo sé stesso
drop policy if exists membri_lettura on public.membri;
create policy membri_lettura on public.membri
  for select to authenticated using (true);

drop policy if exists membri_modifica on public.membri;
create policy membri_modifica on public.membri
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ATTIVITÀ: si vede l'elenco condiviso più le proprie attività private
drop policy if exists attivita_lettura on public.attivita;
create policy attivita_lettura on public.attivita
  for select to authenticated
  using (privata = false or autore = auth.uid());

drop policy if exists attivita_inserimento on public.attivita;
create policy attivita_inserimento on public.attivita
  for insert to authenticated
  with check (autore = auth.uid());

-- le attività condivise sono modificabili da tutta la famiglia,
-- quelle private solo da chi le ha create
drop policy if exists attivita_modifica on public.attivita;
create policy attivita_modifica on public.attivita
  for update to authenticated
  using  (privata = false or autore = auth.uid())
  with check (privata = false or autore = auth.uid());

drop policy if exists attivita_eliminazione on public.attivita;
create policy attivita_eliminazione on public.attivita
  for delete to authenticated
  using (privata = false or autore = auth.uid());

-- PUSH: ognuno gestisce solo le proprie iscrizioni
drop policy if exists push_proprie on public.push_iscrizioni;
create policy push_proprie on public.push_iscrizioni
  for all to authenticated
  using (utente = auth.uid()) with check (utente = auth.uid());

-- ---------------------------------------------------------------------
-- 7. SINCRONIZZAZIONE IN TEMPO REALE TRA I TELEFONI
-- ---------------------------------------------------------------------
alter table public.attivita replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'attivita'
  ) then
    alter publication supabase_realtime add table public.attivita;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Fine. Da qui in poi il database è pronto.
-- ---------------------------------------------------------------------
