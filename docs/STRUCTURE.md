# Projektstruktur

Der Travel Planner ist eine installierbare Multi-Trip-PWA. Die produktive Anwendung wird über Cloudflare Pages ausgeliefert. Authentifizierung sowie Benutzer-, Reise- und Planungsdaten liegen in Supabase.

## Root

### `index.html`
Einstiegspunkt und Oberflächenstruktur der Anwendung.

### `sw.js`
Service Worker für App-Shell, Offline-Verfügbarkeit und Versionswechsel.

### `manifest.webmanifest`
PWA-Metadaten für Installation und Darstellung.

### `README.md`
Projektübersicht und Versionshistorie.

### `_headers`
HTTP-Sicherheits- und Cache-Header für das Deployment.

## `assets/`

### `assets/css/style.css`
Styling für Desktop- und Mobilansicht.

### `assets/js/app.js`
Zentrale Anwendungslogik, darunter:
- Authentifizierung, Einladung und Passwort-Reset
- Konto- und Benutzerverwaltung
- Reiseauswahl und Multi-Trip-Verwaltung
- Owner-/Editor-/Viewer-Rollen
- Orte, Kategorien und Google Places
- Tagesplanung, Aktivitäten und Unterkünfte
- Navigation, Routen und ÖPNV-Unterstützung
- Wetter
- Backup und Offline-Reisemodus
- App-Update-Mechanismus

### `assets/icons/`
PWA- und Browser-Icons.

### `assets/maps/`
Ressourcen für die Offline-Kartendarstellung.

## `data/`

### `data/places.js`
Öffentliche Kompatibilitäts- und Metadaten. Produktive Reise- und Ortsdaten werden aus Supabase geladen.

## `docs/`
Aktuelle technische Dokumentation, insbesondere zur Einrichtung externer Dienste.

## `.github/workflows/`

### `build-offline-map.yml`
Erzeugt reisebezogene PMTiles-Kartenpakete und legt sie in Supabase Storage ab. Zugangsdaten werden über GitHub Secrets bereitgestellt.

## Sicherheitsmodell

Supabase Row Level Security schützt Reise- und Ortsdaten. Reisemitglieder dürfen freigegebene Daten lesen; schreibende Zugriffe richten sich nach der jeweiligen Owner-/Editor-/Viewer-Rolle. Administrative Benutzerverwaltung erfolgt serverseitig und verwendet keine privilegierten Schlüssel im Frontend.
