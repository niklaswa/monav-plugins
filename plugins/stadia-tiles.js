// Stadia Maps for Monav — the map on the round display in Stadia's "Alidade Smooth Dark" style,
// a dark map made for overlays. Needs a Stadia Maps API key (free for non-commercial use):
// client.stadiamaps.com › Manage Properties & Authentication › API key.

Monav.register({
  id: "com.stadiamaps.tiles",
  name: "Stadia Maps Dark",
  version: "1.0",
  author: "Monav",
  description: "Die Karte auf dem Display im dunklen Stil „Alidade Smooth Dark“ von Stadia Maps. Braucht einen Stadia-Schlüssel.",
  provides: ["mapTiles"],
  hosts: ["tiles.stadiamaps.com"],
  settings: [
    { key: "apiKey", label: "Stadia-Schlüssel", secret: true, placeholder: "client.stadiamaps.com › API key" },
  ],
  mapTiles: {
    // @2x: 512-pixel tiles, a quarter of the requests.
    url: "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}@2x.png?api_key={apiKey}",
    tileSize: 512,
    maxZoom: 20,
    attribution: "© Stadia Maps © OpenStreetMap",
  },
});
