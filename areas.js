// ── CAMPSITE AREAS ────────────────────────────────────────────────
// Each area is a named polygon on the map. Coordinates are [lat, lng]
// pairs going around the boundary (no need to repeat the first point).
//
// ⚠️ These are PLACEHOLDER areas on a random field near Ditchling
// Beacon so the app runs out of the box. Replace them with the real
// campsite: an admin (no team assigned) can use the Area Editor in
// Settings to trace areas on the map and copy the snippets straight
// into this list.
//
// Challenge text for each area lives in challenges.csv, matched by name.

export const areaDefinitions = [
  {
    name: "The Meadow",
    polygon: [
      [50.90500, -0.11500],
      [50.90500, -0.11410],
      [50.90555, -0.11410],
      [50.90555, -0.11500],
    ],
  },
  {
    name: "Fire Pit",
    polygon: [
      [50.90500, -0.11410],
      [50.90500, -0.11320],
      [50.90555, -0.11320],
      [50.90555, -0.11410],
    ],
  },
  {
    name: "Woodland Edge",
    polygon: [
      [50.90500, -0.11320],
      [50.90500, -0.11230],
      [50.90545, -0.11215],
      [50.90555, -0.11320],
    ],
  },
  {
    name: "Top Field",
    polygon: [
      [50.90555, -0.11500],
      [50.90555, -0.11410],
      [50.90610, -0.11410],
      [50.90610, -0.11500],
    ],
  },
  {
    name: "The Orchard",
    polygon: [
      [50.90555, -0.11410],
      [50.90555, -0.11320],
      [50.90610, -0.11320],
      [50.90610, -0.11410],
    ],
  },
  {
    name: "Bramble Corner",
    polygon: [
      [50.90555, -0.11320],
      [50.90545, -0.11215],
      [50.90600, -0.11200],
      [50.90610, -0.11320],
    ],
  },
  {
    name: "Lakeside",
    polygon: [
      [50.90610, -0.11500],
      [50.90610, -0.11410],
      [50.90665, -0.11420],
      [50.90660, -0.11500],
    ],
  },
  {
    name: "The Copse",
    polygon: [
      [50.90610, -0.11410],
      [50.90610, -0.11320],
      [50.90665, -0.11330],
      [50.90665, -0.11420],
    ],
  },
  {
    name: "Games Field",
    polygon: [
      [50.90610, -0.11320],
      [50.90600, -0.11200],
      [50.90660, -0.11190],
      [50.90665, -0.11330],
    ],
  },
];
