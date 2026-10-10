// blitzer.de for Monav — fixed and mobile speed cameras, police reports and the stretches
// on which mobile cameras were reported, from the map at map.blitzer.de (atudo CDN).
//
// Unofficial: it reads the same endpoints as the web map. For private use only.

const BASE = "https://cdn2.atudo.net/api/4.0";
const TYPES = "22,26,20,101,102,103,104,105,106,107,108,109,110,111,112,113,115,117,114,ts,0,1,2,3,4,5,6,21,23,24,25,29,vwd,traffic";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  "Referer": "https://map.blitzer.de/",
  "Origin": "https://map.blitzer.de",
};

// blitzer.de type codes, as mapped in the Nav web project.
const FIXED = ["0", "1", "2", "3", "4", "5", "6", "ts", "101", "102", "103", "104", "105", "106", "107",
               "108", "109", "110", "111", "112", "113", "115", "117"];
const KINDS = {
  "20": "mobileSpeed", "26": "mobileSpeed", "21": "distanceCheck", "22": "trafficLight",
  "23": "weightCheck", "24": "heightCheck", "25": "overtakingBan", "29": "policeReport",
  "114": "sectionControl", "vwd": "congestionWarning", "traffic": "trafficJam",
};
const ENFORCEMENT = ["fixedSpeed", "mobileSpeed", "trafficLight", "sectionControl", "distanceCheck", "other"];

function kind(type) {
  return FIXED.includes(type) ? "fixedSpeed" : KINDS[type] || "other";
}

// Roughly 7 × 7 km around the car: south, west, north, east.
function box(position) {
  const dLat = 0.032, dLon = 0.05;
  return [position.latitude - dLat, position.longitude - dLon, position.latitude + dLat, position.longitude + dLon]
    .map(value => value.toFixed(6)).join(",");
}

function number(value) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return typeof n === "number" && isFinite(n) ? n : null;
}

// The PHP backend sends `[]` where an object is empty.
function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function get(path, position) {
  const url = `${BASE}/${path}?type=${TYPES}&z=15&box=${box(position)}${path.startsWith("polylines") ? "&mv=5" : ""}`;
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

Monav.register({
  id: "de.blitzer.map",
  name: "blitzer.de",
  version: "1.0",
  author: "Monav",
  description: "Blitzer, Polizeikontrollen und gemeldete Messstrecken von blitzer.de. Inoffiziell, nur für den privaten Gebrauch.",
  provides: ["speedCameras"],
  hosts: ["cdn2.atudo.net"],

  async speedCameras({ position }) {
    const [pois, polys] = await Promise.all([
      get("pois.php", position),
      // The stretches are decoration: without them the cameras still come.
      get("polylines.php", position).catch(error => { console.warn("stretches:", String(error)); return null; }),
    ]);

    const cameras = (pois.pois || [])
      .filter(poi => poi.type !== "cluster" && poi.type !== "pics" && number(poi.lat))
      .map(poi => {
        const address = object(poi.address);
        const vmax = number(poi.vmax);
        return {
          id: String(poi.id ?? poi.backend ?? `${poi.lat},${poi.lng}`),
          latitude: number(poi.lat), longitude: number(poi.lng),
          kind: kind(String(poi.type)),
          vmax: vmax && vmax > 0 ? vmax : null,
          street: address.street || "", city: address.city || "",
          note: object(poi.info).desc || "",
        };
      });

    // Also hundreds of road closures come back: only stretches of reported cameras stay.
    const zones = polys && (polys.polys || [])
      .filter(poly => poly.type !== "closure" && poly.polyline && ENFORCEMENT.includes(kind(String(poly.type))))
      .map(poly => ({
        id: String(poly.id ?? poly.polyline),
        kind: kind(String(poly.type)),
        polyline: poly.polyline,
        lengthKm: number(object(poly.info).length),
      }));

    return { cameras, zones };
  },
});
