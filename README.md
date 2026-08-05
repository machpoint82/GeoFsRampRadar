# [INSTALL](https://raw.githubusercontent.com/machpoint82/GeoFsRampRadar/main/rampradar.user.js)

# RampRadar

<p align="center">
  <img src="preview/preview.png" alt="RampRadar preview" width="720">
</p>

<p align="center">
  <a href="https://github.com/machpoint82/GeoFsRampRadar"><img src="https://img.shields.io/badge/github-repo-blue?logo=github" alt="GitHub"></a>
  <a href="https://github.com/machpoint82/GeoFsRampRadar/releases"><img src="https://img.shields.io/badge/version-1.0.0-cyan" alt="Version"></a>
  <a href="https://www.geo-fs.com/"><img src="https://img.shields.io/badge/GeoFS-3.9%20%7C%204.0-blue" alt="GeoFS"></a>
  <a href="https://www.tampermonkey.net/"><img src="https://img.shields.io/badge/Tampermonkey-userscript-green" alt="Tampermonkey"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="License"></a>
</p>

**Live airport surface charts for [GeoFS](https://www.geo-fs.com/)** — taxiways, gates, runways, live multiplayer traffic, METAR, and digital ATIS. Lightweight standalone addon (no AeroDeck required).

---

## Features

- **Live charts** for 1000+ airports (SVG diagrams: runways, taxiways, gates, frequencies)
- **Own aircraft** (cyan) + **multiplayer traffic** (pink) with type-aware icons
- **Hover tooltips** — callsign, route, speed, altitude
- **Click traffic** to focus / follow
- **Nearest airport**, **bookmarks**, **ORIG / DEST** chips from flight plan
- **Optional callsign** shown on your own hover
- **METAR** (NOAA) + **digital ATIS** (DATIS where available; decoded METAR otherwise)
- **Minimize mode** — resizable / draggable mini chart while you fly
- **Optional keyboard shortcut** to open / restore / close

---

## Install

1. Install **[Tampermonkey](https://www.tampermonkey.net/)** (Chrome, Firefox, Edge, Safari, etc.)
2. Open the raw userscript:

   **[Install RampRadar](https://raw.githubusercontent.com/machpoint82/GeoFsRampRadar/main/rampradar.user.js)**

3. Tampermonkey will prompt to install — confirm.
4. Reload [GeoFS](https://www.geo-fs.com/geofs.php) and click **CHARTS** on the bottom toolbar.

> **Updates:** open the Tools tab inside RampRadar. When a new version is published, it shows the changelog and a link to the raw script so you can update in a new tab.

---

## Usage

| Control | Action |
|--------|--------|
| **CHARTS** (toolbar) | Open / close the panel |
| **AIRPORT ICAO** + LOAD | Open a diagram |
| **NEAREST** | Chart for the closest airport to your position |
| **ORIG / DEST** | Load origin or destination (from flight plan / FP button) |
| **☆ SAVE** | Bookmark current airport (manage under Bookmarks tab) |
| Layer toggles | Taxi / Gates / Legend / Traffic |
| **Follow** | Keep the chart centered on you (or focused traffic) |
| **—** minimize | Compact floating chart; drag & resize |
| METAR/ATIS tab | Origin & dest weather + manual lookup |

## Requests & issues

Use GitHub Issues so requests stay searchable and don’t get lost in chat.

| Type | Use when | Open |
|------|----------|------|
| **Airport chart request** | You need a diagram for an ICAO that isn’t in `charts/` yet | [New chart request](https://github.com/machpoint82/GeoFsRampRadar/issues/new?template=airport-chart-request.md) |
| **Feature request** | Idea for the tablet, tabs, SimBrief, multiplayer, etc. | [New feature request](https://github.com/machpoint82/GeoFsRampRadar/issues/new?template=feature-request.md) |
| **Bug report** | Something broken in GeoFS with AeroDeck | [New issue](https://github.com/machpoint82/GeoFsRampRadar/issues/new) |

Before opening a chart request, check whether `charts/YOURICAO.json` already exists and whether someone already filed the same ICAO.
Currently 1000+ Airports charts are supported. See [Airports List](Airports%20Coverage.txt) for full airports list
                                                   [Airports ICAO](airports.txt)
---

---

## Repository layout

```
GeoFsRampRadar/
├── rampradar.user.js    # Tampermonkey userscript
├── charts/              # Airport diagram JSON (ICAO.json)
├── preview/
│   ├── preview.png      # Screenshot for this README
│   └── icon.png         # Userscript icon
├── CHANGELOG.md         # Optional release notes
├── LICENSE
└── README.md
```

Charts are loaded from:

`https://cdn.jsdelivr.net/gh/machpoint82/GeoFsRampRadar@main/charts/{ICAO}.json`

---

## Compatibility

| Environment | Status |
|-------------|--------|
| GeoFS **3.9** | Supported |
| GeoFS **4.0** | Supported |
| Tampermonkey | Required |
| Violentmonkey / Greasemonkey | Should work (GM_* APIs) |

---

## Data sources

- **Charts** — this repository (`charts/`)
- **Airport names / positions** — [mwgg/airports](https://github.com/mwgg/airports)
- **METAR** — [NOAA Aviation Weather Center](https://aviationweather.gov/)
- **Digital ATIS** — [DATIS](https://datis.clowd.io/) (mainly US); elsewhere: decoded METAR (not official ATIS)
- Aircraft icons from **Experimental Flight Interface (EFI)** by [Ferhatduran55](https://github.com/Ferhatduran55) — [geofs-experimental-fi](https://github.com/Ferhatduran55/geofs-experimental-fi).

---

## License

[MIT](LICENSE) © machpoint82

---

## Credits

Chart rendering concepts inspired by community GeoFS tools and the AeroDeck EFB charts module. Aircraft silhouettes adapted for surface-map use. Not affiliated with GeoFS / GEFS.
