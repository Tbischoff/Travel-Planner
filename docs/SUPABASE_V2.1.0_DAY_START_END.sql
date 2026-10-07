-- Travel Planner v2.1.0
-- Start- und Zielort pro Reisetag.
-- Vor dem Deployment von v2.1.0 einmal im Supabase SQL Editor ausführen.

alter table public.trip_days
  add column if not exists start_place_id uuid null,
  add column if not exists end_place_id uuid null;

-- Referenzen bewusst auf places: Ein Ort bleibt genau einmal in der gemeinsamen
-- Ortsdatenbank gespeichert und kann als Start und Ziel desselben Tages dienen.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'trip_days_start_place_id_fkey'
      and conrelid = 'public.trip_days'::regclass
  ) then
    alter table public.trip_days
      add constraint trip_days_start_place_id_fkey
      foreign key (start_place_id) references public.places(id)
      on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'trip_days_end_place_id_fkey'
      and conrelid = 'public.trip_days'::regclass
  ) then
    alter table public.trip_days
      add constraint trip_days_end_place_id_fkey
      foreign key (end_place_id) references public.places(id)
      on delete set null;
  end if;
end $$;

create index if not exists idx_trip_days_start_place_id
  on public.trip_days(start_place_id)
  where start_place_id is not null;

create index if not exists idx_trip_days_end_place_id
  on public.trip_days(end_place_id)
  where end_place_id is not null;

comment on column public.trip_days.start_place_id is
  'Optionaler expliziter Startort der Tagesroute; verweist auf places.id.';

comment on column public.trip_days.end_place_id is
  'Optionaler expliziter Zielort der Tagesroute; verweist auf places.id.';
