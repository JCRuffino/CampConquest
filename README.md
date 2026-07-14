# Camp Conquest

A real-time multiplayer territory game played across a campsite, inspired by Jet Lag: The Game's Battle for America / Schengen Showdown — and a follow-up to [BussyBodies](https://github.com/JCRuffino/BussyBodies) (Jet Lag Brighton).

Three teams of two compete over the 20 zones of the Strange Games Festival at Bushy Wood Activity Centre. Every zone has one challenge, hidden until a team has physically been there (revealed by GPS, honour-system button as backup). Complete a zone's challenge and record your **result** to claim it; another team can steal it by beating that result — but a stolen zone **locks permanently**. First team to own **4 zones in a straight line** (row, column or diagonal of the site grid; locked or not) wins instantly. If the countdown ends first, most zones wins, locked zones break ties.

Built with vanilla JavaScript (ES modules), [Leaflet](https://leafletjs.com/) + OpenStreetMap, and Firebase (anonymous auth + Realtime Database) for shared state.

## Project structure

- `index.html` — markup and styles for all screens (Map, Areas, Leaderboard, Settings, Rules, History)
- `main.js` — boot sequence: data loading, Firebase listener, navigation, history screen, timer ticker, toasts
- `map.js` — Leaflet map, area polygons, claim/steal popups, GPS auto-scouting, live player locations, admin area editor
- `actions.js` — the claim / steal / scout / admin-reset state changes (Firebase transactions), including the 4-in-a-row win check
- `ui.js` — Areas screen cards, leaderboard, map scoreboard
- `settings.js` — team assignment, team renaming, game code, game timer, area editor toggle, game reset
- `firebase.js` — Firebase setup, transactional state updates, game log
- `shared.js` — game state helpers, win detection, and constants shared across modules
- `areas.js` — the 20 festival zones as named polygons with their connect-4 grid positions (georeferenced from the festival site map; refine with the in-app Area Editor)
- `challenges.csv` — challenge text per zone (tab-separated: Area, Challenge; results should be measurable so steals can "beat" them)

## Setting up the real campsite

1. **Zones** — the 20 festival zones in `areas.js` were placed by georeferencing the Strange Games Festival site map onto the real site boundary, so placements are close but not exact. To refine one: open the app as an admin (no team assigned), Settings → **Area Editor**, trace the zone's corners on the map, press Finish, and paste the snippet into `areas.js` (it asks for the zone's grid row/col too).
2. **Challenges** — edit `challenges.csv` (tab-separated). The `Area` column must exactly match the `name` in `areas.js`.
3. **Site illustration (optional)** — to use a nicer hand-drawn map instead of raw OSM tiles, drop the image in this folder and set `SITE_IMAGE` at the top of `map.js` with the image URL and the lat/lng bounds it covers.

## Firebase & security

This repo is public, so the Firebase config in `firebase.js` is public too. That's fine — Firebase web API keys are identifiers, not secrets. What protects the data is the combination of:

1. **A secret game code**, entered once per device when the app first loads (never committed to this repo). All data lives under `camp/<code>/…` in the database.
2. **Security rules that only allow access under the right code.** Firebase denies everything not explicitly allowed, and rules are not readable by clients — so without the code, the database cannot be read, written, or enumerated, even with the config from this repo.

In the Firebase console (Realtime Database → Rules), set the rules to the following, replacing `YOUR-GAME-CODE` with your chosen code (lowercase letters, numbers and dashes only — pick something unguessable, e.g. `bushy-wood-x7k2m`):

```json
{
  "rules": {
    "camp": {
      "YOUR-GAME-CODE": {
        "gameState": { ".read": "auth != null", ".write": "auth != null" },
        "gameLog":   { ".read": "auth != null", ".write": "auth != null" },
        "playerLocations": {
          ".read": "auth != null",
          "$uid": { ".write": "auth != null && auth.uid === $uid" }
        }
      }
    }
  }
}
```

Then tell the players the code (in person / group chat — not in anything public). Easiest onboarding: share a link with the code baked in, e.g. `https://<your-host>/CampConquest/?code=bushy-wood-x7k2m` — the app stores the code and cleans the URL. A device with the wrong code shows `🔴 Wrong game code?` and can change it in Settings → Game Code.

Note: these rules deny everything else in the database, including the old Brighton game's paths — its data stays stored but becomes unreachable, and the old app would stop syncing. To keep the old game functional, keep its original rule blocks alongside the `camp` block.

## Running locally

The app fetches `challenges.csv` at startup, so it must be served over HTTP (opening `index.html` directly from disk won't work):

```
npx serve
# or
python -m http.server
```

Then open the printed local URL in a browser. For the real game, host it anywhere static (GitHub Pages works) so everyone's phone can reach it.

## How to play

Open the Rules tab in the app for the full rules. In short: complete an area's initial challenge to claim it (or steal it from a team that hasn't locked it), complete its control challenge to lock it forever — but a failed control challenge can never be re-attempted by your team. Most areas when the countdown ends wins; locked areas break ties.

Players with no team assigned act as spectators/admins: they can adjust the timer, reset individual areas from the map popup, trace new areas with the editor, and reset the game (password in `settings.js`).
