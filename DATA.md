# IVB data

Everything IVB knows lives in `data/` as plain JSON. Edit the files directly, then run `node tests/run.js` before you commit.

## Licence

The IVB data is © 2026 Syaamantak Das and is made available under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/); the full text is in [data/LICENSE](data/LICENSE). Original text in it, such as the notes on places and circuits, is under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

When you use the data, credit it as *IVB (India on Vande Bharat) by Syaamantak Das, https://syaamantakdas.github.io/IVB/, data under ODbL 1.0*. If you publish a database built from it, share that database under the ODbL as well.

Parts of the data come from other projects and keep their own terms: station positions from [DataMeet railways](https://github.com/datameet/railways) (CC0), and the map outline in `india.geo.json` from [DataMeet maps](https://github.com/datameet/maps) (CC BY 4.0) with one boundary from [india-maps-data](https://github.com/udit-001/india-maps-data).

## Files

### `stations.json`
Every station a Vande Bharat calls at, keyed by its Indian Railways code:

```json
"NDLS": ["New Delhi", 28.6423, 77.22, 0, "Delhi"]
```

The fields are name, latitude, longitude, whether the position is approximate (`1`) and the state or union territory.

### `routes.json`
One entry per route, in calling order from one end to the other:

```json
{"n": "22435/22436", "l": "New Delhi – Varanasi", "t": "cc", "s": ["NDLS", "CNB", "PRYJ", "BSB"], "note": "", "u": [], "km": 696}
```

- `n`: the train numbers. Two numbers on one route are separated by ` · `.
- `t`: `cc` for chair car, `sleeper` for the Vande Bharat Sleeper.
- `s`: the halts in order. Only list a halt that a current timetable shows.
- `u`: halts that only some timetables show. IVB labels them unconfirmed and draws them with a dashed ring.
- `km`: the route's length, measured in straight lines from stop to stop, so a little under the distance by rail.

### `timetables.json`
Directional trains under `trains`, keyed by train number, with the date of the last full check in `checked`. IVB uses these for times, days off and the circuits. Shortened here; the real entry lists every halt:

```json
{
  "checked": "2026-11-06",
  "trains": {
    "20901": {
      "route": "20901/20902", "from": "MMCT", "to": "GNC",
      "days": ["Sun", "Mon", "Tue", "Thu", "Fri", "Sat"],
      "times": {"MMCT": [null, "06:00"], "BVI": ["06:23", "06:25"], "ADI": ["11:35", "11:40"], "GNC": ["12:30", null]},
      "src": ["https://www.railmitra.com/train-schedule/20901"],
      "checked": "2026-11-06"
    }
  }
}
```

- `route` must match an `n` in `routes.json`, and every station in `times` must be a halt on that route.
- `days` are the days the train leaves its first station.
- `times` are `[arrival, departure]`. Add `+1` for the next day, as in `"00:40+1"`.
- `src` lists the pages the entry was checked against, and `checked` is the date.
- `note` records anything a traveller should know, such as sources disagreeing on the day off.

When sources disagree on a day off, IVB goes with the most recent timetable, or leaves both days out of `days` when it can't tell which is current, and says so in `note`.

### `places.json`
Destinations under `places`, with what to see, a practical tip and the best months:

```json
{"id": "agra", "name": "Agra", "state": "Uttar Pradesh", "codes": ["AGC"], "months": "122100001221", "see": ["..."], "tip": "..."}
```

`months` has twelve digits for January to December: `2` for a good month, `1` for fair and `0` for one to avoid. The season chart and the season tags in circuits come from these. A place with no Vande Bharat station (Orchha) has `code`, `lat` and `lon` instead of station codes.

### `circuits.json`
The circuits are listed under `circuits`, each with an `id`, a `name` and its `stops`. Each circuit is a loop. A stop has a place, the station you arrive at, the nights you plan to stay and the move to the next stop:

```json
{"place": "agra", "code": "AGC", "nights": 1, "move": [{"train": "20176", "from": "AGC", "to": "BSBS"}]}
```

A move can include road changes: `{"road": true, "from": "DLI", "to": "NZM", "km": 8, "text": "Old Delhi to Hazrat Nizamuddin"}`. A rail leg with `"options": ["20893", "21895", "21893"]` takes whichever of those trains runs that day. The last stop's move leads back to the first, so the loop can start anywhere.

### `events.json`
Dated festivals under `events` (`name`, `place`, `from`, `to`), which appear on a circuit when your dates match. Use `"place": "*"` for festivals everywhere.

### `india.geo.json`
The map outline and state lines, simplified from the Survey of India map published by [DataMeet](https://github.com/datameet/maps), with the Jammu and Kashmir – Ladakh line from [india-maps-data](https://github.com/udit-001/india-maps-data).

## Updating a train

1. Find the train's current timetable on at least one timetable site and, where you can, a Railway Board circular or a news report of the change.
2. Update the halts in `routes.json` if they changed, and the times and days in `timetables.json`.
3. Put the pages you used in `src` and today's date in `checked`.
4. Run `node tests/run.js`. It checks that halts and times line up, and that both circuits still only use trains on days they run.

## Sources

Routes and halts come from Railway Board coaching circulars, Wikipedia, Trayaan, 24coaches and timetable sites (ConfirmTkt, RailMitra, etrain, Total Train Info). Station positions come from the [DataMeet railways](https://github.com/datameet/railways) dataset; a few new or renamed stations are placed approximately and are flagged in `stations.json`.
