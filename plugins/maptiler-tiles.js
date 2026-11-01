// MapTiler for Monav — the map on the round display in MapTiler's "Dataviz Dark" style: dark
// already, quiet, with the roads standing out. Needs a MapTiler API key (the free plan is
// enough for one car): cloud.maptiler.com › Account › API keys.

Monav.register({
  id: "com.maptiler.tiles",
  name: "MapTiler Dark",
  version: "1.0",
  author: "Monav",
  description: "Die Karte auf dem Display im dunklen Stil „Dataviz Dark“ von MapTiler. Braucht einen kostenlosen MapTiler-Schlüssel.",
  provides: ["mapTiles"],
  hosts: ["api.maptiler.com"],
  settings: [
    { key: "apiKey", label: "MapTiler-Schlüssel", secret: true, placeholder: "cloud.maptiler.com › API keys" },
  ],
  mapTiles: {
    url: "https://api.maptiler.com/maps/dataviz-dark/{z}/{x}/{y}.png?key={apiKey}",
    tileSize: 512,
    maxZoom: 20,
    attribution: "© MapTiler © OpenStreetMap",
  },
});
