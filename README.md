# Camp Conquest

A real-time multiplayer territory game played across a campsite, inspired by Jet Lag: The Game's Battle for America / Schengen Showdown — and a follow-up to [BussyBodies](https://github.com/JCRuffino/BussyBodies) (Jet Lag Brighton).

Three teams of two claim areas of the campsite on a live map. Every area has an **initial challenge** (complete it to claim/steal the area) and a **control challenge** (complete it to lock the area in permanently — but fail it and your team can never attempt it again, leaving the area stealable). The team controlling the most areas when the timer ends wins; locked areas break ties.

Built with vanilla JavaScript (ES modules), [Leaflet](https://leafletjs.com/) + OpenStreetMap, and Firebase (anonymous auth + Realtime Database) for shared state.

## Project structure

- `index.html` — markup and styles for all screens (Map, Areas, Leaderboard, Settings, Rules, History)
- `main.js` — boot sequence: data loading, Firebase listener, navigation, history screen, timer ticker, toasts
- `map.js` — Leaflet map, area polygons, claim/lock popups, live player locations, admin area editor
- `actions.js` — the claim / lock / fail-control / admin-reset state changes (Firebase transactions)
- `ui.js` — Areas screen cards, leaderboard, map scoreboard
- `settings.js` — team assignment, team renaming, game timer, area editor toggle, game reset
- `firebase.js` — Firebase setup, transactional state updates, game log
- `shared.js` — game state helpers and constants shared across modules
- `areas.js` — the campsite areas as named polygons (currently **placeholders** — see below)
- `challenges.csv` — challenge text per area (tab-separated: Area, Initial Challenge, Control Challenge)

## Setting up the real campsite

1. **Location** — the game is set at **Bushy Wood Activity Centre**, Baden Powell Way, Hailsham BN27 3LZ. The 12 areas in `areas.js` tile the real site boundary (from OpenStreetMap) as a grid with placeholder names. To replace them with the real zones (lodges, campfire circle, archery range…), open the app as an admin (no team assigned), go to Settings → **Area Editor**, tap the corners of each real area on the map, and press Finish. Paste the generated snippets into `areas.js`, replacing the placeholders — and update the names in `challenges.csv` to match.
2. **Challenges** — edit `challenges.csv` (tab-separated). The `Area` column must exactly match the `name` in `areas.js`.
3. **Site illustration (optional)** — to use a nicer hand-drawn map instead of raw OSM tiles, drop the image in this folder and set `SITE_IMAGE` at the top of `map.js` with the image URL and the lat/lng bounds it covers.

## Firebase

The app reuses the existing `jet-lag-brighton` Firebase project, but stores everything under the `camp/` subtree so the old Brighton game data is untouched. The project's Realtime Database **security rules must grant access to that subtree** — in the Firebase console (Realtime Database → Rules), add alongside the existing rules:

```json
{
  "rules": {
    "camp": {
      "gameState": { ".read": "auth != null", ".write": "auth != null" },
      "gameLog":   { ".read": "auth != null", ".write": "auth != null" },
      "playerLocations": {
        ".read": "auth != null",
        "$uid": { ".write": "auth != null && auth.uid === $uid" }
      }
    }
  }
}
```

(Keep whatever rules already exist for the old game; just add the `camp` block next to them.)

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
