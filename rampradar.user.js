// ==UserScript==
// @name         RampRadar — GeoFS Live Charts
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Live airport surface charts for GeoFS — traffic, METAR, digital ATIS.
// @author       machpoint82
// @match        *://www.geo-fs.com/*
// @match        *://geo-fs.com/*
// @icon         https://raw.githubusercontent.com/machpoint82/GeoFsRampRadar/main/preview/icon.png
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      cdn.jsdelivr.net
// @connect      raw.githubusercontent.com
// @connect      aviationweather.gov
// @connect      datis.clowd.io
// @connect      metar.vatsim.net
// ==/UserScript==

(function () {
    'use strict';

    // Charts from your GeoFsRampRadar repo (push charts/ then this resolves via jsDelivr)
    const CHARTS_BASE_URL = 'https://cdn.jsdelivr.net/gh/machpoint82/GeoFsRampRadar@main/charts';
    const AIRPORTS_URL = 'https://raw.githubusercontent.com/mwgg/airports/master/airports.json';
    const SCRIPT_VERSION = '1.0.0';
    const VERSION_CHECK_URL = 'https://raw.githubusercontent.com/machpoint82/GeoFsRampRadar/main/rampradar.user.js';
    const CHANGELOG_URL = 'https://raw.githubusercontent.com/machpoint82/GeoFsRampRadar/main/CHANGELOG.md';
    const ISSUES_URL = 'https://github.com/machpoint82/GeoFsRampRadar/issues';
    // Greasy Fork / raw install URL for Tampermonkey “update” open-in-new-tab
    const SCRIPT_INSTALL_URL = 'https://raw.githubusercontent.com/machpoint82/GeoFsRampRadar/main/rampradar.user.js';
    const METAR_CACHE_MS = 10 * 60 * 1000;
    const ATIS_CACHE_MS = 5 * 60 * 1000;
    const SCRIPT_CHANGELOG = {
        '1.0.0': [
            'Initial release: live airport charts, GeoFS traffic, METAR + digital ATIS',
            'Minimize mode, bookmarks, origin/dest chips, optional callsign'
        ]
    };

    const STORAGE = {
        GEOMETRY: 'rampradar_geometry_v1',
        MINI_GEOMETRY: 'rampradar_mini_geometry_v1',
        CHART_LAYERS: 'rampradar_layers_v1',
        CHART_FOLLOW: 'rampradar_follow_v1',
        LAST_ICAO: 'rampradar_last_icao',
        BOOKMARKS: 'rampradar_bookmarks',
        OPEN_SHORTCUT: 'rampradar_open_shortcut',
        ROUTE_ORIGIN: 'rampradar_route_origin',
        ROUTE_DEST: 'rampradar_route_dest',
        CALLSIGN: 'rampradar_callsign'
    };

    function pageGeofs() {
        try { if (typeof unsafeWindow !== 'undefined' && unsafeWindow.geofs) return unsafeWindow.geofs; } catch (e) {}
        try { if (typeof window !== 'undefined' && window.geofs) return window.geofs; } catch (e) {}
        try { if (typeof geofs !== 'undefined') return geofs; } catch (e) {}
        return null;
    }
    function pageMultiplayer() {
        try { if (typeof unsafeWindow !== 'undefined' && unsafeWindow.multiplayer) return unsafeWindow.multiplayer; } catch (e) {}
        try { if (typeof multiplayer !== 'undefined') return multiplayer; } catch (e) {}
        return null;
    }
    function gmGet(key, fallback) {
        try {
            if (typeof GM_getValue === 'function') {
                const v = GM_getValue(key, undefined);
                return v === undefined ? fallback : v;
            }
        } catch (e) {}
        try {
            const raw = localStorage.getItem(key);
            return raw === null ? fallback : JSON.parse(raw);
        } catch (e) { return fallback; }
    }
    function gmSet(key, value) {
        try { if (typeof GM_setValue === 'function') { GM_setValue(key, value); return; } } catch (e) {}
        try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    }
    function gmFetchText(url, timeoutMs) {
        return new Promise((resolve, reject) => {
            if (typeof GM_xmlhttpRequest !== 'function') {
                fetch(url).then((r) => r.ok ? r.text() : Promise.reject(new Error('bad status ' + r.status))).then(resolve).catch(reject);
                return;
            }
            GM_xmlhttpRequest({
                method: 'GET', url, timeout: timeoutMs || 12000,
                onload: (res) => {
                    if (res.status >= 200 && res.status < 300) resolve(res.responseText);
                    else reject(new Error('bad status ' + res.status));
                },
                onerror: () => reject(new Error('network error')),
                ontimeout: () => reject(new Error('timeout'))
            });
        });
    }
    function escapeHtml(s) {
        return (s || '').toString().replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function formatClockHMS(d) {
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ':' + String(d.getSeconds()).padStart(2, '0');
    }

    function getCurrentLatLon() {
        try {
            const g = pageGeofs();
            const inst = g && g.aircraft && g.aircraft.instance;
            if (inst && Array.isArray(inst.llaLocation) && inst.llaLocation.length >= 2)
                return { lat: inst.llaLocation[0], lon: inst.llaLocation[1] };
        } catch (e) {}
        return null;
    }
    function getCurrentGroundSpeedKts() { try { return geofs.animation.values.groundSpeedKnt; } catch (e) { return null; } }
    function getCurrentHeading() { try { return geofs.animation.values.heading; } catch (e) { return null; } }
    function getCurrentAltitudeFt() { try { return Math.round(geofs.animation.values.altitude); } catch (e) { return null; } }

const groups = {
  default: [
    "9",
    "51",
    "52",
    "102",
    "1000",
    "1025",
    "1027",
    "2726",
    "2806",
    "2840",
    "2844",
    "2852",
    "3049",
    "4090",
    "4197",
    "4949",
    "5002"
  ],
  fighter: ["7", "15", "2808", "4251"],
  fighterJet: [
    "3",
    "18",
    "27",
    "29",
    "1024",
    "2310",
    "2364",
    "2556",
    "2581",
    "2857",
    "2948",
    "2988",
    "3591",
    "3617",
    "5229",
    "5347",
    "5405",
    "5431"
  ],
  glider: ["11", "41", "50", "53", "103", "2953", "2968"],
  singleEngine: [
    "1",
    "2",
    "8",
    "12",
    "13",
    "21",
    "22",
    "23",
    "31",
    "40",
    "1019",
    "1022",
    "1026",
    "1069",
    "2000",
    "2750",
    "2786",
    "2976",
    "2989",
    "3211",
    "4341",
    "4390",
    "4409",
    "4596",
    "5061",
    "5486",
    "5499"
  ],
  twinPistonEngine: ["14", "16", "28", "4398", "4401"],
  privateJet: [],
  twinTurboprop: ["6", "26", "2864", "3460"],
  twinjetNarrowBody: [
    "4",
    "238",
    "242",
    "1001",
    "1003",
    "1007",
    "1008",
    "2003",
    "2769",
    "2772",
    "2843",
    "2865",
    "2870",
    "2871",
    "2878",
    "2879",
    "2899",
    "3011",
    "3054",
    "3140",
    "3292",
    "3534",
    "4140",
    "4646",
    "4743",
    "4745",
    "5086",
    "5156",
    "5203",
    "5551"
  ],
  rearMountedTwinJet: [],
  wideBody4Engine: [
    "10",
    "252",
    "1002",
    "1010",
    "1012",
    "2153",
    "2752",
    "2951",
    "5193",
    "5211",
    "5314",
    "5409"
  ],
  twinjetNarrowBody2: [],
  twinjetWideBody: [
    "24",
    "25",
    "235",
    "237",
    "239",
    "240",
    "244",
    "1004",
    "1005",
    "1006",
    "1009",
    "1011",
    "2386",
    "2856",
    "2973",
    "3179",
    "3180",
    "3575",
    "4402",
    "4631",
    "4764"
  ],
  narrowBody4Engine: ["20", "1014", "2395"],
  trijet: ["1023", "5038"],
  regionalJet: [
    "236",
    "1015",
    "1016",
    "1017",
    "1018",
    "2004",
    "2700",
    "2706",
    "3036",
    "3307",
    "3341",
    "4017"
  ],
  heavyCargo: ["2788", "5516"],
  businessJet: ["5", "1021", "2461", "3109", "5073"],
  turbopropCommuter: [
    "247",
    "1013",
    "1020",
    "2418",
    "2420",
    "2426",
    "2892",
    "2943",
    "3289",
    "3436"
  ]
};
    const AIRCRAFT_GROUPS = groups;
    const ICON_PATHS = {
        businessJet: 'M 20 4 C 20.8 4 21.5 6 21.5 8 L 21.5 15 L 35 19 L 35 21 L 21.5 18 L 21.5 23 L 23.5 23 L 23.5 28 L 21.5 28 L 21.5 30 L 26 32 L 26 34 L 20 32.5 L 14 34 L 14 32 L 18.5 30 L 18.5 28 L 16.5 28 L 16.5 23 L 18.5 23 L 18.5 18 L 5 21 L 5 19 L 18.5 15 L 18.5 8 C 18.5 6 19.2 4 20 4 Z',
        default: 'M 5.101 15.347 C 2.964 16.627 1.651 20.48 4.784 22.347 L 18.428 22.427 L 18.34 27.221 L 14.479 29.308 L 14.454 32.061 L 15.93 33.312 L 24.341 33.439 L 25.637 32.184 L 25.606 29.62 L 21.474 27.133 L 21.513 22.427 L 35.197 22.387 C 38.144 20.244 36.826 17.341 35.356 15.585 L 22.554 15.521 L 23.117 12.941 L 21.93 11.38 L 19.954 10.848 L 18.043 11.497 L 16.884 12.976 L 17.333 15.443 L 5.101 15.347',
        fighter: 'M 7.462 27.371 L 7.079 28.003 L 7.04 28.816 L 8.516 28.759 L 8.562 28.151 L 17.252 28.185 L 17.146 30.781 L 13.182 34.386 L 13.098 36.219 L 13.519 36.754 L 17.208 36.717 L 18.096 36.428 L 18.176 33.765 L 18.56 35.681 L 19.085 37.248 L 19.707 37.266 L 20 38.6 L 20.299 37.281 L 20.83 37.224 L 21.42 35.624 L 21.69 33.696 L 21.877 36.45 L 22.749 36.722 L 26.521 36.658 L 26.981 35.989 L 26.822 34.255 L 22.927 30.89 L 22.966 28.044 L 31.426 28.065 L 31.576 28.775 L 32.862 28.687 L 32.869 27.938 L 32.413 27.582 L 32.243 21.254 L 31.474 25.144 L 23.77 18.686 L 22.474 14.206 L 21.604 8.572 L 21.17 4.509 L 19.945 1.396 L 18.829 4.558 L 18.389 8.531 L 17.389 14.241 L 16.334 18.726 L 8.577 24.995 L 7.694 21.259 L 7.424 27.369',
        fighterJet: 'M 19.745 4.207 C 19.819 3.899 20.298 2.806 20.654 4.205 C 20.921 5.256 21.28 7.204 21.28 7.247 C 21.28 7.317 24.835 10.529 25.08 10.757 C 25.323 10.99 25.029 11.865 24.871 11.805 L 21.911 11.006 C 21.503 11.12 23.396 18.508 23.573 18.733 C 23.759 19.18 32.785 28.852 32.57 28.708 C 32.784 29.296 32.515 31.546 32.435 31.33 C 32.419 31.437 24.948 32.67 24.143 32.52 C 23.45 32.313 21.734 32.018 21.734 32.095 L 20.199 35.862 L 18.579 32.108 C 18.484 32.021 16.159 32.567 15.963 32.596 C 15.771 32.626 7.871 31.262 7.926 31.295 C 7.76 31.368 7.538 28.83 7.718 28.747 L 16.511 19.141 C 16.888 18.946 18.961 11.135 18.225 11.043 L 15.319 11.771 C 15.064 11.771 15.195 10.47 15.446 10.47 L 19.041 7.227 L 19.745 4.207 Z',
        glider: 'M 19.379 15.812 C 19.444 14.978 20.585 14.995 20.644 15.869 L 20.761 18.971 C 21.713 18.887 35.793 19.418 35.913 19.479 C 36.8 19.932 36.096 20.578 35.889 20.577 C 35.888 20.577 20.713 21.155 20.713 21.155 L 20.47 27.107 C 21.332 27.712 22.318 28.887 21.939 28.85 L 18.043 28.842 C 17.652 28.875 18.651 27.784 19.522 27.112 L 19.162 21.152 L 3.91 20.643 C 3.479 20.6 2.919 19.876 3.875 19.484 C 3.875 19.484 18.355 18.958 19.162 19.021 L 19.379 15.812 Z',
        heavyCargo: 'M 20 3 C 20.8 3 21.5 6 21.5 9 L 21.5 14 L 23.5 14.5 L 23.5 12 L 26 12 L 26 15.5 L 38 20 L 38 23 L 21.5 18 L 21.5 31 L 29 35 L 29 37 L 20 35 L 11 37 L 11 35 L 18.5 31 L 18.5 18 L 2 23 L 2 20 L 14 15.5 L 14 12 L 16.5 12 L 16.5 14.5 L 18.5 14 L 18.5 9 C 18.5 6 19.2 3 20 3 Z',
        narrowBody4Engine: 'M 17.854 4.596 C 17.854 4.596 18.928 1.371 20.004 1.371 C 21.079 1.371 22.153 4.596 22.153 4.596 L 22.153 14.273 L 24.304 15.347 L 24.304 13.197 C 25.38 12.768 25.38 12.758 26.454 13.197 L 26.454 16.423 L 29 17.7 L 29 15.5 C 30.075 15.1 30.075 15.1 31.15 15.5 L 31.15 18.8 L 37.205 21.799 C 37.59 21.799 37.613 23.948 37.205 23.948 L 26.454 20.723 C 24.304 20.442 22.153 20.723 22.153 20.723 C 22.153 20.723 21.76 34.735 21.079 34.699 L 26.454 37.29 C 26.745 37.924 26.454 39 26.454 39 C 26.454 39 20.004 37.561 20.004 37.561 C 20.004 37.561 13.553 39 13.553 39 C 13.553 39 13.277 37.924 13.553 37.315 C 13.562 37.297 18.928 34.699 18.928 34.699 C 18.283 34.699 17.854 20.723 17.854 20.723 C 17.854 20.723 15.703 20.428 13.553 20.723 L 2.802 23.948 C 2.4 23.948 2.406 21.799 2.802 21.799 L 8.85 18.8 L 8.85 15.5 C 9.925 15.1 9.925 15.1 11 15.5 L 11 17.7 L 13.553 16.371 L 13.553 13.197 C 14.628 12.788 14.628 12.752 15.703 13.197 L 15.703 15.347 L 17.854 14.273 L 17.854 4.596 Z',
        privateJet: 'M 18.285 17.094 L 7.606 19.124 C 7.458 19.101 6.512 22.72 6.591 22.734 L 16.329 22.745 L 16.713 28.721 L 18.329 28.721 L 19.154 26.824 L 19.154 30.819 L 17.715 32.479 L 17.715 35.51 L 15.777 36.742 L 15.581 38.299 L 20.034 37.312 L 24.645 38.299 L 24.406 36.742 L 22.393 35.51 L 22.393 32.479 L 20.997 30.776 L 20.997 26.824 L 21.794 28.721 L 23.379 28.721 L 23.748 22.745 L 33.575 22.745 C 33.698 22.713 32.732 19.024 32.61 19.056 L 21.794 17.12 L 21.741 4.909 C 21.537 3.741 21.594 3.461 20.997 2.507 C 20.734 2.088 20.505 1.829 20.031 1.7 C 19.591 1.847 19.399 2.045 19.154 2.507 C 18.692 3.377 18.6 3.594 18.329 4.895 L 18.285 17.094 Z',
        rearMountedTwinJet: 'M 18.5 15.064 L 18.61 2.931 C 18.573 2.931 18.716 2.43 18.904 1.977 C 18.904 1.977 19.485 0.905 20 0.905 C 20.542 0.905 21.121 1.977 21.121 1.977 C 21.313 2.44 21.466 2.941 21.466 2.941 L 21.466 15.117 L 34.454 20 L 34.454 21.003 L 21.466 21.003 L 21.466 23.205 C 21.499 23.041 23.437 23.041 23.404 23.205 L 23.124 28.571 L 21.466 28.571 L 20.717 33.893 L 25.435 37.187 C 25.495 37.187 25.494 38.688 25.435 38.688 L 20 37.187 L 14.487 38.688 C 14.429 38.688 14.429 37.187 14.487 37.187 L 19.301 33.893 L 18.585 28.571 L 16.795 28.571 L 16.5 23.205 C 16.5 23.073 18.585 23.073 18.585 23.205 L 18.585 21.003 L 5.963 21.003 L 5.963 20 L 18.5 15.064 Z',
        regionalJet: 'M 20 2 C 20.8 2 21.8 5 21.8 8 L 21.8 15 L 36 22 L 36 24 L 21.8 19 L 21.8 25 L 24.5 25 L 24.5 31 L 21.8 30 L 21.8 33 L 27 36 L 27 38 L 20 37 L 13 38 L 13 36 L 18.2 33 L 18.2 30 L 15.5 31 L 15.5 25 L 18.2 25 L 18.2 19 L 4 24 L 4 22 L 18.2 15 L 18.2 8 C 18.2 5 19.2 2 20 2 Z',
        singleEngine: 'M 17.826 17.655 L 18.29 13.267 C 18.394 11.302 21.829 11.302 21.725 13.267 L 22.214 17.656 L 36.888 17.967 C 37.101 17.957 36.977 21.653 36.888 21.621 C 36.801 21.59 22.292 22.471 22.292 22.471 C 21.955 22.463 21.278 30.615 21.633 30.606 L 26.166 31.806 C 26.339 31.806 26.346 34.326 26.243 34.326 L 21.008 35.254 L 20.033 37 L 19.076 35.254 L 13.885 34.326 C 13.77 34.326 13.77 31.806 13.885 31.806 L 18.338 30.606 C 18.693 30.412 17.925 22.355 17.718 22.471 L 3.111 21.621 C 2.97 21.621 2.97 17.899 3.111 17.899 L 17.826 17.655 Z',
        trijet: 'M 20 2 C 21 2 22 5 22 8 L 22 14 L 36 19 L 36 22 L 22 18 L 22 32 L 28 35 L 28 37 L 20 35.5 L 12 37 L 12 35 L 18 32 L 18 18 L 4 22 L 4 19 L 18 14 L 18 8 C 18 5 19 2 20 2 Z M 20 16 C 21 16 22 17 22 18 C 22 19 21 20 20 20 C 19 20 18 19 18 18 C 18 17 19 16 20 16 Z',
        turbopropCommuter: 'M 20 2 L 21.7 5 L 21.7 12 L 23.5 12 L 23.5 11 L 25 11 L 25 13.5 L 37 18 L 37 20.5 L 25 17 L 23.5 17.5 L 21.7 18 L 21.7 29 L 27 31.5 L 27 33.5 L 20 32 L 13 33.5 L 13 31.5 L 18.3 29 L 18.3 18 L 16.5 17.5 L 15 17 L 3 20.5 L 3 18 L 15 13.5 L 15 11 L 16.5 11 L 16.5 12 L 18.3 12 L 18.3 5 L 20 2 Z',
        twinPistonEngine: 'M 18.155 17.368 L 18.456 13.739 C 18.456 13.143 18.966 10.1 19.071 9.848 C 19.369 9.128 20.023 8.709 20.043 8.761 C 20.114 8.732 20.782 9.056 21.112 9.848 C 21.287 10.275 21.712 13.143 21.712 13.739 L 21.997 17.368 L 25.158 17.368 L 25.158 13.739 C 25.89 13.143 26.898 13.143 27.654 13.739 L 27.654 17.368 L 38.007 17.803 L 38.007 21.981 L 27.654 21.981 C 26.898 23.701 25.858 23.701 25.158 21.981 C 25.158 21.981 22.028 21.981 21.997 21.981 L 21.112 33.163 L 26.898 33.429 L 26.898 36.79 L 13.402 36.79 L 13.402 33.429 L 19.071 33.163 L 18.155 21.981 L 15.21 21.981 C 14.463 23.701 13.402 23.701 12.694 21.981 L 2.007 21.981 L 2.007 17.803 L 12.694 17.368 L 12.694 13.739 C 13.402 13.143 14.525 13.143 15.21 13.739 L 15.21 17.368 L 18.155 17.368 Z',
        twinTurboprop: 'M 21.699 17.936 L 21.699 7.409 C 21.719 6.981 21.408 6.24 20.924 5.756 C 20.406 5.237 19.986 5.248 19.986 5.248 C 19.986 5.248 19.614 5.276 19.134 5.756 C 18.674 6.217 18.334 7.007 18.334 7.409 L 18.334 17.936 L 18.334 18.315 L 15.338 18.315 L 15.338 15.644 C 14.884 14.551 13.978 14.551 13.546 15.644 L 13.546 18.315 L 1.918 19.041 C 1.727 18.968 1.727 21.517 1.918 21.589 L 13.546 22.256 C 14.193 23.82 14.692 23.821 15.338 22.256 L 18.334 22.256 C 18.334 22.256 19.114 36.07 19.134 36.116 L 13.546 36.854 L 13.546 39.487 L 26.655 39.487 L 26.655 36.91 L 20.924 36.145 L 21.699 22.256 L 24.47 22.256 C 25.11 23.803 25.667 23.808 26.31 22.256 L 37.649 21.589 C 37.856 21.552 37.773 19.017 37.649 19.041 L 26.31 18.315 L 26.31 15.644 C 25.894 14.551 24.936 14.551 24.511 15.644 L 24.511 18.315 L 21.699 18.315 L 21.699 17.936 Z',
        twinjetNarrowBody: 'M 17.854 4.596 C 17.854 4.596 18.928 1.371 20.004 1.371 C 21.079 1.371 22.153 4.596 22.153 4.596 L 22.153 14.273 L 24.304 15.347 L 24.304 13.197 C 25.38 12.768 25.38 12.758 26.454 13.197 L 26.454 16.423 L 37.205 21.799 C 37.59 21.799 37.613 23.948 37.205 23.948 L 26.454 20.723 C 24.304 20.442 22.153 20.723 22.153 20.723 C 22.153 20.723 21.76 34.735 21.079 34.699 L 26.454 37.29 C 26.745 37.924 26.454 39 26.454 39 C 26.454 39 20.004 37.561 20.004 37.561 C 20.004 37.561 13.553 39 13.553 39 C 13.553 39 13.277 37.924 13.553 37.315 C 13.562 37.297 18.928 34.699 18.928 34.699 C 18.283 34.699 17.854 20.723 17.854 20.723 C 17.854 20.723 15.703 20.428 13.553 20.723 L 2.802 23.948 C 2.4 23.948 2.406 21.799 2.802 21.799 L 13.553 16.371 L 13.553 13.197 C 14.628 12.788 14.628 12.752 15.703 13.197 L 15.703 15.347 L 17.854 14.273 L 17.854 4.596 Z',
        twinjetNarrowBody2: 'M 17.919 4.912 C 17.919 4.912 18.88 0.75 20 0.75 C 21.119 0.75 22.081 4.912 22.081 4.912 L 22.369 13.238 L 25.203 15.318 L 25.203 13.238 C 26.323 12.79 26.167 12.78 27.284 13.238 L 27.284 16.358 L 37.69 21.561 C 38.091 21.561 38.115 23.643 37.69 23.643 L 25.203 20.52 C 23.121 20.107 22.081 20.52 22.081 20.52 C 22.081 20.52 22.081 31.967 21.04 34.049 L 26.244 37.169 C 27.284 37.919 27.008 39.251 27.008 39.251 L 20 37.169 L 13.001 39.251 C 13.001 39.251 12.716 37.917 13.757 37.169 C 13.765 37.151 18.96 34.049 18.96 34.049 C 17.919 31.967 17.919 20.52 17.919 20.52 C 17.919 20.52 16.879 20.093 14.798 20.52 L 2.311 23.643 C 1.893 23.643 1.899 21.561 2.311 21.561 L 12.716 16.358 L 12.716 13.238 C 13.834 12.811 13.679 12.773 14.798 13.238 L 14.798 15.318 L 17.631 13.238 L 17.919 4.912 Z',
        twinjetWideBody: 'M 20 2 C 21.5 2 23 6 23 10 L 23 15 L 25 15.8 L 25 13 L 28 13 L 28 17 L 38 21 L 38 24 L 23 19 L 23 32 L 30 36 L 30 38 L 20 36 L 10 38 L 10 36 L 17 32 L 17 19 L 2 24 L 2 21 L 12 17 L 12 13 L 15 13 L 15 15.8 L 17 15 L 17 10 C 17 6 18.5 2 20 2 Z',
        wideBody4Engine: 'M 20 4 C 20.36 4 21 5 21 5 C 21 5 22 6.5 22 8 L 22 15.5 L 24 16 L 24 14 C 24 13.5 25.49 13.5 25.49 14 L 25.49 16.5 L 27 17 L 27 15 C 27 14.5 28.5 14.5 28.5 15 L 28.5 17.5 L 36 20 C 36.268 20 36.268 22 36 22 L 22 20.5 L 22 26 C 22 26 22 29 21 34 L 27 37 L 27 39 L 20 37.5 L 13 39 L 13 37 L 19 34 C 18 29 18 26 18 26 L 18 20.5 L 4 22 C 3.81 22 3.82 20 4 20 L 11.503 17.5 L 11.503 15 C 11.503 14.5 13 14.5 13 15 L 13 17 L 14.447 16.5 L 14.447 14 C 14.447 13.5 16 13.5 16 14 L 16 16 L 18 15.5 L 18 8 C 18 6.5 19 5 19 5 C 19 5 19.644 4 20 4 Z'
    };
    const AIRCRAFT_NAME_TABLE = [
        { re: /a380/i, group: 'wideBody4Engine' },
        { re: /747|a340|il-?86/i, group: 'wideBody4Engine' },
        { re: /777|787|a350|a330|767/i, group: 'twinjetWideBody' },
        { re: /md-?11|dc-?10/i, group: 'trijet' },
        { re: /757|737|a32[0-1]|a319|a318|a220/i, group: 'twinjetNarrowBody' },
        { re: /crj|e1[79]|bae ?146|rj ?100/i, group: 'regionalJet' },
        { re: /atr|dash-?8|q400|c-?130/i, group: 'turbopropCommuter' },
        { re: /citation|lear|gulfstream|challenger|global|falcon|phenom/i, group: 'businessJet' },
        { re: /an-?225|an-?124|il-?76|c-5\b|c-17|freighter|cargo/i, group: 'heavyCargo' },
        { re: /f-?1[68]|f-?22|f-?35|mig|su-2|rafale|typhoon/i, group: 'fighterJet' },
        { re: /cessna|piper|cirrus|skyhawk|archer|bonanza/i, group: 'singleEngine' },
        { re: /glider|ask-|discus/i, group: 'glider' }
    ];
    function getGroup(aircraftId) {
        const id = String(aircraftId);
        for (const groupName in AIRCRAFT_GROUPS) {
            if (AIRCRAFT_GROUPS[groupName].includes(id)) return groupName;
        }
        return 'default';
    }
    function groupFromName(name) {
        if (!name) return null;
        for (const e of AIRCRAFT_NAME_TABLE) if (e.re.test(name)) return e.group;
        return null;
    }
    function detectCurrentAircraft() {
        try {
            const g = pageGeofs();
            if (!g || !g.aircraft || !g.aircraft.instance) return null;
            const inst = g.aircraft.instance;
            const id = inst.id;
            if (id == null || id === '') return null;
            let name = null;
            try {
                const list = g.aircraftList || {};
                const entry = list[id] || list[String(id)] || list[Number(id)];
                if (entry && entry.name) name = entry.name;
            } catch (e) {}
            if (!name) {
                try { name = inst.aircraftName || inst.name || (inst.definition && inst.definition.name) || null; } catch (e) {}
            }
            const byName = groupFromName(name);
            return { id, name: name || ('Aircraft #' + id), group: byName || getGroup(id) };
        } catch (e) { return null; }
    }
    function resolveGroup(aircraftId, name) {
        return groupFromName(name) || (aircraftId != null ? getGroup(aircraftId) : 'default');
    }
    function createAircraftIconEl(NS, group, className) {
        const d = ICON_PATHS[group] || ICON_PATHS.default;
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', className || 'aircraft');
        return path;
    }
    function makeAircraftMarker(NS, group, className, scale) {
        const g = document.createElementNS(NS, 'g');
        g.setAttribute('class', 'aircraft-marker');
        const inner = document.createElementNS(NS, 'g');
        inner.setAttribute('transform', `translate(-20,-20) scale(${scale != null ? scale : 0.55})`);
        inner.appendChild(createAircraftIconEl(NS, group, className));
        g.appendChild(inner);
        return g;
    }

    let cachedTraffic = [];
    let lastTrafficFetch = 0;
    function readGeofsTraffic() {
        const mp = pageMultiplayer();
        if (!mp || !mp.users) return [];
        const out = [];
        try {
            for (const [userId, userData] of Object.entries(mp.users)) {
                if (!userData) continue;
                const coords = (userData.lastUpdate && userData.lastUpdate.co) || userData.referenceCoord;
                if (!coords || !Array.isArray(coords) || coords.length < 2) continue;
                const [lat, lon, alt = 0] = coords;
                let heading = 0, speed = null;
                try {
                    if (userData.lastUpdate) {
                        if (userData.lastUpdate.st != null) speed = userData.lastUpdate.st;
                        if (userData.lastUpdate.he != null) heading = userData.lastUpdate.he;
                    }
                    if (userData.heading != null) heading = userData.heading;
                    if (userData.speed != null) speed = userData.speed;
                } catch (e) {}
                const acId = userData.aircraft != null ? userData.aircraft : null;
                let acName = null;
                try {
                    const g = pageGeofs();
                    const list = g && g.aircraftList;
                    if (list && acId != null) {
                        const ent = list[acId] || list[String(acId)];
                        if (ent && ent.name) acName = ent.name;
                    }
                } catch (e) {}
                out.push({
                    id: userId,
                    callsign: userData.callsign || String(userId).slice(0, 6),
                    lat, lon, altitude: alt, heading: heading || 0, speed,
                    aircraftId: acId, aircraftName: acName,
                    group: resolveGroup(acId, acName)
                });
            }
        } catch (e) {}
        return out;
    }
    function refreshTraffic() {
        if (Date.now() - lastTrafficFetch < 1500) return cachedTraffic;
        lastTrafficFetch = Date.now();
        cachedTraffic = readGeofsTraffic();
        return cachedTraffic;
    }

    function detectRouteFromFlightPlan() {
        const icaos = [];
        try {
            const g = pageGeofs();
            const fp = g && ((g.nav && g.nav.flightPlan) || g.flightPlan);
            if (Array.isArray(fp)) {
                fp.forEach((p) => {
                    const ident = (p.ident || p.name || p.fix || '').toString().toUpperCase();
                    const alt = p.alt != null ? p.alt : (p.altitude != null ? p.altitude : p.elev);
                    if (/^[A-Z]{4}$/.test(ident) && (alt == null || Math.abs(Number(alt)) < 50)) icaos.push(ident);
                });
            }
        } catch (e) {}
        try {
            document.querySelectorAll('.geofs-waypointIdent').forEach((el) => {
                const name = (el.textContent || '').trim().toUpperCase().replace(/[0-9.,\s-]+$/, '');
                if (/^[A-Z]{4}$/.test(name)) icaos.push(name);
            });
        } catch (e) {}
        const seen = new Set(), uniq = [];
        icaos.forEach((c) => { if (!seen.has(c)) { seen.add(c); uniq.push(c); } });
        if (uniq.length >= 2) return { origin: uniq[0], dest: uniq[uniq.length - 1] };
        if (uniq.length === 1) return { origin: uniq[0], dest: '' };
        return null;
    }
    function syncRouteFromFlightPlan(force) {
        const det = detectRouteFromFlightPlan();
        if (!det) return false;
        if (force || !pilotRoute.origin) pilotRoute.origin = det.origin || pilotRoute.origin;
        if (force || !pilotRoute.dest) pilotRoute.dest = det.dest || pilotRoute.dest;
        gmSet(STORAGE.ROUTE_ORIGIN, pilotRoute.origin);
        gmSet(STORAGE.ROUTE_DEST, pilotRoute.dest);
        return true;
    }

    function formatRoutePair(origin, dest) {
        const o = origin ? String(origin).toUpperCase() : null;
        const d = dest ? String(dest).toUpperCase() : null;
        if (o && d) return o + '→' + d;
        if (o) return o + '→—';
        if (d) return '—→' + d;
        return 'No route';
    }
    function getDisplayCallsign(fallback) {
        const custom = (gmGet(STORAGE.CALLSIGN, '') || '').trim();
        if (custom) return custom;
        try {
            const mp = pageMultiplayer();
            if (mp && mp.myCallsign) return mp.myCallsign;
        } catch (e) {}
        try {
            if (typeof geofs !== 'undefined' && geofs.userRecord && geofs.userRecord.callsign)
                return geofs.userRecord.callsign;
        } catch (e) {}
        return fallback || 'You';
    }
    function buildTooltipLines(opts) {
        const lines = [];
        if (opts.callsign) lines.push(opts.callsign);
        lines.push(formatRoutePair(opts.origin, opts.dest));
        const spd = opts.speed != null && Number.isFinite(Number(opts.speed)) ? Math.round(opts.speed) + ' kt' : '— kt';
        const alt = opts.altitude != null && Number.isFinite(Number(opts.altitude)) ? Math.round(opts.altitude).toLocaleString() + ' ft' : '— ft';
        lines.push(spd + ' · ' + alt);
        if (opts.aircraftName) lines.push(opts.aircraftName);
        return lines.join('\n');
    }
    function showAcTooltip(e, text) {
        let tip = document.getElementById('rampradar-ac-tooltip');
        if (!tip) { tip = document.createElement('div'); tip.id = 'rampradar-ac-tooltip'; document.body.appendChild(tip); }
        tip.textContent = text || '';
        tip.style.display = text ? 'block' : 'none';
        moveAcTooltip(e);
    }
    function moveAcTooltip(e) {
        const tip = document.getElementById('rampradar-ac-tooltip');
        if (!tip || tip.style.display === 'none') return;
        const pad = 14;
        let left = e.clientX + pad, top = e.clientY + pad;
        const rect = tip.getBoundingClientRect();
        if (left + rect.width > window.innerWidth - 8) left = e.clientX - rect.width - pad;
        if (top + rect.height > window.innerHeight - 8) top = e.clientY - rect.height - pad;
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
    }
    function hideAcTooltip() {
        const tip = document.getElementById('rampradar-ac-tooltip');
        if (tip) tip.style.display = 'none';
    }

    function defaultChartLayers() { return { taxi: true, gates: true, legend: true, aircraft: true }; }
    function getChartLayers() {
        const v = gmGet(STORAGE.CHART_LAYERS, null);
        return Object.assign(defaultChartLayers(), v && typeof v === 'object' ? v : {});
    }
    function setChartLayer(key, on) {
        const layers = getChartLayers();
        layers[key] = !!on;
        gmSet(STORAGE.CHART_LAYERS, layers);
        applyChartLayers();
    }
    function getChartFollow() { return gmGet(STORAGE.CHART_FOLLOW, false) === true; }
    function setChartFollow(on) { gmSet(STORAGE.CHART_FOLLOW, !!on); }
    let followTargetId = null;
    function applyChartLayers() {
        if (!chartState) return;
        const L = getChartLayers();
        const map = { taxi: ['gTaxi', 'gTaxiLabels'], gates: ['gGates'], legend: ['legend'], aircraft: ['acEl', 'gOthers'] };
        Object.keys(map).forEach((k) => {
            map[k].forEach((ref) => {
                if (ref === 'legend') {
                    const el = panelEl && panelEl.querySelector('#rampradar-legend');
                    if (el) el.style.display = L[k] ? '' : 'none';
                    return;
                }
                const node = chartState[ref];
                if (node) node.style.display = L[k] ? '' : 'none';
            });
        });
    }

    const chartDataCache = {};
    const chartViewState = {};
    let chartLoadState = { status: 'idle', icao: null, error: null };
    let chartState = null;
    let activeIcao = gmGet(STORAGE.LAST_ICAO, '') || '';
    let pilotRoute = {
        origin: gmGet(STORAGE.ROUTE_ORIGIN, '') || '',
        dest: gmGet(STORAGE.ROUTE_DEST, '') || ''
    };
    let activeTab = 'charts';
    let airportsDb = null;

    async function loadChartData(icao) {
        if (Object.prototype.hasOwnProperty.call(chartDataCache, icao)) return chartDataCache[icao];
        try {
            const text = await gmFetchText(`${CHARTS_BASE_URL}/${icao}.json`);
            const json = JSON.parse(text);
            chartDataCache[icao] = json;
            return json;
        } catch (e) { chartDataCache[icao] = null; return null; }
    }
    const CHART_FREQ_ORDER = { ATIS: 0, CLD: 1, GND: 2, TWR: 3, APP: 4, DEP: 5, UNICOM: 6 };
    function normalizeFreqMhz(v) { return v > 200 ? Math.round((v / 10) * 1000) / 1000 : v; }

function buildChartSVG(container, data, icao) {
        container.innerHTML = '';
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('viewBox', '0 0 1000 700');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.setAttribute('id', 'rampradar-svg');
        container.appendChild(svg);
        function el(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
        const viewport = el('g', { id: 'chart-viewport' });
        svg.appendChild(viewport);
        const originLat = data.airport.lat, originLon = data.airport.lon;
        const R = 6371000;
        function toMeters(lat, lon) {
            const dLat = (lat - originLat) * Math.PI / 180, dLon = (lon - originLon) * Math.PI / 180;
            return [dLon * Math.cos(originLat * Math.PI / 180) * R, -dLat * R];
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        function extend(x, y) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
        data.runways.forEach((r) => r.ends.forEach((e) => { const [x, y] = toMeters(e.lat, e.lon); extend(x, y); }));
        data.pavements.forEach((p) => p.points.forEach((pt) => { const [x, y] = toMeters(pt.lat, pt.lon); extend(x, y); }));
        const VB_W = 1000, VB_H = 700, PAD = 40;
        const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
        const scale = Math.min((VB_W - 2 * PAD) / spanX, (VB_H - 2 * PAD) / spanY);
        const cx = (minX + maxX) / 2, cyc = (minY + maxY) / 2;
        function px(lat, lon) { const [x, y] = toMeters(lat, lon); return [(x - cx) * scale + VB_W / 2, (y - cyc) * scale + VB_H / 2]; }

        const gApron = el('g', {});
        function terminalKey(name) { if (!name) return null; const m = name.trim().match(/^(T\d+)\b/i); return m ? m[1].toUpperCase() : null; }
        function pointInPoly(x, y, pts) {
            let inside = false;
            for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
                const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
                const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                if (intersect) inside = !inside;
            }
            return inside;
        }
        const apronShapes = data.pavements.filter((p) => p.kind === 'apron' && p.closed).map((p) => ({ pts: p.points.map((pt) => px(pt.lat, pt.lon)), votes: {} }));
        (data.gates || []).forEach((g) => {
            const key = terminalKey(g.name);
            if (!key) return;
            const [gx, gy] = px(g.lat, g.lon);
            let match = apronShapes.find((a) => pointInPoly(gx, gy, a.pts));
            if (!match) {
                let best = null, bestD = Infinity;
                apronShapes.forEach((a) => {
                    const acx = a.pts.reduce((s, p) => s + p[0], 0) / a.pts.length, acy = a.pts.reduce((s, p) => s + p[1], 0) / a.pts.length;
                    const d = Math.hypot(acx - gx, acy - gy);
                    if (d < bestD) { bestD = d; best = a; }
                });
                if (best && bestD < 55) match = best;
            }
            if (match) match.votes[key] = (match.votes[key] || 0) + 1;
        });
        apronShapes.forEach((a) => {
            const entries = Object.entries(a.votes);
            const label = entries.length ? entries.sort((x, y) => y[1] - x[1])[0][0] : null;
            const pts = a.pts.map((p) => p.join(',')).join(' ');
            gApron.appendChild(el('polygon', { points: pts, class: label ? 'apron terminal' : 'apron' }));
            if (label) {
                const acx = a.pts.reduce((s, p) => s + p[0], 0) / a.pts.length;
                const topY = Math.min(...a.pts.map((p) => p[1]));
                const t = el('text', { x: acx, y: topY - 6, class: 'terminal-label', 'text-anchor': 'middle' });
                t.textContent = label;
                gApron.appendChild(t);
            }
        });
        viewport.appendChild(gApron);

        const gRwy = el('g', {}), gRwyLabels = el('g', {}), runwayPolys = [];
        // Shared collision registry: every label placed anywhere on the chart reserves
        // its box here, and every later label (taxi, then gate) is skipped if it would
        // land on top of something already placed. Runways go first (highest priority,
        // rarely crowded), then named taxiways, then LINK segments, then gate numbers —
        // so the numerous small gate labels are the ones that yield space, not the
        // taxiway names pilots actually need to read.
        const placedLabelRects = [];
        function estLabelWidth(text, fontSize) { return String(text).length * fontSize * 0.62 + 2; }
        function labelRect(cx, cy, text, fontSize) {
            const w = estLabelWidth(text, fontSize), h = fontSize * 1.25;
            return { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 };
        }
        function rectFree(rect, pad) {
            const p = pad == null ? 1.5 : pad;
            return !placedLabelRects.some((r) => !(rect.x2 + p < r.x1 || rect.x1 - p > r.x2 || rect.y2 + p < r.y1 || rect.y1 - p > r.y2));
        }
        data.runways.forEach((r) => {
            const [x1, y1] = px(r.ends[0].lat, r.ends[0].lon), [x2, y2] = px(r.ends[1].lat, r.ends[1].lon);
            const wPx = Math.max(r.width_m * scale, 5);
            const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
            const nx = -dy / len * wPx / 2, ny = dx / len * wPx / 2;
            const polyPts = [[x1 + nx, y1 + ny], [x2 + nx, y2 + ny], [x2 - nx, y2 - ny], [x1 - nx, y1 - ny]];
            runwayPolys.push(polyPts);
            gRwy.appendChild(el('polygon', { points: polyPts.map((p) => p.join(',')).join(' '), class: 'runway' }));
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const rot = angle > 90 || angle < -90 ? angle + 180 : angle;
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            const centerText = r.ends[0].id + ' / ' + r.ends[1].id;
            const centerLabel = el('text', { x: 0, y: 3, class: 'rwy-label', 'text-anchor': 'middle' });
            centerLabel.textContent = centerText;
            centerLabel.setAttribute('transform', `translate(${mx},${my}) rotate(${rot})`);
            gRwyLabels.appendChild(centerLabel);
            placedLabelRects.push(labelRect(mx, my, centerText, 14));
            [[x1, y1, dx, dy, r.ends[0].id], [x2, y2, -dx, -dy, r.ends[1].id]].forEach(([ex, ey, ddx, ddy, id]) => {
                const inLen = Math.hypot(ddx, ddy);
                const ix = ex + ddx / inLen * 22, iy = ey + ddy / inLen * 22;
                const eLabel = el('text', { x: 0, y: 3, class: 'rwy-label', 'text-anchor': 'middle' });
                eLabel.textContent = id;
                eLabel.setAttribute('transform', `translate(${ix},${iy}) rotate(${rot})`);
                gRwyLabels.appendChild(eLabel);
                placedLabelRects.push(labelRect(ix, iy, id, 14));
            });
        });
        viewport.appendChild(gRwy);

        const gTaxi = el('g', {}), gTaxiLabels = el('g', {});
        const nodes = data.taxi_network.nodes, groups = {};
        (data.taxi_network.edges || []).forEach((e) => {
            const a = nodes[e.n1], b = nodes[e.n2];
            if (!a || !b) return;
            const [x1, y1] = px(a.lat, a.lon), [x2, y2] = px(b.lat, b.lon);
            const isLinkEdge = /^link\d*$/i.test((e.name || '').trim());
            gTaxi.appendChild(el('line', { x1, y1, x2, y2, class: isLinkEdge ? 'taxi-line taxi-link' : 'taxi-line taxi-named' }));
            (groups[e.name] = groups[e.name] || []).push({ x1, y1, x2, y2 });
        });
        viewport.appendChild(gTaxi);
        function pointInAnyRunway(x, y) {
            for (const pts of runwayPolys) {
                let inside = false;
                for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
                    const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
                    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
                    if (intersect) inside = !inside;
                }
                if (inside) return true;
            }
            return false;
        }
        // Named taxiways only — hide LINK* designators (clutter). Max 2 labels per name.
        const MIN_LABEL_SEP = 150;
        const groupNames = Object.keys(groups).filter((n) => !/^link\d*$/i.test((n || '').trim()))
            .sort((a, b) => String(a).length - String(b).length);
        groupNames.forEach((name) => {
            const fontSize = 8;
            const candidates = (groups[name] || []).map((seg) => {
                const mx = (seg.x1 + seg.x2) / 2, my = (seg.y1 + seg.y2) / 2;
                const len = Math.hypot(seg.x2 - seg.x1, seg.y2 - seg.y1);
                return { mx, my, len };
            }).filter((c) => !pointInAnyRunway(c.mx, c.my))
              .sort((a, b) => b.len - a.len);
            const picked = [];
            for (const c of candidates) {
                if (picked.length >= 2) break;
                if (picked.some((p) => Math.hypot(p.mx - c.mx, p.my - c.my) < MIN_LABEL_SEP)) continue;
                const rect = labelRect(c.mx, c.my, name, fontSize);
                if (!rectFree(rect)) continue;
                const tw = Math.max(10, String(name).length * 4.6);
                const th = 10;
                const bg = el('rect', {
                    x: c.mx - tw / 2 - 2, y: c.my - th / 2 - 0.5, width: tw + 4, height: th + 1, rx: 2, ry: 2,
                    class: 'taxi-badge'
                });
                gTaxiLabels.appendChild(bg);
                const t = el('text', { x: c.mx, y: c.my + 3, class: 'taxi-label taxi-label-named', 'text-anchor': 'middle' });
                t.textContent = name;
                gTaxiLabels.appendChild(t);
                placedLabelRects.push(rect);
                picked.push(c);
            }
        });
        viewport.appendChild(gTaxiLabels);
        viewport.appendChild(gRwyLabels);

        const gGates = el('g', {});
        function shortGateLabel(name) { if (!name) return ''; const parts = name.trim().split(/\s+/); return parts[parts.length - 1]; }
        // Show more gates: tighter spacing, always draw tick; labels when space allows
        const GATE_LABEL_SPACING = 12, GATE_TICK_SPACING = 4, placedGateLabels = [], placedGateTicks = [];
        (data.gates || []).forEach((g) => {
            const [x, y] = px(g.lat, g.lon);
            const tickTooClose = placedGateTicks.some((p) => Math.hypot(p[0] - x, p[1] - y) < GATE_TICK_SPACING);
            if (tickTooClose) return;
            placedGateTicks.push([x, y]);
            const tick = el('line', { x1: x, y1: y - 2.5, x2: x, y2: y + 2.5, class: 'gate-tick' });
            const title = el('title', {});
            title.textContent = (g.name || 'Gate') + (g.airline_code ? ' · ' + String(g.airline_code).toUpperCase() : '');
            tick.appendChild(title);
            gGates.appendChild(tick);
            const gateText = shortGateLabel(g.name);
            if (!gateText) return;
            const tooCloseToGate = placedGateLabels.some((p) => Math.hypot(p[0] - x, p[1] - y) < GATE_LABEL_SPACING);
            const rect = labelRect(x + 3 + estLabelWidth(gateText, 7.5) / 2, y + 2, gateText, 7.5);
            // Prefer showing gate numbers even if slightly near taxi labels
            if (!tooCloseToGate) {
                const t = el('text', { x: x + 3, y: y + 2.5, class: 'gate-label' });
                t.textContent = gateText;
                gGates.appendChild(t);
                placedGateLabels.push([x, y]);
                placedLabelRects.push(rect);
            }
        });
        viewport.appendChild(gGates);

        const det0 = detectCurrentAircraft();
        const ownGroup0 = det0 ? det0.group : 'default';
        const acEl = makeAircraftMarker(NS, ownGroup0, 'aircraft', 0.6);
        acEl.setAttribute('class', 'aircraft-marker own');
        viewport.appendChild(acEl);
        const gOthers = el('g', { id: 'chart-other-aircraft' });
        viewport.appendChild(gOthers);
        

        const freqByType = {};
        (data.frequencies || []).forEach((f) => {
            const mhz = normalizeFreqMhz(f.freq_mhz), key = f.label || f.type;
            if (!freqByType[key] || freqByType[key] > mhz) freqByType[key] = mhz;
        });
        const freqRows = Object.keys(freqByType).map((label) => ({ label, mhz: freqByType[label], order: CHART_FREQ_ORDER[(data.frequencies.find((f) => (f.label || f.type) === label) || {}).type] ?? 9 })).sort((a, b) => a.order - b.order);

        const savedView = icao ? chartViewState[icao] : null;
        let zoom = savedView ? savedView.zoom : 1, panX = savedView ? savedView.panX : 0, panY = savedView ? savedView.panY : 0;
        function applyTransform() {
            viewport.setAttribute('transform', `translate(${panX},${panY}) scale(${zoom})`);
            if (icao) chartViewState[icao] = { zoom, panX, panY };
        }
        applyTransform(); // apply the restored view immediately, don't wait for the first zoom/pan action
        function onWheel(e) { e.preventDefault(); e.stopPropagation(); const factor = e.deltaY > 0 ? 0.9 : 1.1; zoom = Math.min(6, Math.max(0.5, zoom * factor)); applyTransform(); }
        let dragging = false, lastX = 0, lastY = 0;
        function onDown(e) { dragging = true; lastX = e.clientX; lastY = e.clientY; }
        function onMove(e) { if (!dragging) return; panX += e.clientX - lastX; panY += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; applyTransform(); }
        function onUp() { dragging = false; }
        if (container.__rampradarPanCleanup) container.__rampradarPanCleanup();
        container.addEventListener('wheel', onWheel, { passive: false });
        container.addEventListener('mousedown', onDown);
        container.addEventListener('mousemove', onMove);
        container.addEventListener('mouseup', onUp);
        container.addEventListener('mouseleave', onUp);
        container.__rampradarPanCleanup = () => {
            container.removeEventListener('wheel', onWheel);
            container.removeEventListener('mousedown', onDown);
            container.removeEventListener('mousemove', onMove);
            container.removeEventListener('mouseup', onUp);
            container.removeEventListener('mouseleave', onUp);
        };
        const out = { svg, px, acEl, gOthers, gTaxi, gTaxiLabels, gGates, freqRows, _ownGroup: ownGroup0 };
        setTimeout(applyChartLayers, 0);
        return out;
    }
    

    
    function renderChartLegend(legendEl, freqRows) {
        if (!legendEl) return;
        const swatches = `
            <div><span class="chart-sw" style="background:#213a56"></span>Apron</div>
            <div><span class="chart-sw" style="background:#0a1420;border:1px solid #dfe6ee"></span>Runway</div>
            <div><span class="chart-sw" style="background:#c9a227"></span>Taxiway (yellow)</div>
            <div><span class="chart-sw" style="background:#e9b8f2"></span>Gate</div>
            <div><span class="chart-sw" style="background:#22d3ee"></span>You (cyan)</div>
            <div><span class="chart-sw" style="background:#f472b6"></span>Traffic (pink)</div>`;
        const freqHtml = freqRows.length ? `<div class="chart-legend-freqs">${freqRows.map((r) => `<div><span class="chart-freq-label">${escapeHtml(r.label)}</span><span class="chart-freq-val">${r.mhz.toFixed(3)}</span></div>`).join('')}</div>` : '';
        legendEl.innerHTML = swatches + freqHtml;
    }

    function updateChartAircraft() {
        if (!chartState) return;
        const pos = getCurrentLatLon();
        if (!pos) return;
        const heading = getCurrentHeading() || 0;
        const [x, y] = chartState.px(pos.lat, pos.lon);
        const layers = getChartLayers();
        const within = x > -300 && x < 1300 && y > -300 && y < 1000;
        const det = detectCurrentAircraft();
        const group = det ? det.group : 'default';
        if (chartState.acEl) {
            chartState.acEl.style.display = (layers.aircraft && within) ? '' : 'none';
            chartState.acEl.setAttribute('transform', `translate(${x},${y}) rotate(${heading})`);
            if (chartState._ownGroup !== group) {
                chartState._ownGroup = group;
                const NS = 'http://www.w3.org/2000/svg';
                chartState.acEl.innerHTML = '';
                const inner = document.createElementNS(NS, 'g');
                inner.setAttribute('transform', 'translate(-20,-20) scale(0.6)');
                inner.appendChild(createAircraftIconEl(NS, group, 'aircraft'));
                chartState.acEl.appendChild(inner);
            }
        }
        if (getChartFollow() && chartState.svg && within && !followTargetId) {
            try {
                const icao = activeIcao || null;
                const view = icao ? (chartViewState[icao] || { zoom: 1, panX: 0, panY: 0 }) : { zoom: 1, panX: 0, panY: 0 };
                const zoom = view.zoom || 1;
                view.panX = view.panX * 0.7 + (500 - x * zoom) * 0.3;
                view.panY = view.panY * 0.7 + (350 - y * zoom) * 0.3;
                if (icao) chartViewState[icao] = view;
                const vp = chartState.svg.querySelector('#chart-viewport');
                if (vp) vp.setAttribute('transform', `translate(${view.panX},${view.panY}) scale(${zoom})`);
            } catch (e) {}
        }
        applyChartLayers();
    }

    function updateChartOtherAircraft() {
        if (!chartState || !chartState.gOthers) return;
        const NS = 'http://www.w3.org/2000/svg';
        chartState.gOthers.innerHTML = '';
        const layers = getChartLayers();
        if (layers.aircraft === false) return;
        refreshTraffic().forEach((u) => {
            const [x, y] = chartState.px(u.lat, u.lon);
            if (x <= -300 || x >= 1300 || y <= -300 || y >= 1000) return;
            const g = makeAircraftMarker(NS, u.group || 'default', 'other-aircraft', 0.5);
            g.setAttribute('transform', `translate(${x},${y}) rotate(${u.heading || 0})`);
            if (followTargetId === u.id) g.classList.add('focused');
            const tipText = buildTooltipLines({
                callsign: u.callsign, origin: null, dest: null,
                speed: u.speed, altitude: u.altitude, aircraftName: u.aircraftName
            });
            g.style.cursor = 'pointer';
            g.addEventListener('mouseenter', (e) => showAcTooltip(e, tipText));
            g.addEventListener('mousemove', (e) => moveAcTooltip(e));
            g.addEventListener('mouseleave', () => { if (followTargetId !== u.id) hideAcTooltip(); });
            g.addEventListener('click', (e) => {
                e.stopPropagation();
                if (followTargetId === u.id) {
                    followTargetId = null;
                    hideAcTooltip();
                } else {
                    followTargetId = u.id;
                    setChartFollow(true);
                    showAcTooltip(e, tipText + '\n[FOCUSED — click again to release]');
                }
                updateChartOtherAircraft();
            });
            chartState.gOthers.appendChild(g);
            if (getChartFollow() && followTargetId === u.id) {
                try {
                    const icao = activeIcao || null;
                    const view = icao ? (chartViewState[icao] || { zoom: 1, panX: 0, panY: 0 }) : { zoom: 1, panX: 0, panY: 0 };
                    const zoom = view.zoom || 1;
                    view.panX = view.panX * 0.7 + (500 - x * zoom) * 0.3;
                    view.panY = view.panY * 0.7 + (350 - y * zoom) * 0.3;
                    if (icao) chartViewState[icao] = view;
                    const vp = chartState.svg.querySelector('#chart-viewport');
                    if (vp) vp.setAttribute('transform', `translate(${view.panX},${view.panY}) scale(${zoom})`);
                } catch (e) {}
            }
        });
    }

    function bindOwnHover() {
        if (!chartState || !chartState.acEl) return;
        const el = chartState.acEl;
        el.style.cursor = 'default';
        el.onmouseenter = (e) => {
            const det = detectCurrentAircraft();
            showAcTooltip(e, buildTooltipLines({
                callsign: getDisplayCallsign('You'),
                origin: pilotRoute.origin, dest: pilotRoute.dest,
                speed: getCurrentGroundSpeedKts(), altitude: getCurrentAltitudeFt(),
                aircraftName: det ? det.name : null
            }));
        };
        el.onmousemove = (e) => moveAcTooltip(e);
        el.onmouseleave = () => hideAcTooltip();
    }

    function haversineNM(lat1, lon1, lat2, lon2) {
        const R = 3440.065, toRad = (d) => (d * Math.PI) / 180;
        const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(a));
    }
    async function ensureAirportsDb() {
        if (airportsDb) return airportsDb;
        try {
            airportsDb = JSON.parse(await gmFetchText(AIRPORTS_URL, 25000));
        } catch (e) {
            airportsDb = {};
        }
        return airportsDb;
    }
    function lookupAirport(icao) {
        if (!icao || !airportsDb) return null;
        const a = airportsDb[icao] || airportsDb[String(icao).toUpperCase()];
        if (!a) return null;
        return {
            icao: a.icao || icao,
            iata: a.iata || '',
            name: a.name || '',
            city: a.city || '',
            country: a.country || '',
            lat: a.lat,
            lon: a.lon
        };
    }
    function airportLabel(icao) {
        const a = lookupAirport(icao);
        if (!a) return '';
        const bits = [a.name];
        if (a.city) bits.push(a.city);
        if (a.country) bits.push(a.country);
        return bits.filter(Boolean).join(' · ');
    }
    async function findNearestAirportIcao() {
        const pos = getCurrentLatLon();
        if (!pos) return null;
        await ensureAirportsDb();
        let best = null, bestD = Infinity;
        for (const icao in airportsDb) {
            const a = airportsDb[icao];
            if (!a || a.lat == null || a.lon == null) continue;
            // Prefer real ICAO-looking keys
            if (!/^[A-Z0-9]{4}$/.test(icao)) continue;
            const d = haversineNM(pos.lat, pos.lon, a.lat, a.lon);
            if (d < bestD) { bestD = d; best = icao; }
        }
        return best ? { icao: best, nm: bestD, apt: lookupAirport(best) } : null;
    }
    function getBookmarks() { return gmGet(STORAGE.BOOKMARKS, []) || []; }
    function setBookmarks(list) { gmSet(STORAGE.BOOKMARKS, list); }
    function toggleBookmark(icao) {
        icao = (icao || '').toUpperCase();
        if (!/^[A-Z]{4}$/.test(icao)) return;
        let list = getBookmarks();
        if (list.includes(icao)) list = list.filter((x) => x !== icao);
        else list.unshift(icao);
        if (list.length > 40) list.length = 40;
        setBookmarks(list);
    }

    const metarMemCache = {}, atisMemCache = {};
    async function fetchMetarRaw(icao) {
        const cached = metarMemCache[icao];
        if (cached && (Date.now() - cached.ts < METAR_CACHE_MS)) return cached.result;
        let result;
        try {
            const text = await gmFetchText('https://aviationweather.gov/api/data/metar?ids=' + encodeURIComponent(icao) + '&format=raw', 10000);
            const raw = (text || '').trim().split('\n')[0];
            if (!raw) throw new Error('empty');
            result = { raw };
        } catch (e1) {
            try {
                const text = await gmFetchText('https://metar.vatsim.net/' + icao, 8000);
                const raw = (text || '').trim();
                if (!raw || raw.toLowerCase().includes('not found')) throw new Error('empty');
                result = { raw };
            } catch (e2) {
                result = { error: 'No METAR available for ' + icao };
            }
        }
        metarMemCache[icao] = { ts: Date.now(), result };
        return result;
    }
    function decodeMetarSummary(raw) {
        if (!raw) return null;
        const parts = raw.split(/\s+/);
        const timeTok = parts.find((p) => /^\d{6}Z$/.test(p));
        const time = timeTok ? timeTok.slice(2, 4) + ':' + timeTok.slice(4, 6) + 'Z' : '—';
        const windTok = parts.find((p) => /^(\d{3}|VRB)\d{2,3}(G\d{2,3})?KT$/.test(p));
        let wind = 'calm';
        if (windTok) {
            const m = windTok.match(/^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?KT$/);
            if (m) wind = (m[1] === 'VRB' ? 'variable' : m[1] + '°') + ' at ' + parseInt(m[2], 10) + ' kt' + (m[4] ? ' G' + parseInt(m[4], 10) : '');
        }
        const visTok = parts.find((p) => /^(\d{4}|P?\d{1,2}SM|CAVOK)$/.test(p));
        let vis = visTok || '—';
        if (visTok === 'CAVOK') vis = 'CAVOK';
        else if (/^\d{4}$/.test(visTok || '')) vis = visTok + ' m';
        const tempTok = parts.find((p) => /^M?\d{2}\/M?\d{2}$/.test(p));
        let temp = '—', dew = '—';
        if (tempTok) {
            const [t, d] = tempTok.split('/');
            temp = (t.startsWith('M') ? '-' + t.slice(1) : t) + '°C';
            dew = (d.startsWith('M') ? '-' + d.slice(1) : d) + '°C';
        }
        const qnhTok = parts.find((p) => /^Q\d{4}$/.test(p)) || parts.find((p) => /^A\d{4}$/.test(p));
        let qnh = '—';
        if (qnhTok) qnh = qnhTok.startsWith('Q') ? qnhTok.slice(1) + ' hPa' : (parseInt(qnhTok.slice(1), 10) / 100).toFixed(2) + ' inHg';
        const cloudToks = parts.filter((p) => /^(FEW|SCT|BKN|OVC|VV)\d{3}/.test(p));
        const clouds = cloudToks.length ? cloudToks.map((c) => c.slice(0, 3) + ' ' + parseInt(c.slice(3, 6), 10) * 100 + 'ft').join(', ') : 'sky clear';
        return { time, wind, vis, temp, dew, qnh, clouds };
    }
    async function fetchDigitalAtis(icao) {
        const cached = atisMemCache[icao];
        if (cached && (Date.now() - cached.ts < ATIS_CACHE_MS)) return cached.result;
        let result;
        try {
            // Real digital ATIS where available (mainly US via DATIS)
            const text = await gmFetchText('https://datis.clowd.io/api/' + encodeURIComponent(icao), 10000);
            const json = JSON.parse(text);
            const arr = Array.isArray(json) ? json : [json];
            if (!arr.length || !arr[0].datis) throw new Error('empty');
            result = {
                source: 'datis',
                items: arr.map((x) => ({
                    type: x.type || 'atis',
                    code: x.code || '',
                    text: x.datis || '',
                    time: x.time || ''
                }))
            };
        } catch (e) {
            // No free worldwide ATIS API — fall back to decoded METAR (clearly labeled)
            result = { source: 'none', error: 'No digital ATIS (DATIS is mainly US). Showing decoded METAR instead.' };
        }
        atisMemCache[icao] = { ts: Date.now(), result };
        return result;
    }

    // ---- version check (Tools tab) ----
    let remoteVersion = null;
    let remoteChangelogText = null;
    let versionCheckDone = false;
    function versionParts(v) {
        return String(v || '0').split('.').map((n) => parseInt(n, 10) || 0);
    }
    function isUpdateAvailable() {
        if (!remoteVersion) return false;
        const a = versionParts(SCRIPT_VERSION), b = versionParts(remoteVersion);
        for (let i = 0; i < Math.max(a.length, b.length); i++) {
            const x = a[i] || 0, y = b[i] || 0;
            if (y > x) return true;
            if (y < x) return false;
        }
        return false;
    }
    function changelogBulletsFor(version) {
        if (!version) return [];
        if (remoteChangelogText && typeof remoteChangelogText === 'object' && Array.isArray(remoteChangelogText[version])) {
            return remoteChangelogText[version];
        }
        if (remoteChangelogText && typeof remoteChangelogText === 'string') {
            const re = new RegExp('##\\s*v?' + version.replace(/\\./g, '\\.') + '\\b([\\s\\S]*?)(?=\\n##\\s|$)', 'i');
            const m = remoteChangelogText.match(re);
            if (m) {
                return m[1].split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim()).filter((l) => l && !l.startsWith('#'));
            }
        }
        return SCRIPT_CHANGELOG[version] || [];
    }
    async function checkForUpdate() {
        if (versionCheckDone) return;
        versionCheckDone = true;
        try {
            const textBody = await gmFetchText(VERSION_CHECK_URL + '?t=' + Date.now(), 8000);
            const m = textBody.match(/@version\s+([0-9]+(?:\.[0-9]+)*)/);
            if (m) remoteVersion = m[1];
            const cl = textBody.match(/const SCRIPT_CHANGELOG\s*=\s*(\{[\s\S]*?\n\s*\});/);
            if (cl) {
                try { remoteChangelogText = (new Function('return ' + cl[1]))(); } catch (e2) { remoteChangelogText = null; }
            }
        } catch (e) {
            remoteVersion = null;
        }
        try {
            if (!remoteChangelogText) {
                const md = await gmFetchText(CHANGELOG_URL + '?t=' + Date.now(), 8000);
                remoteChangelogText = md;
            }
        } catch (e) { /* optional */ }
        if (panelOpen && !minimized && activeTab === 'tools') renderBody();
    }

    function getOpenShortcut() {
        const v = gmGet(STORAGE.OPEN_SHORTCUT, null);
        if (!v || typeof v !== 'object' || !v.key) return null;
        return { ctrl: !!v.ctrl, alt: !!v.alt, shift: !!v.shift, meta: !!v.meta, key: String(v.key) };
    }
    function setOpenShortcut(spec) {
        if (!spec || !spec.key) gmSet(STORAGE.OPEN_SHORTCUT, null);
        else gmSet(STORAGE.OPEN_SHORTCUT, { ctrl: !!spec.ctrl, alt: !!spec.alt, shift: !!spec.shift, meta: !!spec.meta, key: String(spec.key) });
    }
    function formatShortcut(spec) {
        if (!spec || !spec.key) return 'None';
        const parts = [];
        if (spec.ctrl) parts.push('Ctrl');
        if (spec.alt) parts.push('Alt');
        if (spec.shift) parts.push('Shift');
        if (spec.meta) parts.push('Meta');
        parts.push(spec.key === ' ' ? 'Space' : (spec.key.length === 1 ? spec.key.toUpperCase() : spec.key));
        return parts.join('+');
    }
    function eventMatchesShortcut(e, spec) {
        if (!spec || !spec.key) return false;
        if (!!e.ctrlKey !== !!spec.ctrl || !!e.altKey !== !!spec.alt || !!e.shiftKey !== !!spec.shift || !!e.metaKey !== !!spec.meta) return false;
        const ek = e.key, sk = spec.key;
        if (sk === ' ' || sk === 'Space') return ek === ' ';
        if (sk.length === 1 && ek.length === 1) return ek.toLowerCase() === sk.toLowerCase();
        return ek === sk;
    }
    function isTypingTarget(el) {
        if (!el) return false;
        const tag = (el.tagName || '').toUpperCase();
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }
    let shortcutCaptureMode = false;
    function onGlobalShortcutKeydown(e) {
        if (shortcutCaptureMode || isTypingTarget(document.activeElement)) return;
        const spec = getOpenShortcut();
        if (!eventMatchesShortcut(e, spec)) return;
        e.preventDefault(); e.stopPropagation();
        if (!panelOpen) openPanel();
        else if (minimized) restore();
        else closePanel();
    }
    function installOpenShortcutListener() {
        if (installOpenShortcutListener._done) return;
        installOpenShortcutListener._done = true;
        document.addEventListener('keydown', onGlobalShortcutKeydown, true);
    }

    let panelOpen = false, minimized = false, panelEl = null, backdropEl = null, dragAbort = null;
    const MINI_SIZES = [{ w: 320, h: 240 }, { w: 400, h: 300 }, { w: 480, h: 340 }];
    let miniSizeIndex = 1;

    function injectStyles() {
        if (document.getElementById('rampradar-styles')) return;
        const style = document.createElement('style');
        style.id = 'rampradar-styles';
        style.textContent = `
            #rampradar-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.35); z-index: 99998; }
            #rampradar-panel {
                position: fixed; z-index: 99999; top: 50%; left: 50%; transform: translate(-50%,-50%);
                width: min(960px, 96vw); height: min(680px, 92vh);
                background: #0b1622; color: #eef2f7; border-radius: 16px;
                box-shadow: 0 24px 80px rgba(0,0,0,0.65); border: 1px solid #1e3552;
                display: flex; flex-direction: column; overflow: hidden;
                font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
            }
            #rampradar-panel.is-max { width: min(98vw, 1400px); height: min(96vh, 900px); }
            #rampradar-panel.is-mini {
                width: 400px; height: 300px; border-radius: 14px; transform: none;
                box-shadow: 0 14px 40px rgba(0,0,0,0.55);
            }
            #rampradar-panel.is-mini #rampradar-tabs,
            #rampradar-panel.is-mini .rr-full-only { display: none !important; }
            #rampradar-topbar {
                display: flex; align-items: center; gap: 8px; padding: 8px 10px;
                background: #0e2138; border-bottom: 1px solid #1e3552; cursor: move; flex-shrink: 0;
            }
            #rampradar-topbar .title { font-weight: 800; letter-spacing: 1px; font-size: 12px; color: #22d3ee; flex-shrink: 0; }
            #rampradar-topbar .icao-tag { font-family: Consolas, monospace; font-size: 11px; color: #8397ae; flex-shrink: 0; }
            #rampradar-topbar .rr-clock { font-family: Consolas, monospace; font-size: 11px; color: #cfe0ee; margin-left: 4px; }
            #rampradar-topbar .spacer { flex: 1; min-width: 6px; }
            #rampradar-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
            #rampradar-tabs button {
                background: #16304e; border: 1px solid #24405f; color: #9fb3c8; border-radius: 6px;
                padding: 4px 8px; font-weight: 800; font-size: 9.5px; letter-spacing: 0.4px; cursor: pointer;
            }
            #rampradar-tabs button.active { background: linear-gradient(180deg,#5eead4,#22d3ee); color: #052024; border-color: transparent; }
            #rampradar-topbar .icon-btn {
                background: #16304e; border: 1px solid #24405f; color: #cfe0ee; border-radius: 8px;
                width: 28px; height: 26px; cursor: pointer; font-size: 12px; flex-shrink: 0;
            }
            #rampradar-topbar .icon-btn:hover, #rampradar-tabs button:hover { border-color: #22d3ee; color: #22d3ee; }
            #rampradar-body { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 10px 12px 12px; overflow-y: auto; overflow-x: hidden; }
            #rampradar-panel.is-mini #rampradar-body { padding: 6px 8px 8px; overflow: hidden; }
            /* Charts tab keeps internal chart scroll; weather/bookmarks/tools use body scroll */
            #rampradar-body.rr-scroll { overflow-y: auto; }
            #rampradar-body.rr-charts-mode { overflow: hidden; }
            #rampradar-tools { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin-bottom: 8px; flex-shrink: 0; }
            #rampradar-tools .mode-btn {
                background: #0e2138; border: 1px solid #1e3552; color: #6f85a0; border-radius: 6px;
                padding: 5px 10px; font-size: 10px; font-weight: 800; letter-spacing: 0.4px; cursor: pointer;
            }
            #rampradar-tools .mode-btn.active { background: linear-gradient(180deg,#5eead4,#22d3ee); color: #052024; border-color: transparent; }
            #rampradar-tools label.layer-toggle {
                display: inline-flex; align-items: center; gap: 4px; cursor: pointer; user-select: none;
                font-size: 10px; font-weight: 700; color: #6f85a0;
            }
            #rampradar-tools input { accent-color: #22d3ee; }
            #rampradar-search-row { display: flex; gap: 6px; margin-bottom: 8px; flex-shrink: 0; align-items: center; flex-wrap: wrap; }
            #rampradar-search-row input {
                background: #081527; border: 1px solid #1e3552; color: #eef2f7;
                border-radius: 8px; padding: 7px 9px; font-size: 12px; font-family: Consolas, monospace; text-transform: uppercase;
            }
            #rampradar-search-row input#rampradar-icao-input { width: 88px; }
            #rampradar-search-row input#rr-callsign { width: 100px; text-transform: none; }
            #rampradar-search-row .route-chip {
                background: #16304e; border: 1px solid #24405f; color: #22d3ee; border-radius: 6px;
                padding: 6px 10px; font-weight: 800; font-size: 11px; font-family: Consolas, monospace; cursor: pointer;
            }
            #rampradar-search-row .route-chip:hover { border-color: #22d3ee; }
            #rampradar-search-row .route-chip.empty { color: #5c7089; border-style: dashed; }
            #rampradar-search-row button {
                background: #16304e; border: 1px solid #24405f; color: #cfe0ee; border-radius: 8px;
                padding: 0 12px; height: 32px; font-weight: 800; font-size: 11px; cursor: pointer;
            }
            #rampradar-status { font-size: 11px; color: #8397ae; margin-bottom: 6px; display: none; flex-shrink: 0; }
            #rampradar-status .warn { color: #e0955c; }
            #rampradar-status a { color: #22d3ee; }
            .rampradar-chart-wrap { position: relative; flex: 1; min-height: 0; border: 1px solid #1e3552; border-radius: 12px; overflow: hidden; background: #0a1420; }
            #rampradar-canvas { position: absolute; inset: 0; width: 100%; height: 100%; background: #0b1524; }
            #rampradar-canvas svg { width: 100%; height: 100%; display: block; }
            #rampradar-canvas .apron { fill: #1a334d; stroke: #2a4a68; stroke-width: 0.6; }
            #rampradar-canvas .apron.terminal { fill: #243f5c; stroke: #3a5a7a; }
            #rampradar-canvas .terminal-label { fill: #d6e6f4; font-size: 11px; font-weight: 800; }
            #rampradar-canvas .runway { fill: #2a3038; stroke: #e8eef4; stroke-width: 1.4; }
            #rampradar-canvas .rwy-label { fill: #ffffff; font-size: 13px; font-weight: 800; }
            #rampradar-canvas .taxi-line { stroke-linecap: round; stroke-linejoin: round; }
            #rampradar-canvas .taxi-named { stroke: #c9a227; stroke-width: 5.5; opacity: 0.95; }
            #rampradar-canvas .taxi-link { stroke: #8a9a6a; stroke-width: 3.2; opacity: 0.75; }
            #rampradar-canvas .taxi-badge { fill: #1a1a1a; stroke: #e8c84a; stroke-width: 1; }
            #rampradar-canvas .taxi-badge-link { fill: #152030; stroke: #4a6280; stroke-width: 0.8; }
            #rampradar-canvas .taxi-label { font-weight: 800; pointer-events: none; }
            #rampradar-canvas .taxi-label-named { fill: #f5e6a0; font-size: 8.5px; }
            #rampradar-canvas .taxi-label-link { fill: #9ab0c8; font-size: 9px; font-weight: 700; }
            #rampradar-canvas .gate-tick { stroke: #c084fc; stroke-width: 1.8; }
            #rampradar-canvas .gate-label { fill: #e9d5ff; font-size: 7.5px; font-weight: 700; }
            #rampradar-canvas .aircraft { fill: #22d3ee; stroke: #052024; stroke-width: 0.9; }
            #rampradar-canvas .other-aircraft { fill: #f472b6; stroke: #052024; stroke-width: 0.9; opacity: 0.95; }
            #rampradar-canvas .aircraft-marker.focused .other-aircraft { fill: #fbbf24; }
            #rampradar-legend {
                position: absolute; left: 10px; top: 10px; background: rgba(5,10,18,0.82);
                border: 1px solid #1e3552; border-radius: 8px; padding: 9px 11px; font-size: 10px;
                color: #cfe0ee; display: flex; flex-direction: column; gap: 4px; max-width: 150px; z-index: 2;
            }
            #rampradar-panel.is-mini #rampradar-legend { display: none !important; }
            #rampradar-legend > div { display: flex; align-items: center; gap: 7px; }
            .chart-sw { width: 11px; height: 11px; border-radius: 3px; flex-shrink: 0; display: inline-block; }
            .chart-legend-freqs { border-top: 1px solid #1e3552; margin-top: 4px; padding-top: 6px; display: flex; flex-direction: column; gap: 3px; }
            .chart-legend-freqs > div { display: flex; justify-content: space-between; gap: 10px; }
            .chart-freq-label { color: #8397ae; font-weight: 700; }
            .chart-freq-val { color: #22d3ee; font-family: Consolas, monospace; }
            #rampradar-resize { position: absolute; right: 2px; bottom: 2px; width: 16px; height: 16px; cursor: nwse-resize; z-index: 3; }
            #rampradar-resize::after {
                content: ''; position: absolute; right: 3px; bottom: 3px; width: 10px; height: 10px;
                border-right: 2px solid #3d5675; border-bottom: 2px solid #3d5675;
            }
            #rampradar-ac-tooltip {
                position: fixed; z-index: 100000; display: none; pointer-events: none;
                background: rgba(5,12,22,0.94); border: 1px solid #2a4a68; border-radius: 8px;
                padding: 8px 10px; color: #eef2f7; font-size: 11px; line-height: 1.45;
                font-family: Consolas, ui-monospace, monospace; white-space: pre; max-width: 280px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.45);
            }
            .rr-card { background: #0e2138; border: 1px solid #1e3552; border-radius: 10px; padding: 12px; margin-bottom: 10px; }
            .rr-label { font-size: 10px; font-weight: 800; letter-spacing: 0.6px; color: #6f85a0; margin-bottom: 6px; }
            .rr-row { display: flex; justify-content: space-between; gap: 10px; font-size: 12px; padding: 3px 0; }
            .rr-muted { color: #8397ae; font-size: 11px; line-height: 1.5; }
            .rr-bm-grid { display: flex; flex-wrap: wrap; gap: 8px; }
            .rr-bm-grid button {
                background: #16304e; border: 1px solid #24405f; color: #cfe0ee; border-radius: 8px;
                padding: 10px 14px; font-size: 13px; cursor: pointer; font-family: Consolas, monospace; font-weight: 800;
            }
            .rr-bm-grid button:hover { border-color: #22d3ee; color: #22d3ee; }
            .rr-atis { font-family: Consolas, monospace; font-size: 11px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; color: #dbe6f0; }
        `;
        document.head.appendChild(style);
    }

    function loadChartForIcao(icao) {
        icao = (icao || '').trim().toUpperCase();
        if (!/^[A-Z]{4}$/.test(icao)) {
            chartLoadState = { status: 'none', icao: null, error: null };
            updateStatus();
            return;
        }
        activeIcao = icao;
        gmSet(STORAGE.LAST_ICAO, icao);
        chartLoadState = { status: 'loading', icao, error: null };
        updateStatus();
        const tag = panelEl && panelEl.querySelector('.icao-tag');
        if (tag) tag.textContent = icao;
        loadChartData(icao).then((data) => {
            if (activeIcao !== icao) return;
            const canvas = panelEl && panelEl.querySelector('#rampradar-canvas');
            const legendEl = panelEl && panelEl.querySelector('#rampradar-legend');
            if (!canvas) return;
            if (!data) {
                chartLoadState = { status: 'missing', icao, error: null };
                canvas.innerHTML = '';
                if (legendEl) legendEl.innerHTML = '';
                chartState = null;
                updateStatus();
                return;
            }
            chartLoadState = { status: 'ready', icao, error: null };
            updateStatus();
            const built = buildChartSVG(canvas, data, icao);
            chartState = built;
            // Force cyan class on own icon
            try {
                const path = chartState.acEl && chartState.acEl.querySelector('path');
                if (path) path.setAttribute('class', 'aircraft');
            } catch (e) {}
            bindOwnHover();
            if (legendEl && !minimized) renderChartLegend(legendEl, built.freqRows || []);
            applyChartLayers();
            updateChartAircraft();
            updateChartOtherAircraft();
        }).catch((e) => {
            chartLoadState = { status: 'error', icao, error: (e && e.message) || 'Failed' };
            updateStatus();
        });
    }
    function updateStatus() {
        const statusEl = panelEl && panelEl.querySelector('#rampradar-status');
        if (!statusEl) return;
        const s = chartLoadState;
        if (s.status === 'loading') { statusEl.style.display = 'block'; statusEl.innerHTML = 'Loading ' + escapeHtml(s.icao) + '…'; }
        else if (s.status === 'missing') { statusEl.style.display = 'block'; statusEl.innerHTML = '<span class="warn">No diagram for ' + escapeHtml(s.icao) + ' yet. Request it via <a href="' + ISSUES_URL + '" target="_blank" rel="noopener" style="color:#22d3ee;">GitHub Issues</a>.</span>'; }
        else if (s.status === 'error') { statusEl.style.display = 'block'; statusEl.innerHTML = '<span class="warn">' + escapeHtml(s.error) + '</span>'; }
        else if (s.status === 'none') { statusEl.style.display = 'block'; statusEl.innerHTML = '<span class="warn">Enter airport ICAO or use Nearest.</span>'; }
        else { statusEl.style.display = 'none'; statusEl.innerHTML = ''; }
    }

    function renderChartsTab(body) {
        const L = getChartLayers();
        const o = pilotRoute.origin, d = pilotRoute.dest;
        body.innerHTML = `
            <div id="rampradar-tools" class="rr-full-only">
                <button type="button" class="mode-btn" id="rr-nearest">NEAREST</button>
                <button type="button" class="mode-btn" id="rr-bookmark">${getBookmarks().includes(activeIcao) ? '★ SAVED' : '☆ SAVE'}</button>
                <label class="layer-toggle"><input type="checkbox" data-layer="taxi" ${L.taxi ? 'checked' : ''}> Taxi</label>
                <label class="layer-toggle"><input type="checkbox" data-layer="gates" ${L.gates ? 'checked' : ''}> Gates</label>
                <label class="layer-toggle"><input type="checkbox" data-layer="legend" ${L.legend ? 'checked' : ''}> Legend</label>
                <label class="layer-toggle"><input type="checkbox" data-layer="aircraft" ${L.aircraft ? 'checked' : ''}> Traffic</label>
                <label class="layer-toggle"><input type="checkbox" id="rr-follow" ${getChartFollow() ? 'checked' : ''}> Follow</label>
            </div>
            <div id="rampradar-search-row" class="rr-full-only">
                <input id="rampradar-icao-input" type="text" placeholder="AIRPORT ICAO" maxlength="4" value="${escapeHtml(activeIcao)}">
                <button type="button" id="rampradar-load-btn">LOAD</button>
                <button type="button" class="route-chip ${o ? '' : 'empty'}" id="rr-origin-chip" title="Load origin chart">${o ? escapeHtml(o) : 'ORIG'}</button>
                <button type="button" class="route-chip ${d ? '' : 'empty'}" id="rr-dest-chip" title="Load destination chart">${d ? escapeHtml(d) : 'DEST'}</button>
                <button type="button" id="rr-fp-sync" title="Sync from flight plan">FP</button>
                <input id="rr-callsign" type="text" placeholder="Callsign" maxlength="16" value="${escapeHtml(gmGet(STORAGE.CALLSIGN, '') || '')}" title="Optional callsign shown on hover">
            </div>
            <div id="rr-apt-name" class="rr-muted rr-full-only" style="margin:-2px 0 8px;min-height:14px;"></div>
            <div id="rampradar-status"></div>
            <div class="rampradar-chart-wrap">
                <div id="rampradar-canvas"></div>
                <div id="rampradar-legend"></div>
            </div>
        `;
        body.querySelectorAll('input[data-layer]').forEach((inp) => {
            inp.onchange = () => setChartLayer(inp.getAttribute('data-layer'), inp.checked);
        });
        const follow = body.querySelector('#rr-follow');
        if (follow) follow.onchange = () => { setChartFollow(follow.checked); if (!follow.checked) followTargetId = null; };
        const nearestBtn = body.querySelector('#rr-nearest');
        if (nearestBtn) nearestBtn.onclick = async () => {
            const st = body.querySelector('#rampradar-status');
            if (st) { st.style.display = 'block'; st.textContent = 'Finding nearest airport…'; }
            const n = await findNearestAirportIcao();
            if (!n) { alert('Could not determine nearest airport (no position or airport data).'); return; }
            const input = body.querySelector('#rampradar-icao-input');
            if (input) input.value = n.icao;
            const nameEl = body.querySelector('#rr-apt-name');
            if (nameEl) nameEl.textContent = (n.apt && n.apt.name) ? (n.apt.name + (n.nm != null ? ' · ' + n.nm.toFixed(1) + ' NM' : '')) : '';
            loadChartForIcao(n.icao);
        };
        const bmBtn = body.querySelector('#rr-bookmark');
        if (bmBtn) bmBtn.onclick = () => { if (activeIcao) { toggleBookmark(activeIcao); renderBody(); } };
        const input = body.querySelector('#rampradar-icao-input');
        const loadBtn = body.querySelector('#rampradar-load-btn');
        const nameEl = body.querySelector('#rr-apt-name');
        const refreshAptName = async (code) => {
            if (!nameEl) return;
            code = (code || '').trim().toUpperCase();
            if (!/^[A-Z0-9]{4}$/.test(code)) { nameEl.textContent = ''; return; }
            await ensureAirportsDb();
            const label = airportLabel(code);
            nameEl.textContent = label || 'Unknown airport code';
        };
        if (loadBtn) {
            const doLoad = () => loadChartForIcao((input.value || '').trim().toUpperCase());
            loadBtn.onclick = doLoad;
            if (input) {
                input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); doLoad(); } };
                input.oninput = () => {
                    const v = (input.value || '').toUpperCase();
                    input.value = v;
                    refreshAptName(v);
                };
            }
        }
        refreshAptName(activeIcao);
        ensureAirportsDb().then(() => refreshAptName(activeIcao));
        const oc = body.querySelector('#rr-origin-chip');
        const dc = body.querySelector('#rr-dest-chip');
        if (oc) oc.onclick = () => { if (pilotRoute.origin) loadChartForIcao(pilotRoute.origin); };
        if (dc) dc.onclick = () => { if (pilotRoute.dest) loadChartForIcao(pilotRoute.dest); };
        const fp = body.querySelector('#rr-fp-sync');
        if (fp) fp.onclick = () => {
            if (syncRouteFromFlightPlan(true)) renderBody();
            else alert('No ICAO waypoints found on the flight plan.');
        };
        const cs = body.querySelector('#rr-callsign');
        if (cs) cs.onchange = () => gmSet(STORAGE.CALLSIGN, (cs.value || '').trim());
        if (activeIcao) loadChartForIcao(activeIcao);
        else updateStatus();
    }

    function renderBookmarksTab(body) {
        const list = getBookmarks();
        body.innerHTML = `
            <div class="rr-label">BOOKMARKED AIRPORTS</div>
            <div class="rr-muted" style="margin-bottom:10px;">Click an ICAO to open its chart. Save from the Charts tab with ☆ SAVE.</div>
            ${list.length
                ? `<div class="rr-bm-grid">${list.map((b) => `
                    <button type="button" data-bm="${escapeHtml(b)}">${escapeHtml(b)}</button>
                    <button type="button" data-rm="${escapeHtml(b)}" title="Remove" style="padding:10px 8px;color:#f87171;">✕</button>
                `).join('')}</div>`
                : `<div class="rr-card rr-muted">No bookmarks yet.</div>`}
        `;
        body.querySelectorAll('[data-bm]').forEach((btn) => {
            btn.onclick = () => {
                activeTab = 'charts';
                activeIcao = btn.getAttribute('data-bm');
                renderBody();
            };
        });
        body.querySelectorAll('[data-rm]').forEach((btn) => {
            btn.onclick = () => {
                toggleBookmark(btn.getAttribute('data-rm'));
                renderBody();
            };
        });
    }

    async function wxBlockHtml(label, icao) {
        if (!icao) return `<div class="rr-card"><div class="rr-label">${escapeHtml(label)}</div><div class="rr-muted">Not set — use FP sync or set route on Charts.</div></div>`;
        await ensureAirportsDb();
        const aptName = airportLabel(icao);
        const [metar, atis] = await Promise.all([fetchMetarRaw(icao), fetchDigitalAtis(icao)]);
        let html = `<div class="rr-card"><div class="rr-label">${escapeHtml(label)} · ${escapeHtml(icao)}</div>`;
        if (aptName) html += `<div class="rr-muted" style="margin-bottom:6px;">${escapeHtml(aptName)}</div>`;
        if (metar.error) html += `<div class="rr-muted" style="color:#e0955c;">${escapeHtml(metar.error)}</div>`;
        else html += `<div class="rr-label" style="margin-top:6px;">METAR</div><div class="rr-atis">${escapeHtml(metar.raw)}</div>`;
        if (atis.source === 'datis' && atis.items && atis.items.length) {
            html += `<div class="rr-label" style="margin-top:10px;">DIGITAL ATIS</div>`;
            html += atis.items.map((it) =>
                `<div class="rr-muted" style="margin-top:4px;">Info ${escapeHtml(it.code || '—')} ${it.time ? '· ' + escapeHtml(it.time) + 'Z' : ''} ${it.type ? '(' + escapeHtml(it.type) + ')' : ''}</div>
                 <div class="rr-atis">${escapeHtml(it.text)}</div>`
            ).join('');
        } else {
            html += `<div class="rr-label" style="margin-top:10px;">DECODED METAR <span style="font-weight:600;opacity:0.7;">(not official ATIS)</span></div>`;
            if (metar.raw && !metar.error) {
                const dec = decodeMetarSummary(metar.raw);
                if (dec) {
                    html += `<div class="rr-row"><span>Time</span><span>${escapeHtml(dec.time)}</span></div>
                    <div class="rr-row"><span>Wind</span><span>${escapeHtml(dec.wind)}</span></div>
                    <div class="rr-row"><span>Visibility</span><span>${escapeHtml(dec.vis)}</span></div>
                    <div class="rr-row"><span>Clouds</span><span>${escapeHtml(dec.clouds)}</span></div>
                    <div class="rr-row"><span>Temp / Dew</span><span>${escapeHtml(dec.temp)} / ${escapeHtml(dec.dew)}</span></div>
                    <div class="rr-row"><span>QNH</span><span>${escapeHtml(dec.qnh)}</span></div>`;
                }
            } else {
                html += `<div class="rr-muted">${escapeHtml(atis.error || 'Unavailable')}</div>`;
            }
        }
        html += `</div>`;
        return html;
    }
    function renderWeatherTab(body) {
        syncRouteFromFlightPlan(false);
        body.innerHTML = `<div class="rr-muted" style="margin-bottom:8px;">Origin & destination from your route / flight plan. Real digital ATIS when available (DATIS, mainly US); otherwise decoded METAR. METAR from NOAA.</div>
            <div id="rr-wx-blocks"><div class="rr-muted">Loading…</div></div>
            <div class="rr-label" style="margin-top:8px;">LOOKUP</div>
            <div id="rampradar-search-row">
                <input id="rr-wx-icao" type="text" placeholder="AIRPORT ICAO" maxlength="4" style="width:100px;">
                <button type="button" id="rr-wx-go">FETCH</button>
            </div>
            <div id="rr-wx-extra"></div>`;
        const blocks = body.querySelector('#rr-wx-blocks');
        Promise.all([
            wxBlockHtml('ORIGIN', pilotRoute.origin),
            wxBlockHtml('DESTINATION', pilotRoute.dest)
        ]).then(([a, b]) => { blocks.innerHTML = a + b; });
        const go = async () => {
            const icao = (body.querySelector('#rr-wx-icao').value || '').trim().toUpperCase();
            const extra = body.querySelector('#rr-wx-extra');
            if (!/^[A-Z]{4}$/.test(icao)) { extra.innerHTML = '<div class="rr-muted" style="color:#e0955c;">Invalid ICAO</div>'; return; }
            extra.innerHTML = '<div class="rr-muted">Loading…</div>';
            extra.innerHTML = await wxBlockHtml('LOOKUP', icao);
        };
        body.querySelector('#rr-wx-go').onclick = go;
        body.querySelector('#rr-wx-icao').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    }

    function renderToolsTab(body) {
        checkForUpdate();
        const clLines = isUpdateAvailable() ? changelogBulletsFor(remoteVersion) : [];
        const clHtml = clLines.length
            ? `<ul style="margin:8px 0 0 18px;padding:0;font-size:11px;color:#cfe0ee;line-height:1.5;">${clLines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
            : `<div class="rr-muted" style="margin-top:6px;">See CHANGELOG.md on GitHub for details.</div>`;
        const updateCard = isUpdateAvailable()
            ? `<div class="rr-card" style="border-color:#22d3ee;">
                    <div class="rr-label" style="color:#22d3ee;">UPDATE AVAILABLE — v${escapeHtml(remoteVersion)}</div>
                    <div class="rr-muted">You are on v${escapeHtml(SCRIPT_VERSION)}</div>
                    ${clHtml}
                    <a href="${SCRIPT_INSTALL_URL}" target="_blank" rel="noopener"
                       style="display:inline-block;margin-top:10px;padding:8px 14px;background:#16304e;border:1px solid #22d3ee;border-radius:8px;color:#22d3ee;font-weight:800;font-size:11px;text-decoration:none;">
                       Open update (raw script)
                    </a>
                    <div class="rr-muted" style="margin-top:6px;">Opens the raw userscript URL in a new tab — Tampermonkey can install / update from there.</div>
               </div>`
            : (remoteVersion
                ? `<div class="rr-card"><div class="rr-muted">Up to date · v${escapeHtml(SCRIPT_VERSION)}</div></div>`
                : `<div class="rr-card"><div class="rr-muted">RampRadar v${escapeHtml(SCRIPT_VERSION)}${versionCheckDone ? ' · could not check for updates' : ' · checking…'}</div></div>`);
        body.innerHTML = `
            ${updateCard}
            <div class="rr-card">
                <div class="rr-label">KEYBOARD SHORTCUT</div>
                <div class="rr-muted" style="margin-bottom:8px;">Optional hotkey to open / restore / close. Ignored while typing.</div>
                <button type="button" id="rr-sc-cap" class="mode-btn" style="padding:8px 14px;">${escapeHtml(formatShortcut(getOpenShortcut()))}</button>
                <button type="button" id="rr-sc-clear" class="mode-btn" style="padding:8px 14px;margin-left:8px;">CLEAR</button>
            </div>
            <div class="rr-card">
                <div class="rr-label">ABOUT</div>
                <div class="rr-muted">RampRadar v${SCRIPT_VERSION}<br>
                Charts: <code style="color:#22d3ee;word-break:break-all;">${escapeHtml(CHARTS_BASE_URL)}</code><br>
                Missing a chart? <a href="${ISSUES_URL}" target="_blank" rel="noopener" style="color:#22d3ee;">Request on GitHub Issues</a></div>
            </div>`;
        body.querySelector('#rr-sc-clear').onclick = () => { setOpenShortcut(null); renderBody(); };
        const cap = body.querySelector('#rr-sc-cap');
        cap.onclick = () => {
            if (shortcutCaptureMode) return;
            shortcutCaptureMode = true;
            cap.textContent = 'Press keys…';
            const onCapture = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault(); e.stopPropagation();
                    document.removeEventListener('keydown', onCapture, true);
                    shortcutCaptureMode = false; renderBody(); return;
                }
                if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
                e.preventDefault(); e.stopPropagation();
                document.removeEventListener('keydown', onCapture, true);
                setOpenShortcut({ ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, key: e.key });
                shortcutCaptureMode = false; renderBody();
            };
            document.addEventListener('keydown', onCapture, true);
        };
    }

    function renderBody() {
        if (!panelEl) return;
        const body = panelEl.querySelector('#rampradar-body');
        panelEl.querySelectorAll('#rampradar-tabs button').forEach((b) => {
            b.classList.toggle('active', b.getAttribute('data-tab') === activeTab);
        });
        if (minimized) {
            // mini: charts only, compact
            activeTab = 'charts';
            body.classList.add('rr-charts-mode');
            body.classList.remove('rr-scroll');
            renderChartsTab(body);
            return;
        }
        if (activeTab === 'charts') {
            body.classList.add('rr-charts-mode');
            body.classList.remove('rr-scroll');
            renderChartsTab(body);
        } else {
            body.classList.remove('rr-charts-mode');
            body.classList.add('rr-scroll');
            if (activeTab === 'weather') renderWeatherTab(body);
            else if (activeTab === 'bookmarks') renderBookmarksTab(body);
            else renderToolsTab(body);
        }
    }

    function makeDraggable(handle, target, signal, onEnd) {
        let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
        handle.addEventListener('mousedown', (e) => {
            if (e.target.closest('button')) return;
            dragging = true;
            const rect = target.getBoundingClientRect();
            target.style.left = rect.left + 'px'; target.style.top = rect.top + 'px';
            target.style.right = 'auto'; target.style.bottom = 'auto'; target.style.transform = 'none';
            startX = e.clientX; startY = e.clientY; startLeft = rect.left; startTop = rect.top;
            e.preventDefault();
        }, { signal });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            target.style.left = (startLeft + e.clientX - startX) + 'px';
            target.style.top = (startTop + e.clientY - startY) + 'px';
        }, { signal });
        document.addEventListener('mouseup', () => { if (dragging && onEnd) onEnd(); dragging = false; }, { signal });
    }
    function makeResizable(handle, target, signal, onEnd, minW, minH) {
        let resizing = false, startX = 0, startY = 0, startW = 0, startH = 0;
        handle.addEventListener('mousedown', (e) => {
            resizing = true;
            const rect = target.getBoundingClientRect();
            startX = e.clientX; startY = e.clientY; startW = rect.width; startH = rect.height;
            e.preventDefault(); e.stopPropagation();
        }, { signal });
        document.addEventListener('mousemove', (e) => {
            if (!resizing) return;
            target.style.width = Math.max(minW || 280, Math.min(window.innerWidth - 16, startW + (e.clientX - startX))) + 'px';
            target.style.height = Math.max(minH || 180, Math.min(window.innerHeight - 16, startH + (e.clientY - startY))) + 'px';
        }, { signal });
        document.addEventListener('mouseup', () => { if (resizing && onEnd) onEnd(); resizing = false; }, { signal });
    }
    function saveGeometry() {
        if (!panelEl) return;
        const rect = panelEl.getBoundingClientRect();
        const payload = { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
        if (minimized) gmSet(STORAGE.MINI_GEOMETRY, payload);
        else gmSet(STORAGE.GEOMETRY, payload);
    }

    function openPanel() {
        if (panelOpen) return;
        panelOpen = true; minimized = false;
        injectStyles();
        syncRouteFromFlightPlan(false);
        ensureAirportsDb();
        checkForUpdate();
        dragAbort = new AbortController();
        backdropEl = document.createElement('div');
        backdropEl.id = 'rampradar-backdrop';
        backdropEl.onclick = closePanel;
        document.body.appendChild(backdropEl);
        panelEl = document.createElement('div');
        panelEl.id = 'rampradar-panel';
        panelEl.onclick = (e) => e.stopPropagation();
        panelEl.innerHTML = `
            <div id="rampradar-topbar">
                <div class="title">RAMPRADAR</div>
                <div class="icao-tag">${escapeHtml(activeIcao || '')}</div>
                <div class="rr-clock" id="rr-clock">${formatClockHMS(new Date())}</div>
                <div id="rampradar-tabs">
                    <button type="button" data-tab="charts" class="active">CHARTS</button>
                    <button type="button" data-tab="weather">METAR/ATIS</button>
                    <button type="button" data-tab="bookmarks">BOOKMARKS</button>
                    <button type="button" data-tab="tools">TOOLS</button>
                </div>
                <div class="spacer"></div>
                <button type="button" class="icon-btn" id="rr-min" title="Minimize">—</button>
                <button type="button" class="icon-btn" id="rr-max" title="Maximize">▣</button>
                <button type="button" class="icon-btn" id="rr-close" title="Close">✕</button>
            </div>
            <div id="rampradar-body"></div>
            <div id="rampradar-resize"></div>
        `;
        document.body.appendChild(panelEl);
        const geom = gmGet(STORAGE.GEOMETRY, null);
        if (geom && geom.width) {
            panelEl.style.transform = 'none';
            panelEl.style.top = Math.max(0, geom.top) + 'px';
            panelEl.style.left = Math.max(0, geom.left) + 'px';
            panelEl.style.width = geom.width + 'px';
            panelEl.style.height = geom.height + 'px';
        }
        panelEl.querySelector('#rr-close').onclick = closePanel;
        panelEl.querySelector('#rr-min').onclick = minimize;
        panelEl.querySelector('#rr-max').onclick = () => {
            if (minimized) { restore(); return; }
            panelEl.classList.toggle('is-max');
        };
        panelEl.querySelectorAll('#rampradar-tabs button').forEach((b) => {
            b.onclick = () => { activeTab = b.getAttribute('data-tab'); renderBody(); };
        });
        makeDraggable(panelEl.querySelector('#rampradar-topbar'), panelEl, dragAbort.signal, saveGeometry);
        makeResizable(panelEl.querySelector('#rampradar-resize'), panelEl, dragAbort.signal, saveGeometry, 380, 280);
        ['keydown', 'keyup', 'keypress'].forEach((evt) => {
            panelEl.addEventListener(evt, (e) => e.stopPropagation(), { signal: dragAbort.signal });
        });
        renderBody();
    }
    function minimize() {
        if (!panelOpen || minimized) return;
        saveGeometry();
        minimized = true;
        panelEl.classList.add('is-mini');
        panelEl.classList.remove('is-max');
        if (backdropEl) backdropEl.style.display = 'none';
        const g = gmGet(STORAGE.MINI_GEOMETRY, null);
        const s = MINI_SIZES[miniSizeIndex] || MINI_SIZES[1];
        panelEl.style.transform = 'none';
        if (g && g.left != null) {
            panelEl.style.top = Math.max(0, g.top) + 'px';
            panelEl.style.left = Math.max(0, g.left) + 'px';
            panelEl.style.width = (g.width || s.w) + 'px';
            panelEl.style.height = (g.height || s.h) + 'px';
        } else {
            panelEl.style.width = s.w + 'px';
            panelEl.style.height = s.h + 'px';
            panelEl.style.top = (window.innerHeight - s.h - 24) + 'px';
            panelEl.style.left = (window.innerWidth - s.w - 24) + 'px';
        }
        panelEl.querySelector('#rr-min').title = 'Restore';
        panelEl.querySelector('#rr-min').textContent = '□';
        panelEl.querySelector('#rr-min').onclick = restore;
        activeTab = 'charts';
        renderBody();
    }
    function restore() {
        if (!panelOpen || !minimized) return;
        saveGeometry();
        minimized = false;
        panelEl.classList.remove('is-mini');
        if (backdropEl) backdropEl.style.display = 'block';
        const geom = gmGet(STORAGE.GEOMETRY, null);
        if (geom && geom.width) {
            panelEl.style.top = Math.max(0, geom.top) + 'px';
            panelEl.style.left = Math.max(0, geom.left) + 'px';
            panelEl.style.width = geom.width + 'px';
            panelEl.style.height = geom.height + 'px';
        } else {
            panelEl.style.width = '';
            panelEl.style.height = '';
            panelEl.style.top = '50%';
            panelEl.style.left = '50%';
            panelEl.style.transform = 'translate(-50%,-50%)';
        }
        panelEl.querySelector('#rr-min').title = 'Minimize';
        panelEl.querySelector('#rr-min').textContent = '—';
        panelEl.querySelector('#rr-min').onclick = minimize;
        renderBody();
    }
    function closePanel() {
        panelOpen = false; minimized = false;
        followTargetId = null;
        hideAcTooltip();
        if (dragAbort) { dragAbort.abort(); dragAbort = null; }
        chartState = null;
        if (panelEl) { panelEl.remove(); panelEl = null; }
        if (backdropEl) { backdropEl.remove(); backdropEl = null; }
    }

    setInterval(() => {
        if (!panelOpen) return;
        const clock = panelEl && panelEl.querySelector('#rr-clock');
        if (clock) clock.textContent = formatClockHMS(new Date());
        if (activeTab === 'charts' && chartState) {
            updateChartAircraft();
            updateChartOtherAircraft();
        }
    }, 1000);

    function addToolbarButton() {
        if (document.getElementById('rampradar-toolbar-button')) return;
        const buttonDiv = document.createElement('div');
        buttonDiv.innerHTML = `<button class="mdl-button mdl-js-button geofs-f-standard-ui geofs-mediumScreenOnly" tabindex="0" id="rampradar-toolbar-button">CHARTS</button>`;
        let retryCount = 0;
        function tryInsert() {
            if (document.getElementById('rampradar-toolbar-button')) return;
            const bottomUI = document.getElementsByClassName('geofs-ui-bottom')[0];
            if (bottomUI) {
                const element = buttonDiv.firstElementChild;
                try {
                    if (typeof geofs !== 'undefined' && geofs.version >= 3.6) bottomUI.insertBefore(element, bottomUI.children[5] || null);
                    else bottomUI.insertBefore(element, bottomUI.children[4] || null);
                } catch (e) { bottomUI.appendChild(element); }
                element.onclick = function () {
                    if (!panelOpen) openPanel();
                    else if (minimized) restore();
                    else closePanel();
                };
            } else if (retryCount < 30) { retryCount++; setTimeout(tryInsert, 300); }
        }
        tryInsert();
    }
    function ready(fn) {
        if (document.readyState !== 'loading') fn();
        else document.addEventListener('DOMContentLoaded', fn);
    }
    ready(() => { addToolbarButton(); installOpenShortcutListener(); });
    setTimeout(addToolbarButton, 3000);
    setTimeout(installOpenShortcutListener, 500);
})();
