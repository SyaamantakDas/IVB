<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-white.svg">
    <img src="assets/logo.svg" alt="I♥B, the IVB logo: a heart whose right arm is a Vande Bharat train" width="420">
  </picture>
</p>

# IVB: India on Vande Bharat

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.24087007.svg)](https://doi.org/10.5281/zenodo.24087007)

**See India on India’s finest trains.**

IVB plans journeys across India on Vande Bharat trains alone. It is a static website with no server, so it can be hosted free on GitHub Pages and installed on a phone like an app.

## What it does

- **Connections.** Pick any two stations or cities and IVB lists every sensible way to make the journey on Vande Bharats only, with the fewest changes first. It allows a change of station by road within a city (Old Delhi to Hazrat Nizamuddin, say) and shows times and days off for every train.
- **Dated journeys.** Pick a day to leave and IVB lists the actual trains and dates, soonest arrival first, each leaving as late as it can; it searches every run of every train with RAPTOR, the round-based method journey planners use. Each ride shows when its booking opens.
- **Circuits.** The Central India Loop, Kashmir to Kerala and back, with or without a two-week swing through the east, or **your own**: pick the places and the nights in each, and IVB finds the Vande Bharats between them and brings you back to the start. Pick a start date and IVB lays the trip out day by day, waiting a night wherever a train has its weekly day off. Every stop says what to see and whether you will be there in a good month.
- **When to go.** A chart scores every start date by the share of your nights spent in each place's good months, so you can see the best season for the whole loop.
- **Trains.** All 83 routes and 84 train pairs running on 8 November 2026, including the three Vande Bharat Sleepers, with every halt, on a map of India.

## Open data: the GTFS feed

IVB publishes its timetables as a [GTFS](https://gtfs.org/) feed, the world standard format for public transport timetables, which journey planners, maps and researchers can read directly:

**https://syaamantakdas.github.io/IVB/gtfs/ivb-gtfs.zip**

It holds every Vande Bharat service on IVB's network: 83 routes, 168 trains and 415 stations, with every halt, time and running day, and each route's line along the track. One community feed covers all Indian Railways trains ([indianrailways-gtfs](https://github.com/Neo2308/indianrailways-gtfs)), but it states no licence and was last generated in November 2025. IVB's covers Vande Bharat trains only, and it is openly licensed, names the sources of every train and is re-checked every week. It is rebuilt from `data/` on every change by `tools/build-gtfs.mjs` and checked with [MobilityData's GTFS Validator](https://github.com/MobilityData/gtfs-validator); the publish stops if the validator finds an error, and the latest report is at [gtfs/report/report.html](https://syaamantakdas.github.io/IVB/gtfs/report/report.html). The feed is under the ODbL 1.0, like the rest of IVB's data (see below).

To build it yourself: `node tools/build-gtfs.mjs` writes the feed to `gtfs/`.

## Pages for every train, station and place

Besides the app, the site has a plain page for every train (`train/22435/`), station (`station/ndls/`), place (`place/varanasi/`), journey between two places (`go/delhi-to-varanasi/`) and circuit (`loop/loop/`), with an index at [browse/](https://syaamantakdas.github.io/IVB/browse/) and a [sitemap](https://syaamantakdas.github.io/IVB/sitemap.xml). They work without JavaScript, so search engines and slow phones can read them. `tools/build-pages.mjs` builds them on every change; they are not kept in the repository. To have Google index them, add the site to [Google Search Console](https://search.google.com/search-console) and submit the sitemap (a `robots.txt` only counts at the root of a domain, so this project site cannot use one).

## The Android app

IVB is also packaged for Google Play as a Trusted Web Activity: the app opens the site full screen, so it always shows the current version. [android/README.md](android/README.md) explains the one-time setup and each release; the **Build the Android app** workflow builds it.

## Run it locally

The site loads its data with `fetch`, so open it through a web server rather than straight from disk:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Run the checks (Node 18 or later, no packages needed):

```sh
node tests/run.js          # data and logic
node tools/check-size.mjs  # file sizes against their budgets
```

The tests check that every route, timetable, destination and circuit is consistent, that the connection finder and the dated planner find known journeys, that every circuit only uses trains on days they run, and that each track line starts and ends at its stations.

Two more checks run on every change in GitHub Actions, and locally if you have the packages:

```sh
npx -p typescript tsc -p jsconfig.json                      # the library's types (JSDoc, lib/types.js)
npm i --no-save playwright axe-core && npx playwright install chromium
node tests/ui.mjs                                           # the site in a browser, with axe-core accessibility checks
```

The site sets a strict content security policy: it loads nothing from other servers (the fonts are in `assets/fonts`), runs no inline script and sends no data anywhere.

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
| `lib/planner.js` | Dated journeys (RAPTOR) |
| `lib/own.js` | Your own circuit: the trains between the places you choose |
| `lib/schedule.js` | Circuit scheduling around days off, and season scores |
| `lib/booking.js` | When each ride goes on sale, and the calendar file |
| `lib/polyline.js` | Reads and writes the track lines in `data/shapes.json` |
| `tools/` | The GTFS build, the track tracer and the data layout check; see [DATA.md](DATA.md) |
| `data/` | All the data, as plain JSON; see [DATA.md](DATA.md) |
| `vendor/d3.ivb.min.js` | The parts of D3 the map uses (ISC licence); `tools/build-d3.sh` rebuilds it |
| `sw.js`, `manifest.webmanifest` | Offline use and installing on a phone |
| `tests/run.js` | Data and logic checks |
| `tests/ui.mjs` | Browser checks, including accessibility |

## Keeping it current

Vande Bharat services change every few weeks: new trains, extensions, extra halts, retimings and new days off. Each timetable in `data/timetables.json` records the pages it was checked against and the date. [DATA.md](DATA.md) explains how to update a train and what to check.

## Disclaimer

IVB is an unofficial planner. It is not connected with Indian Railways or IRCTC, and it does not sell tickets or show seat availability. Timetables can change at short notice, and a few trains have different days off in different sources (IVB notes these on the train). Always check NTES or IRCTC before you book.

## Licence and credit

IVB is © 2026 Syaamantak Das.

- **Code:** the MIT licence; see [LICENSE](LICENSE).
- **Data:** everything in `data/`, and the GTFS feed built from it, is under the [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/); the full text is in [data/LICENSE](data/LICENSE). Original text in the data, such as the notes on places and circuits, is under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- **Credit IVB** wherever you use its code or data: *IVB (India on Vande Bharat) by Syaamantak Das, https://syaamantakdas.github.io/IVB/, data under ODbL 1.0.* If you publish a database built from IVB's data, the ODbL asks you to share it under the ODbL too.
- **Cite IVB** as: Das, S. (2026). *IVB: India on Vande Bharat* (Version v1.0.0) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.24087007. GitHub shows the same details under **Cite this repository**, from [CITATION.cff](CITATION.cff). Each release is archived on Zenodo with its own DOI. Author: Syaamantak Das, [ORCID 0000-0001-9896-3312](https://orcid.org/0000-0001-9896-3312).
- **Name and logo:** the IVB name and the I♥B logo are not covered by either licence.
- **Other sources:** station positions come from [DataMeet railways](https://github.com/datameet/railways) (CC0); the map from the Survey of India outline published by [DataMeet maps](https://github.com/datameet/maps) (CC BY 4.0) with one boundary from [india-maps-data](https://github.com/udit-001/india-maps-data); and the track lines and distances by rail from [OpenStreetMap](https://www.openstreetmap.org/copyright), © OpenStreetMap contributors (ODbL). Credit those projects too when you reuse the map or the feed.
