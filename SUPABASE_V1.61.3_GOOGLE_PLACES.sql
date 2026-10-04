-- Travel Planner v1.61.3
-- Hilfsfunktionen für die zentrale Google-Places-Datenbank.
-- Verhindert Duplikate und erlaubt das sichere Verknüpfen eines bereits
-- vorhandenen Google-Orts mit einer Reise trotz RLS.

create or replace function public.get_google_place_status(
  p_trip_id uuid,
  p_google_place_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  v_place public.places%rowtype;
  v_in_trip boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;

  if not public.is_trip_member(p_trip_id) then
    raise exception 'Kein Zugriff auf diese Reise.';
  end if;

  select p.*
    into v_place
  from public.places p
  where p.google_place_id = nullif(trim(p_google_place_id), '')
  limit 1;

  if v_place.id is null then
    return jsonb_build_object(
      'exists', false,
      'in_trip', false,
      'place_id', null,
      'place_name', null
    );
  end if;

  select exists (
    select 1
    from public.trip_places tp
    where tp.trip_id = p_trip_id
      and tp.place_id = v_place.id
  ) into v_in_trip;

  return jsonb_build_object(
    'exists', true,
    'in_trip', v_in_trip,
    'place_id', v_place.id,
    'place_name', v_place.name
  );
end;
$$;

create or replace function public.link_existing_google_place(
  p_trip_id uuid,
  p_google_place_id text,
  p_trip_day_id uuid default null,
  p_planned_order integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_place public.places%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet.';
  end if;

  if not public.can_edit_trip(p_trip_id) then
    raise exception 'Keine Bearbeitungsberechtigung für diese Reise.';
  end if;

  select p.*
    into v_place
  from public.places p
  where p.google_place_id = nullif(trim(p_google_place_id), '')
  limit 1;

  if v_place.id is null then
    raise exception 'Google-Ort wurde in der Datenbank nicht gefunden.';
  end if;

  if p_trip_day_id is not null and not exists (
    select 1
    from public.trip_days td
    where td.id = p_trip_day_id
      and td.trip_id = p_trip_id
  ) then
    raise exception 'Der angegebene Reisetag gehört nicht zu dieser Reise.';
  end if;

  insert into public.trip_places (
    trip_id,
    place_id,
    trip_day_id,
    planned_order
  )
  values (
    p_trip_id,
    v_place.id,
    p_trip_day_id,
    p_planned_order
  )
  on conflict (trip_id, place_id) do nothing;

  return jsonb_build_object(
    'place_id', v_place.id,
    'place_name', v_place.name
  );
end;
$$;

grant execute on function public.get_google_place_status(uuid, text) to authenticated;
grant execute on function public.link_existing_google_place(uuid, text, uuid, integer) to authenticated;

-- PostgREST soll die neuen Funktionen unmittelbar sehen.
notify pgrst, 'reload schema';
