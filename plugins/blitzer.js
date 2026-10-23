// blitzer.de for Monav — fixed and mobile speed cameras, police reports and the stretches
// on which mobile cameras were reported, from the map at map.blitzer.de (atudo CDN).
//
// Unofficial: it reads the same endpoints as the web map. For private use only.

const BASE = "https://cdn2.atudo.net/api/4.0";
// Cameras only: fixed installations, semi-stationary trailers, mobile controls — and the end of a
// tailback as a warning. 21–29 are roadworks and hazards (no cameras), left out.
const TYPES = "101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,117,ts,0,1,2,3,4,5,6,20";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  "Referer": "https://map.blitzer.de/",
  "Origin": "https://map.blitzer.de",
};

// blitzer.de type codes as map.blitzer.de itself names and groups them (`type_arr` and the
// `txt_type_*` labels of its web map). 101–117 are fixed installations, `ts` semi-stationary
// trailers, 0–6 mobile controls reported by drivers; 20 is the end of a tailback. Everything else
// (22/26 roadworks, 21/23/24/25/29 accidents, obstacles, ice, poor view, broken-down cars) is no
// camera — version 1.1 took 26 (permanent roadworks) for mobile cameras.
const KINDS = {
  "101": "distanceCheck", "102": "other" /* dummy */, "103": "other" /* access */, "104": "other" /* lane */,
  "105": "other" /* entrance */, "106": "trafficLight" /* pedestrian crossing */, "107": "fixedSpeed",
  "108": "weightCheck", "109": "heightCheck", "110": "trafficLight" /* red light and speed */,
  "111": "trafficLight", "112": "sectionControl", "113": "sectionControl", "114": "fixedSpeed" /* tunnel */,
  "115": "overtakingBan", "117": "policeReport" /* stationary police check */, "ts": "fixedSpeed",
  "0": "other", "1": "mobileSpeed", "2": "trafficLight", "3": "weightCheck", "4": "policeReport",
  "5": "policeReport" /* alcohol */, "6": "distanceCheck",
  "20": "congestionWarning",
};
const ENFORCEMENT = ["fixedSpeed", "mobileSpeed", "trafficLight", "sectionControl", "distanceCheck", "other"];

function kind(type) {
  return KINDS[type] || null;
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
  version: "1.2",
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
      // Only what is known: anything else the server adds (roadworks, hazards) is no camera.
      .filter(poi => kind(String(poi.type)) && number(poi.lat))
      .map(poi => {
        const address = object(poi.address);
        const vmax = number(poi.vmax);
        return {
          id: String(poi.id ?? poi.backend ?? `${poi.lat},${poi.lng}`),
          latitude: number(poi.lat), longitude: number(poi.lng),
          kind: kind(String(poi.type)),
          vmax: vmax && vmax > 0 ? vmax : null,
          street: address.street || "", city: address.city || "",
          note: object(poi.info).desc || (String(poi.type) === "ts" ? "Teilstationär" : ""),
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
