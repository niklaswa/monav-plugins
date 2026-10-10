# Monav Plugins

Datenquellen für [Monav](https://github.com/niklaswa) zum Nachrüsten – als JavaScript, auch
selbst geschrieben.

| Plugin | Liefert | Spricht mit |
|---|---|---|
| [GEVAS Ampeln](plugins/gevas.js) | Ampelprognosen (Düsseldorf u. a.) | `gruenzeit.gevas.eu`, `prognose.gevas.eu` |
| [blitzer.de](plugins/blitzer.js) | Blitzer, Polizeikontrollen, gemeldete Messstrecken | `cdn2.atudo.net` |
| [Ladecloud](plugins/ladecloud.js) | Ladesäulen live, Laden mit der Ladekarte, Ladehistorie, Rechnungen (Ladeapp-Konto) | `backend.ladecloud.de` |

> Die Plugins hier nutzen inoffizielle Schnittstellen und sind nur für den privaten Gebrauch.

## In Monav einbinden

- **Als Quelle:** Einstellungen › Plugins › *Quelle hinzufügen* → `niklaswa/monav-plugins`.
  Solange das Repository privat ist, braucht es einen GitHub-Token mit Lesezugriff
  (Fine-grained, nur dieses Repository, *Contents: Read*). Monav zeigt dann die Plugins mit
  *Laden* und *Aktualisieren*.
- **Als Datei:** die `.js`-Datei in der Dateien-App unter *Auf meinem iPhone › Monav › Plugins*
  ablegen, oder in Monav › Plugins › *+* aus Dateien oder per Link laden.
- **Vom Mac:** `Scripts/install-plugin.sh plugins/gevas.js` im Monav-Repository (Simulator,
  mit `DEVICE=<udid>` aufs iPhone).

Ein Plugin läuft erst, wenn du es einschaltest – Monav fragt dabei, ob es deinen Standort an
die Server schicken darf, die es angibt.

## Ein Plugin schreiben

Ein Plugin ist **eine** JavaScript-Datei, die `Monav.register({…})` aufruft. Sie läuft in
JavaScriptCore (modernes JavaScript, `async`/`await`), ohne DOM, ohne `require`/`import`.

```js
Monav.register({
  id: "de.example.ampeln",          // eindeutig: Buchstaben, Ziffern, . _ -
  name: "Beispiel-Ampeln",
  version: "1.0",                   // höher = Update in Monav
  author: "Du",
  description: "Was es kann, in einem Satz.",
  provides: ["trafficLights"],      // auch "speedCameras", "chargers", "charging" – mehrere gehen
  hosts: ["api.example.com"],       // nur diese Server darf es aufrufen (Subdomains inklusive)
  settings: [                       // optional: Felder in Monav › Plugins › dein Plugin
    { key: "apiKey", label: "API-Schlüssel", secret: true },
  ],

  async trafficLights({ track }) {
    const key = Monav.setting("apiKey");
    const here = track[track.length - 1];
    const response = await fetch(`https://api.example.com/lights?lat=${here.latitude}&lon=${here.longitude}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json().lights.map(light => ({
      id: light.id,
      distance: light.metres,
      forecast: [[0, 0], [light.secondsToGreen, 1]],   // rot, dann grün
      start: Date.now(),
    }));
  },
});
```

### Was Monav fragt

**`trafficLights({ track })`** – etwa alle drei Sekunden, solange das Auto fährt.
`track` sind die letzten drei GPS-Punkte, ältester zuerst:
`{ latitude, longitude, speed /* m/s */, heading /* Grad */, time /* ms seit 1970 */ }`.

Antwort: `null` (hier keine Abdeckung), eine Liste von Ampeln, oder
`{ speedLimitKmh, signals: [...] }`. Eine Ampel (Signalgruppe) ist:

| Feld | | |
|---|---|---|
| `id` | Pflicht | bleibt für dieselbe Ampel gleich |
| `distance` | Meter | entlang der Straße bis zur Haltelinie |
| `forecast` | `[[Sekunde, p], …]` | `p` = Wahrscheinlichkeit für Grün (0 rot … 1 grün), Sekunden ab `start` |
| `start` | ms seit 1970 | Beginn der Prognose |
| `turns` | `["left", "straight", …]` | auch `slightLeft`, `slightRight`, `right`, `uTurn` |
| `name`, `intersection` | Text | z. B. Signalgruppe und Anlage |
| `onRequest` | `true/false` | wird nur auf Anforderung grün |
| `level` | `0`/`1` | `1` = zweite Haltelinie in der Kreuzung (wird ausgeblendet) |

Monav macht den Rest: zeigt eine Ampel erst nach zwei Meldungen, gleicht sie mit den Ampeln
in OpenStreetMap ab, rechnet die Entfernung zwischen den Antworten mit, gibt die
Geschwindigkeitsempfehlung. Prognosen, die nie zwischen Rot und Grün wechseln, zeigt es nicht.

**`forecasts({ ids, position })`** – optional, alle acht Sekunden für bekannte Ampeln: frische
Prognosen, gleiche Felder wie oben (`id`, `forecast`, `start` genügen).

**`speedCameras({ position })`** – mit `provides: ["speedCameras"]`, etwa alle 1,5 km oder zwei
Minuten, für rund 7 × 7 km um `position` (`{ latitude, longitude }`). Antwort:

```js
{
  cameras: [{ id, latitude, longitude, kind: "fixedSpeed", vmax: 50, street, city, note }],
  zones: [{ id, kind: "mobileSpeed", polyline: "…", lengthKm }],   // optional
}
```

`kind`: `fixedSpeed`, `mobileSpeed`, `trafficLight`, `sectionControl`, `distanceCheck`,
`weightCheck`, `heightCheck`, `overtakingBan`, `policeReport`, `congestionWarning`, `trafficJam`,
`other`. `note` ist die Beschreibung – steht darin die Richtung („FR Neuss“, „stadteinwärts“,
„beidseitig“), warnt Monav nur in dieser Richtung. `zones` sind Strecken mit gemeldeten
mobilen Blitzern, als Google-Polyline (`polyline`) oder `path: [[lat, lon], …]`; ohne `zones`
bleiben die bisherigen stehen.

**`chargers({ position, roaming })`** – mit `provides: ["chargers"]`, etwa alle 1,2 km oder
2,5 Minuten, für gut 2 km um `position`. Antwort:

```js
{
  stations: [{ id, latitude, longitude, title, operator, address, available, total,
               status: "available" /* occupied, outOfService, unknown */, roaming }],
  clusters: [{ id, latitude, longitude, count }],   // wo nur die Zahl bekannt ist
}
```

Braucht die Quelle ein Konto, gehören `account()` → `{ signedIn }`, `signIn({ username, password })`
und `signOut()` dazu – Monav zeigt dann die Anmeldung in den Einstellungen und, solange
niemand angemeldet ist, die Ladestationen aus Apple Karten. Zugangsdaten und Tokens gehören in
`Monav.secrets`.

**Laden** – mit `provides: ["charging"]`: `chargePoint({ stationId })` → `{ station, cards }`,
`startCharging({ evseId, cardId })` → Ladevorgang, `chargeProcess({ id })`, `stopCharging({ id })`,
`history({ page })` / `invoices({ page })` → `{ data: [...], hasNext }`, `historyItem({ id })`,
`invoice({ id })`, `file({ url })` → `{ base64 }`. Die Objekte haben die Form der
Ladecloud-Schnittstelle – [ladecloud.js](plugins/ladecloud.js) zeigt sie. `startCharging`
kostet Geld: Monav fragt vorher nach, nie ruft es das von selbst auf.

### Was ein Plugin hat

| | |
|---|---|
| `fetch(url, { method, headers, body, json, binary })` | Antwort: `{ status, ok, headers, text, json(), base64 }`. Nur zu den `hosts`. `json:` schickt JSON, `binary: true` liefert den Inhalt als `base64` (PDFs, Bilder). |
| `Monav.storage.get(key)` / `.set(key, value)` | bleibt gespeichert (JSON-Werte) |
| `Monav.secrets.get(key)` / `.set(key, value)` | im Schlüsselbund (Text), für Tokens und Passwörter |
| `Monav.setting(key)` | was in den Einstellungsfeldern steht |
| `Monav.sleep(ms)` | Promise |
| `Monav.uuid()` | neue UUID |
| `Monav.distance(a, b)` | Meter zwischen `{ latitude, longitude }` |
| `console.log / warn / error` | ins Log des Plugins (Monav › Plugins › Plugin) |

Jeder Aufruf hat 20 Sekunden (`chargers` 45, Dateien 60). Ein Fehler (`throw`) landet im Log und als letzter Fehler in
der Liste.

## Repository-Format

Monav liest `index.json` im Branch `main`. Neu erzeugen, nachdem ein Plugin dazukam oder
seine Version stieg:

```sh
node scripts/build-index.mjs
```
