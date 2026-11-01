// OpenStreetMap for Monav — the map on the round display from OpenStreetMap's standard tiles
// instead of Apple Maps. The style is bright; Monav turns it into a night map for the display.
//
// No code runs here: Monav fetches the tiles itself, keeps them in its cache and asks for a new
// picture only every few hundred metres, which keeps within OpenStreetMap's tile usage policy
// (https://operations.osmfoundation.org/policies/tiles/).

Monav.register({
  id: "org.openstreetmap.tiles",
  name: "OpenStreetMap",
  version: "1.0",
  author: "Monav",
  description: "Die Karte auf dem Display aus OpenStreetMap statt Apple Karten, für die Nacht abgedunkelt. Ohne Konto.",
  provides: ["mapTiles"],
  hosts: ["tile.openstreetmap.org"],
  mapTiles: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    tileSize: 256,
    maxZoom: 19,
    attribution: "© OpenStreetMap",
    night: true,
  },
});
