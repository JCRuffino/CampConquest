# Camp Conquest

A real-time multiplayer territory game played across a campsite, inspired by Jet Lag: The Game's Battle for America / Schengen Showdown — and a follow-up to [BussyBodies](https://github.com/JCRuffino/BussyBodies) (Jet Lag Brighton).

Three teams of two compete over the 20 zones of the Strange Games Festival at Bushy Wood Activity Centre. Every zone has one secret challenge, revealed only when a team presses Start Challenge Attempt there — which commits them to recording a pass (reaching the pass mark) or a fail (locked out until another team passes it). Some challenges run on a countdown or stopwatch that starts on the spot. Claiming records your **result**; another team can steal the zone by beating that result — but a stolen zone **locks permanently**. When the countdown ends, the team with the **largest connected group of zones** (via the dotted links on the map, Stateside Scramble style) wins — ties broken by total zones, then locked zones.

Built with vanilla JavaScript (ES modules), [Leaflet](https://leafletjs.com/) + OpenStreetMap, and Firebase (anonymous auth + Realtime Database) for shared state.

## Project structure

- `index.html` — markup and styles for all screens (Map, Leaderboard, Settings, Rules, History)
- `main.js` — boot sequence: data loading, Firebase listener, navigation, history screen, timer ticker, toasts
- `map.js` — Leaflet map, area polygons, challenge popups with live attempt timers, live player locations, admin vertex-drag area editor
- `actions.js` — the start-attempt / claim / steal / fail / admin state changes (Firebase transactions)
- `ui.js` — leaderboard and map scoreboard
- `settings.js` — team assignment, team renaming, game code, game timer, admin unlock (password in this file), area editor toggle, game reset
- `firebase.js` — Firebase setup, transactional state updates, game log
- `shared.js` — game state helpers, win detection, and constants shared across modules
- `areas.js` — the 20 festival zones as named polygons plus the connections between them (which drive the largest-connected-group score); zones are expanded so neighbours visibly touch
- `challenges.csv` — per zone (tab-separated): Area, Challenge, Pass Mark, Timer (`countdown N` minutes, `countup`, or empty); results should be measurable so steals can "beat" them

## Setting up the real campsite

1. **Zones** — the 20 festival zones in `areas.js` were placed by georeferencing the Strange Games Festival site map onto the real site boundary, so placements are close but not exact. To refine one: unlock admin mode in Settings, start the **Area Editor**, tap the zone on the map, drag its corner handles, press Copy Snippet, and paste it over that zone's entry in `areas.js`.
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

Open the Rules tab in the app for the full rules. In short: a zone's challenge stays secret until you press Start at it (which commits you to a pass or fail and starts any timer), pass to claim it with a recorded result, and steal rivals' zones by beating that result — stolen zones lock forever. The winner is the team with the largest connected group of zones when the countdown ends (ties: total zones, then locked zones).

Admin mode (unlocked per device with the password in `settings.js`) can see all challenges, adjust the timer, set any area's owner/lock/result/pass mark from the map popup, edit zone shapes, and reset the game.
