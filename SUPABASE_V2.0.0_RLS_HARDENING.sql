-- Travel Planner 2.0 – RLS-Härtung für Orte
--
-- Problem:
-- Die bestehende ALL-Policy auf public.places erlaubt jedem Mitglied einer
-- verknüpften Reise (also auch Viewern) UPDATE/DELETE über can_access_place(id).
--
-- Ziel:
-- SELECT bleibt für alle Reisemitglieder möglich.
-- INSERT bleibt für angemeldete Benutzer möglich, die den Datensatz selbst anlegen.
-- UPDATE/DELETE sind nur möglich, wenn der Benutzer Owner oder Editor mindestens
-- einer Reise ist, mit der der Ort verknüpft ist.

create or replace function public.can_edit_place(check_place_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trip_places tp
    join public.trip_members tm
      on tm.trip_id = tp.trip_id
    where tp.place_id = check_place_id
      and tm.user_id = auth.uid()
      and tm.role in ('owner', 'editor')
  );
$$;

grant execute on function public.can_edit_place(uuid) to authenticated;

drop policy if exists "Trip members can access places" on public.places;

drop policy if exists "Trip members can view places" on public.places;
create policy "Trip members can view places"
on public.places
for select
to authenticated
using (
  created_by = auth.uid()
  or public.can_access_place(id)
);

drop policy if exists "Authenticated users can create places" on public.places;
create policy "Authenticated users can create places"
on public.places
for insert
to authenticated
with check (
  created_by = auth.uid()
);

drop policy if exists "Trip editors can update places" on public.places;
create policy "Trip editors can update places"
on public.places
for update
to authenticated
using (
  public.can_edit_place(id)
)
with check (
  public.can_edit_place(id)
);

drop policy if exists "Trip editors can delete places" on public.places;
create policy "Trip editors can delete places"
on public.places
for delete
to authenticated
using (
  public.can_edit_place(id)
);

-- Kontrollausgabe
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('places', 'trip_places')
order by tablename, policyname;
