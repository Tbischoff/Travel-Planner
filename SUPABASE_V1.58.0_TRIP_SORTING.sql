-- Travel Planner v1.58.0
-- Benutzerspezifische Sortierung der Reiseauswahl.
-- Standard bleibt das Startdatum; eine manuelle Reihenfolge wird erst verwendet,
-- wenn der jeweilige Benutzer auf "Manuell" umstellt.

create table if not exists public.trip_user_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  sort_position integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, trip_id)
);

alter table public.trip_user_preferences enable row level security;

drop policy if exists "Users can view own trip preferences" on public.trip_user_preferences;
create policy "Users can view own trip preferences"
on public.trip_user_preferences
for select
to authenticated
using (
  user_id = auth.uid()
  and public.is_trip_member(trip_id)
);

drop policy if exists "Users can insert own trip preferences" on public.trip_user_preferences;
create policy "Users can insert own trip preferences"
on public.trip_user_preferences
for insert
to authenticated
with check (
  user_id = auth.uid()
  and public.is_trip_member(trip_id)
);

drop policy if exists "Users can update own trip preferences" on public.trip_user_preferences;
create policy "Users can update own trip preferences"
on public.trip_user_preferences
for update
to authenticated
using (
  user_id = auth.uid()
  and public.is_trip_member(trip_id)
)
with check (
  user_id = auth.uid()
  and public.is_trip_member(trip_id)
);

drop policy if exists "Users can delete own trip preferences" on public.trip_user_preferences;
create policy "Users can delete own trip preferences"
on public.trip_user_preferences
for delete
to authenticated
using (
  user_id = auth.uid()
  and public.is_trip_member(trip_id)
);

grant select, insert, update, delete
on table public.trip_user_preferences
to authenticated;
