// Ladecloud for Monav — live availability of public charge points across operators, charging
// with the account's charging card, and the account's charges and invoices. The backend of the
// Ladeapp (ladenetz.de); needs a (free) Ladeapp account.
//
// Unofficial: it talks to the backend the way the Ladeapp does, with the app's key. For private
// use only. Starting a charge costs money — Monav asks before it calls `startCharging`.

const BASE = "https://backend.ladecloud.de/ladeapp-api/api/v1";
const API_KEY = "3I0BlnUejEkEAj30uMtkeoDaojiHzifGeP5M";
const USER_AGENT = "ladeapp/3.8 (de.ladenetz.ladeapp; build:20260429112147; iOS 27.0.0) Alamofire/5.11.2";

// The HUD map is zoomed in to street level, so ask at street level: at the city zoom the server
// merges nearby stations into clusters drawn where no station stands (in the recorded Ladeapp
// traffic there were still clusters at 15.85, none from 16 up). ±2.2 km around the car.
const ZOOM = 17;
const LATITUDE_SPAN = 0.04, LONGITUDE_SPAN = 0.064;
// Clusters the server still sends are resolved through `geo-search` (ten stations each), the
// nearest few per refresh.
const RESOLVED_CLUSTERS = 6;

// MARK: Session

function headers() {
  let installation = Monav.storage.get("installationId");
  if (!installation) {
    installation = Monav.uuid().toUpperCase();
    Monav.storage.set("installationId", installation);
  }
  return {
    "X-API-KEY": API_KEY,
    "app-installation-id": installation,
    "User-Agent": USER_AGENT,
    "Accept": "*/*",
    "Accept-Language": "de-DE;q=1.0, en-US;q=0.9",
  };
}

function store(access, refresh) {
  Monav.secrets.set("access", access);
  Monav.secrets.set("refresh", refresh);
}

const denied = response => response.status === 401 || response.status === 403;

// The backend's own explanation, when it sent one.
function message(response) {
  try {
    const body = response.json();
    for (const key of ["message", "detail", "error", "title"]) {
      if (typeof body[key] === "string" && body[key]) return body[key];
    }
  } catch (e) {}
  return `HTTP ${response.status}: ${response.text.slice(0, 160)}`;
}

let providerIds = null;

function expired() {
  store(null, null);
  providerIds = null;
  return new Error("Ladecloud-Anmeldung abgelaufen – bitte neu anmelden.");
}

// The access token lives ~5 minutes; the refresh endpoint rotates both tokens.
async function refresh() {
  const token = Monav.secrets.get("refresh");
  if (!token) throw expired();
  const response = await fetch(`${BASE}/auth/refresh-token`, { method: "POST", headers: headers(), json: { refreshToken: token } });
  if (denied(response)) throw expired();
  if (!response.ok) throw new Error(message(response));
  const tokens = response.json();
  if (!tokens.accessToken) throw expired();
  store(tokens.accessToken, tokens.refreshToken || token);
}

// A call with the account's token. An expired token is refreshed once and the call repeated —
// a 401 means it never reached the backend's logic, so repeating cannot do anything twice.
async function call(method, path, { query = [], body, binary = false } = {}) {
  if (!Monav.secrets.get("access")) await refresh();
  let url = path.startsWith("https://") ? path : `${BASE}/${path}`;
  if (query.length) url += "?" + query.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join("&");
  const attempt = () => fetch(url, {
    method, binary, json: body,
    headers: { ...headers(), Authorization: `Bearer ${Monav.secrets.get("access")}` },
  });
  let response = await attempt();
  if (denied(response)) {
    await refresh();
    response = await attempt();
  }
  if (!response.ok) throw new Error(message(response));
  return response;
}

// Every contract the account has: charging cards, charges and invoices are asked for by all of them.
async function providers() {
  if (!providerIds) {
    const profile = (await call("GET", "users/self")).json();
    providerIds = (profile.customerList || []).map(customer => customer.provider && customer.provider.id).filter(Boolean);
  }
  return providerIds;
}

function paging(page, ids) {
  return [["page", page], ["pageSize", 50], ...ids.map(id => ["providerIds", id])];
}

// MARK: Stations

const fixed = value => Number(value).toFixed(6);

function number(value) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return typeof n === "number" && isFinite(n) ? n : null;
}

// A Ladecloud station as Monav takes it.
function station(s) {
  const id = s.uniqueStationId || s.stationId;
  const latitude = s.coordinates && number(s.coordinates.latitude);
  const longitude = s.coordinates && number(s.coordinates.longitude);
  if (!id || latitude == null || longitude == null) return null;
  const available = s.chargePoints ? s.chargePoints.availableCount : null;
  const live = (s.liveStatus || "").toUpperCase();
  const status = live === "AVAILABLE" ? "available"
    : ["NOT_AVAILABLE", "OCCUPIED", "CHARGING"].includes(live) ? "occupied"
    : ["OUT_OF_ORDER", "OUT_OF_SERVICE", "INOPERATIVE", "BLOCKED"].includes(live) ? "outOfService"
    : (available || 0) > 0 ? "available" : "unknown";
  const address = s.address || {};
  const street = [address.streetName, address.houseNumber].filter(Boolean).join(" ");
  const city = [address.zipCode, address.city].filter(Boolean).join(" ");
  return {
    id, latitude, longitude,
    title: s.locationName || s.stationId || "Ladestation",
    operator: s.operatorName || "",
    address: [street, city].filter(Boolean).join(", "),
    available, total: s.chargePoints ? s.chargePoints.totalCount : null,
    status, roaming: !!s.roaming,
  };
}

// The stations a cluster stands for: the ones nearest to its marker that are not on the map yet,
// as many as it counts, within the reach a cluster can have.
function members(cluster, candidates, known) {
  return candidates
    .filter(s => !known.has(s.id) && Monav.distance(s, cluster) <= 1500)
    .sort((a, b) => Monav.distance(a, cluster) - Monav.distance(b, cluster))
    .slice(0, cluster.count);
}

Monav.register({
  id: "de.ladecloud.ladeapp",
  name: "Ladecloud",
  version: "1.1",
  author: "Monav",
  description: "Ladesäulen mit Live-Verfügbarkeit, Laden mit der Ladekarte, Ladehistorie und Rechnungen – mit einem Ladeapp-Konto. Inoffiziell, nur für den privaten Gebrauch.",
  provides: ["chargers", "charging"],
  hosts: ["backend.ladecloud.de"],

  // MARK: Account

  account() {
    return { signedIn: !!Monav.secrets.get("refresh") };
  },

  async signIn({ username, password }) {
    const response = await fetch(`${BASE}/auth/login`, { method: "POST", headers: headers(), json: { username, password } });
    if (denied(response)) throw new Error("E-Mail oder Passwort falsch.");
    if (!response.ok) throw new Error(message(response));
    const tokens = response.json();
    if (!tokens.accessToken || !tokens.refreshToken) throw new Error("Unerwartete Antwort");
    store(tokens.accessToken, tokens.refreshToken);
    providerIds = null;
  },

  signOut() {
    store(null, null);
    providerIds = null;
  },

  // MARK: Map

  async chargers({ position, roaming }) {
    const answer = (await call("POST", "charge-stations/clusters", { body: {
      area: {
        latitudeDistance: fixed(LATITUDE_SPAN / 2), longitudeDistance: fixed(LONGITUDE_SPAN / 2),
        centerLocation: { latitude: fixed(position.latitude), longitude: fixed(position.longitude) },
      },
      filter: { roaming },
      zoomLevel: ZOOM,
    } })).json();

    const stations = (answer.chargeStations || []).map(station).filter(Boolean);
    let clusters = (answer.clusters || [])
      .filter(cluster => cluster.markerLocation && cluster.count != null)
      .map(cluster => ({
        id: cluster.id || Monav.uuid(), count: cluster.count,
        latitude: number(cluster.markerLocation.latitude), longitude: number(cluster.markerLocation.longitude),
      }))
      .sort((a, b) => Monav.distance(a, position) - Monav.distance(b, position));

    // Resolve what is left into the real stations, at their real places.
    const resolved = new Set();
    for (const cluster of clusters.slice(0, RESOLVED_CLUSTERS)) {
      if (cluster.count > 10) continue;
      let nearby;
      try {
        nearby = (await call("POST", "charge-stations/geo-search", { body: {
          geoCoordinates: { latitude: fixed(cluster.latitude), longitude: fixed(cluster.longitude) },
          filter: { roaming },
        } })).json().stationPreviewList || [];
      } catch (error) {
        continue;
      }
      const found = members(cluster, nearby.map(station).filter(Boolean), new Set(stations.map(s => s.id)));
      stations.push(...found);
      if (found.length >= cluster.count) resolved.add(cluster.id);
    }
    clusters = clusters.filter(cluster => !resolved.has(cluster.id));

    // The cluster call only carries ids and availability: names, operators and addresses of
    // the nearest ones.
    const nearest = [...stations].sort((a, b) => Monav.distance(a, position) - Monav.distance(b, position)).slice(0, 40);
    if (nearest.length) {
      try {
        const previews = (await call("POST", "charge-stations/previews", { body: { stationIdList: nearest.map(s => s.id) } }))
          .json().stationPreviewList || [];
        const byId = new Map();
        for (const preview of previews) {
          if (preview.uniqueStationId) byId.set(preview.uniqueStationId, preview);
          if (preview.stationId) byId.set(preview.stationId, preview);
        }
        for (const s of stations) {
          const enriched = byId.has(s.id) ? station(byId.get(s.id)) : null;
          if (enriched) Object.assign(s, { title: enriched.title, operator: enriched.operator, address: enriched.address });
        }
      } catch (error) {
        console.warn("previews:", error.message);
      }
    }
    return { stations, clusters };
  },

  // MARK: Charging

  // The station's charge points and tariff, as seen with the account's cards.
  async chargePoint({ stationId }) {
    const ids = await providers();
    const cards = (await call("GET", "users/charging-cards", { query: ids.map(id => ["providerIds", id]) }))
      .json().chargingCardList || [];
    const active = cards.find(card => (card.status || "").toUpperCase() === "ACTIVE");
    const station = (await call("GET", `charge-stations/${encodeURIComponent(stationId)}`, {
      query: active ? [["chargingCardId", active.id]] : [],
    })).json();
    return { station, cards };
  },

  // Starts a charge at one charge point, paid with the card. The car is plugged in afterwards,
  // within the process's `timeToLive`.
  async startCharging({ evseId, cardId }) {
    return (await call("POST", "charge-processes/contract/start", { body: { evseId, chargingCardId: cardId } })).json();
  },

  async chargeProcess({ id }) {
    return (await call("GET", `charge-processes/${encodeURIComponent(id)}`, { query: [["chargeProcessType", "CONTRACT"]] })).json();
  },

  async stopCharging({ id }) {
    await call("POST", `charge-processes/${encodeURIComponent(id)}/stop`);
    return null;
  },

  // MARK: The account's past

  async history({ page }) {
    return (await call("GET", "transactions/contract", { query: paging(page, await providers()) })).json();
  },

  async historyItem({ id }) {
    return (await call("GET", `transactions/contract/${encodeURIComponent(id)}`)).json();
  },

  async invoices({ page }) {
    return (await call("GET", "users/invoices", { query: paging(page, await providers()) })).json();
  },

  async invoice({ id }) {
    return (await call("GET", `users/invoices/${encodeURIComponent(id)}`)).json();
  },

  // A file of the storage service, such as an invoice PDF.
  async file({ url }) {
    return { base64: (await call("GET", url, { binary: true })).base64 };
  },
});
