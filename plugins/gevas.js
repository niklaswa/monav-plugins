// GEVAS traffic lights for Monav — the forecasts of the TrafficPilot app (Düsseldorf and
// other cities with GEVAS signal controllers).
//
// Unofficial: it talks to TrafficPilot's backend the way the app does, with the app's key.
// For private use only; GEVAS has not agreed to this.
//
// Flow: the server-selection endpoint maps a position to the city server; `v18` turns the
// last three GPS points into the signal groups ahead; `v18/predForSg` refreshes the forecasts
// of groups already known.

const KEY = "ac687a68ea";
const SELECTION = "https://gruenzeit.gevas.eu/ssp-apha/rest/serverselection/v11/query";
const FALLBACK = "https://prognose.gevas.eu/duesseldorf/ssp-apha/rest/position";
const HEADERS = {
  "User-Agent": "TrafficPilot/3.0.37 (de.gevas.noserv.trafficpilot; build:237; iOS 26.1.0) Alamofire/5.6.4",
  "Accept-Language": "de-DE;q=1.0, en-US;q=0.9",
  "Accept": "*/*",
};

const TURNS = {
  LEFT: "left", LEFTISH: "slightLeft", AHEAD: "straight",
  RIGHTISH: "slightRight", RIGHT: "right", U_TURN: "uTurn",
};

// The city server, kept for five minutes or 15 km.
let cachedServer = null;

function deviceId() {
  let id = Monav.storage.get("uuid");
  if (!id) {
    id = Monav.uuid();
    Monav.storage.set("uuid", id);
  }
  return id;
}

async function post(url, body) {
  const response = await fetch(url, { method: "POST", headers: HEADERS, json: body });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.text.slice(0, 160)}`);
  return response;
}

async function server(point) {
  if (cachedServer && cachedServer.expires > Date.now()
      && Monav.distance(cachedServer.center, point) <= 15000) {
    return cachedServer.url;
  }
  let url;
  try {
    const response = await post(SELECTION, {
      key: KEY, distance: 0, heading: point.heading, utcTime: Date.now(),
      longitude: point.longitude, altitude: 40, speed: point.speed, latitude: point.latitude,
    });
    // e.g. "https://prognose.gevas.eu/duesseldorf/ssp-apha/rest/position;1"
    const base = response.text.trim().replace(/^"|"$/g, "").split(";")[0];
    url = base.startsWith("http") ? base : null;
  } catch (error) {
    // Selection down: the Düsseldorf server is what the Nav web project always used.
    console.warn("server selection failed:", String(error));
    url = FALLBACK;
  }
  cachedServer = { url, center: point, expires: Date.now() + 300000 };
  return url;
}

// As the TrafficPilot APK sends them: newest first, `distance` the gap to the next older point.
function records(track) {
  const newestFirst = track.slice(-3).reverse();
  return newestFirst.map((point, index) => {
    const older = newestFirst[index + 1];
    const gap = older ? Monav.distance(point, older) : 0;
    return {
      longitude: point.longitude, latitude: point.latitude, altitude: 40,
      speed: Math.round(point.speed * 1000) / 1000, heading: point.heading,
      utcTime: Math.round(point.time), distance: Math.round(gap * 1000) / 1000,
    };
  });
}

function number(value) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return typeof n === "number" && isFinite(n) ? n : null;
}

// "0:0;18:0.019;26:0.979" → [[0, 0], [18, 0.019], [26, 0.979]]
function forecast(text) {
  if (!text) return null;
  const pairs = text.split(";").map(pair => pair.split(":").map(Number))
    .filter(pair => pair.length === 2 && pair.every(isFinite));
  return pairs.length ? pairs : null;
}

function signal(group) {
  if (group.sgUid == null) return null;
  // The APK reads the lowest bits: level 1 is a second stop line inside the junction,
  // operatesOnRequest 1 and 3 mean "green only when requested".
  const request = (number(group.operatesOnRequest) || 0) & 7;
  return {
    id: String(group.sgUid),
    name: group.sgName || "",
    intersection: group.tlName || "",
    distance: number(group.distance),
    level: (number(group.level) || 0) & 1,
    onRequest: request === 1 || request === 3,
    turns: (group.turns || []).map(code => TURNS[code]).filter(Boolean),
    forecast: forecast(group.prediction),
    start: number(group.startTime) || Date.now(),
  };
}

Monav.register({
  id: "de.gevas.trafficpilot",
  name: "GEVAS Ampeln",
  version: "1.0",
  author: "Monav",
  description: "Ampelprognosen von GEVAS / TrafficPilot – Düsseldorf und weitere Städte. Inoffiziell, nur für den privaten Gebrauch.",
  provides: ["trafficLights"],
  hosts: ["gruenzeit.gevas.eu", "prognose.gevas.eu"],

  async trafficLights({ track }) {
    if (track.length < 3) return null;
    const newest = track[track.length - 1];
    const base = await server(newest);
    if (!base) return null;
    const now = Date.now();
    const response = await post(`${base}/v18`, {
      utcTime: String(now), lsastate: 0, gpsRecords: records(track),
      uuid: deviceId(), key: KEY, value: 0,
    });
    const answer = response.json();
    const limit = number(answer.speedlimit);
    return {
      speedLimitKmh: limit && limit > 0 ? Math.round(limit * 3.6) : null,
      signals: (answer.predictionSignalgroups || []).map(signal).filter(Boolean),
    };
  },

  async forecasts({ ids, position }) {
    const base = await server(position);
    if (!base || !ids.length) return [];
    const groups = [];
    // The server takes at most 50 ids per call.
    for (let start = 0; start < ids.length; start += 50) {
      const response = await post(`${base}/v18/predForSg`, {
        sgUids: ids.slice(start, start + 50), uuid: deviceId(), key: KEY,
        utcTime: String(Date.now()), lsastate: 0, value: 0,
      });
      groups.push(...(response.json().predictionSignalgroups || []));
    }
    return groups.map(signal).filter(Boolean);
  },
});
