<p align="center"><img src="assets/logo.png" alt="I♥B, the IVB logo: the heart grows out of the V" width="420"></p>

# IVB: India on Vande Bharat

IVB plans journeys across India on Vande Bharat trains alone. It is a static website with no server, so it can be hosted free on GitHub Pages and installed on a phone like an app.

## What it does

- **Connections.** Pick any two stations or cities and IVB lists every sensible way to make the journey on Vande Bharats only, with the fewest changes first. It allows a change of station by road within a city (Old Delhi to Hazrat Nizamuddin, say) and shows times and days off for the trains it has timetables for.
- **Circuits.** The Central India Loop, Kashmir to Kerala and back, with or without a two-week swing through the east. Pick a start city and date and IVB lays the trip out day by day, waiting a night wherever a train has its weekly day off. Every stop says what to see and whether you will be there in a good month.
- **When to go.** A chart scores every start date by the share of your nights spent in each place's good months, so you can see the best season for the whole loop.
- **Trains.** All 83 routes and 84 train pairs running on 6 November 2026, including the three Vande Bharat Sleepers, with every halt, on a map of India.

## Run it locally

The site loads its data with `fetch`, so open it through a web server rather than straight from disk:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Run the checks (Node 18 or later, no packages needed):

```sh
node tests/run.js
```

The tests check that every route, timetable, destination and circuit is consistent, that the connection finder finds known journeys, and that both circuits only use trains on days they run.

## Put it on GitHub Pages

1. Create an empty repository on GitHub, for example `ivb`.
2. Push this folder to it:
   ```sh
   git remote add origin https://github.com/<you>/ivb.git
   git push -u origin main
   ```
3. In the repository's **Settings → Pages**, set **Source** to **GitHub Actions**. The workflow in `.github/workflows/pages.yml` runs the tests and publishes the site on every push to `main`.

The site will be at `https://<you>.github.io/ivb/`. On a phone, open it and choose **Add to Home Screen** to install it; it then works offline.

## How it is built

| Path | What it holds |
|---|---|
| `index.html`, `assets/` | The page, styles, logo and app code |
| `lib/network.js` | The network model: stations, routes, directional timetables, destinations |
| `lib/finder.js` | The connection finder |
| `lib/schedule.js` | Circuit scheduling around days off, and season scores |
| `data/` | All the data, as plain JSON; see [DATA.md](DATA.md) |
| `vendor/d3.min.js` | D3 7.9.0 for the map (ISC licence) |
| `sw.js`, `manifest.webmanifest` | Offline use and installing on a phone |
| `tests/run.js` | Data and logic checks |

## Keeping it current

Vande Bharat services change every few weeks: new trains, extensions, extra halts, retimings and new days off. Each timetable in `data/timetables.json` records the pages it was checked against and the date. [DATA.md](DATA.md) explains how to update a train and what to check.

## Disclaimer

IVB is an unofficial planner. It is not connected with Indian Railways or IRCTC, and it does not sell tickets or show seat availability. Timetables can change at short notice, and a few trains have different days off in different sources (IVB notes these on the train). Always check NTES or IRCTC before you book.

## Licence

The code is released under the MIT licence (see [LICENSE](LICENSE)). Station positions come from [DataMeet railways](https://github.com/datameet/railways), and the map from the Survey of India outline published by [DataMeet maps](https://github.com/datameet/maps) with one boundary from [india-maps-data](https://github.com/udit-001/india-maps-data); see those projects for their terms. The destination notes are original text.
