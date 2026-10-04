-- Travel Planner v1.61.0
-- Mehrere Unterkünfte mit Aufenthaltszeiträumen.
--
-- stay_from / stay_until gelten nur für Orte der Kategorie "hotel".
-- Bei bestehenden Unterkünften wird zunächst der gesamte Reisezeitraum
-- übernommen. Die Werte können anschließend in der App geändert werden.

alter table public.trip_places
  add column if not exists stay_from date,
  add column if not exists stay_until date;

-- Bestehende Unterkünfte auf den jeweiligen Reisezeitraum migrieren.
update public.trip_places tp
set
  stay_from = coalesce(tp.stay_from, t.start_date),
  stay_until = coalesce(tp.stay_until, t.end_date)
from public.trips t
join public.places p
  on p.category = 'hotel'
where tp.trip_id = t.id
  and tp.place_id = p.id
  and (tp.stay_from is null or tp.stay_until is null);

-- Ungültige Zeiträume verhindern.
alter table public.trip_places
  drop constraint if exists trip_places_stay_period_check;

alter table public.trip_places
  add constraint trip_places_stay_period_check
  check (
    stay_from is null
    or stay_until is null
    or stay_until >= stay_from
  );

-- Kontrolle
select
  tp.trip_id,
  tp.place_id,
  p.name,
  p.category,
  tp.stay_from,
  tp.stay_until
from public.trip_places tp
join public.places p on p.id = tp.place_id
where p.category = 'hotel'
order by tp.trip_id, tp.stay_from, p.name;
