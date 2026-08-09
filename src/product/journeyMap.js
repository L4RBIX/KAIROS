/**
 * Kazakhstan journey map — route planning + model coverage layer.
 *
 * Separate from the WebGPU cinematic conditions view. Coverage markers use
 * representative midpoints from the trained catalog (not surveyed polylines).
 */

import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { PLACES } from "../services/places.js";
import { routeDriving } from "../services/routingService.js";
import {
    analyzeJourney,
    fetchCoverageSegments,
    journeyIntelligence,
} from "../services/journeyService.js";

const CSS = `
#kairos-map {
    position: fixed; inset: 0; z-index: 30;
    background: #070b12;
    opacity: 0; pointer-events: none; visibility: hidden;
    transition: opacity 700ms cubic-bezier(0.16, 1, 0.3, 1);
}
#kairos-map.active { opacity: 1; pointer-events: auto; visibility: visible; }
#kairos-map .maplibregl-map { font: inherit; }
#kairos-map .maplibregl-ctrl-attrib {
    background: transparent !important; color: rgba(232,240,248,0.35);
    font-size: 9px; letter-spacing: 0.06em;
}
#kairos-map .maplibregl-ctrl-attrib a { color: rgba(232,240,248,0.45); }
#kairos-map .maplibregl-ctrl-group {
    background: rgba(7,11,18,0.72); border: 1px solid rgba(232,240,248,0.18);
    box-shadow: none;
}
#kairos-map .maplibregl-ctrl-group button {
    background: transparent; border: 0; filter: invert(1) brightness(1.4);
}

.jm-ui {
    position: absolute; left: clamp(18px, 3vw, 48px); top: clamp(18px, 3vw, 48px);
    bottom: clamp(18px, 3vw, 48px);
    width: min(400px, 92vw);
    z-index: 2; display: flex; flex-direction: column; gap: 14px;
    color: #e8f0f8;
    font-family: ui-sans-serif, "Segoe UI", system-ui, sans-serif;
    pointer-events: none;
}
.jm-ui * { pointer-events: auto; }
.jm-top {
    display: flex; align-items: baseline; justify-content: space-between;
    gap: 16px; pointer-events: none;
}
.jm-top * { pointer-events: auto; }
.jm-close {
    background: none; border: 0; padding: 0; cursor: pointer;
    color: rgba(232,240,248,0.45); font: inherit;
    font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase;
}
.jm-close:hover { color: #e8f0f8; }
.jm-brand {
    font-size: 13px; font-weight: 500; letter-spacing: 0.52em; text-indent: 0.52em;
}
.jm-kicker {
    font-size: 10px; letter-spacing: 0.26em; text-transform: uppercase;
    color: rgba(232,240,248,0.42);
}
.jm-card {
    background: linear-gradient(160deg, rgba(5,9,15,0.88), rgba(5,9,15,0.55));
    border-bottom: 1px solid rgba(232,240,248,0.16);
    padding: 18px 4px 16px;
    max-height: calc(100% - 40px);
    overflow: auto;
}
.jm-fields { display: grid; gap: 14px; margin: 16px 0; }
.jm-field label {
    display: block; font-size: 9px; letter-spacing: 0.22em; text-transform: uppercase;
    color: rgba(232,240,248,0.42); margin-bottom: 6px;
}
.jm-field select, .jm-field input[type="time"] {
    appearance: none; width: 100%; background: transparent; border: 0;
    border-bottom: 1px solid rgba(232,240,248,0.2); border-radius: 0;
    color: #e8f0f8; font: inherit; font-size: 17px; font-weight: 300;
    padding: 0 0 8px; outline: none; cursor: pointer;
}
.jm-field select option { background: #0d141f; color: #e8f0f8; }
.jm-go {
    background: transparent; border: 1px solid rgba(232,240,248,0.2);
    color: #e8f0f8; font: inherit; font-size: 10px; font-weight: 500;
    letter-spacing: 0.28em; text-transform: uppercase; padding: 14px 22px;
    cursor: pointer; width: 100%;
}
.jm-go:hover { border-color: #e8f0f8; }
.jm-go[disabled] { opacity: 0.4; cursor: default; }
.jm-status {
    min-height: 1.2em; font-size: 11px; letter-spacing: 0.14em;
    text-transform: uppercase; color: #8fc4e8; margin-top: 10px;
}
.jm-status[data-err="1"] { color: #e8b04f; }
.jm-legend {
    font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;
    color: rgba(232,240,248,0.42); line-height: 1.7;
}
.jm-legend b { color: #e8f0f8; font-weight: 400; }
.jm-result { margin-top: 18px; display: none; }
.jm-result.shown { display: block; }
.jm-route {
    font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase;
    color: rgba(232,240,248,0.42); margin-bottom: 10px;
}
.jm-title {
    font-size: clamp(22px, 3vw, 30px); font-weight: 300; letter-spacing: -0.02em;
    margin-bottom: 12px;
}
.jm-meta {
    display: grid; grid-template-columns: 1fr 1fr; gap: 10px 16px;
    margin-bottom: 14px;
}
.jm-meta span {
    display: block; font-size: 9px; letter-spacing: 0.2em; text-transform: uppercase;
    color: rgba(232,240,248,0.42); margin-bottom: 4px;
}
.jm-meta b { font-size: 15px; font-weight: 300; }
.jm-note {
    font-size: 12px; font-weight: 300; line-height: 1.55; color: #8fa1b5;
    margin: 0 0 14px; max-width: 34em;
}
.jm-intel {
    font-size: 13px; font-weight: 300; line-height: 1.6; color: #e8f0f8;
    margin: 0 0 14px; white-space: pre-wrap; max-width: 36em;
}
.jm-intel strong { font-weight: 500; }
.jm-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
.jm-chip, .jm-link {
    background: transparent; border: 1px solid rgba(232,240,248,0.2);
    color: #e8f0f8; font: inherit; font-size: 10px; letter-spacing: 0.14em;
    text-transform: uppercase; padding: 9px 10px; cursor: pointer;
}
.jm-chip:hover, .jm-link:hover { border-color: #e8f0f8; color: #8fc4e8; }
.jm-chip[disabled] { opacity: 0.4; cursor: default; }
.jm-explore {
    margin-top: 14px; width: 100%;
    background: transparent; border: 1px solid rgba(232,240,248,0.35);
    color: #e8f0f8; font: inherit; font-size: 10px; font-weight: 500;
    letter-spacing: 0.26em; text-transform: uppercase; padding: 15px 18px;
    cursor: pointer;
}
.jm-explore:hover { border-color: #e8f0f8; }
.jm-explore[disabled] { opacity: 0.35; cursor: default; }
.jm-winter {
    margin-top: 10px; background: none; border: 0; border-bottom: 1px solid rgba(232,240,248,0.2);
    color: rgba(232,240,248,0.55); font: inherit; font-size: 10px;
    letter-spacing: 0.2em; text-transform: uppercase; padding: 0 0 6px; cursor: pointer;
}
.jm-winter:hover { color: #e8f0f8; }

@media (max-width: 620px) {
    #kairos-map {
        padding:
            env(safe-area-inset-top, 0px)
            env(safe-area-inset-right, 0px)
            env(safe-area-inset-bottom, 0px)
            env(safe-area-inset-left, 0px);
    }
    /* Bottom sheet planner — keep the map readable above. */
    .jm-ui {
        left: 0; right: 0; top: auto; bottom: 0;
        width: 100%;
        max-height: min(62vh, 560px);
        gap: 10px;
        padding: 0 14px calc(10px + env(safe-area-inset-bottom, 0px));
        background: linear-gradient(180deg,
            rgba(5, 9, 15, 0) 0%,
            rgba(5, 9, 15, 0.72) 12%,
            rgba(5, 9, 15, 0.94) 28%);
    }
    .jm-top {
        padding-top: 10px;
        align-items: center;
    }
    .jm-brand {
        letter-spacing: 0.36em;
        text-indent: 0.36em;
    }
    .jm-close {
        letter-spacing: 0.14em;
        min-height: 44px;
    }
    .jm-card {
        max-height: none;
        overflow: auto;
        -webkit-overflow-scrolling: touch;
        background: rgba(5, 9, 15, 0.92);
        border-bottom: 0;
        border-top: 1px solid rgba(232, 240, 248, 0.16);
        padding: 14px 12px 18px;
        border-radius: 0;
    }
    .jm-fields { gap: 12px; margin: 12px 0; }
    .jm-field select, .jm-field input[type="time"] {
        font-size: 16px; /* iOS zoom guard */
        min-height: 40px;
    }
    .jm-go, .jm-explore {
        min-height: 48px;
        letter-spacing: 0.18em;
    }
    .jm-legend {
        letter-spacing: 0.1em;
        line-height: 1.55;
    }
    .jm-meta { gap: 12px; }
    .jm-chip {
        min-height: 40px;
        letter-spacing: 0.1em;
    }
    #kairos-map .maplibregl-ctrl-bottom-right {
        bottom: calc(min(62vh, 560px) + 8px);
        right: 10px;
    }
    #kairos-map .maplibregl-ctrl-attrib {
        margin: 0 8px 4px;
        max-width: 55vw;
    }
}
`;

function formatIntelHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
}

export class JourneyMap {
    /**
     * @param {{
     *   onExplore: (q: {segmentId:string,label:string,departure:string,journeyLabel:string}) => void,
     *   onClose?: () => void,
     *   onWinterScenario?: () => void,
     * }} opts
     */
    constructor(opts) {
        this.onExplore = opts.onExplore;
        this.onClose = opts.onClose || null;
        this.onWinterScenario = opts.onWinterScenario || null;
        this.active = false;
        this.map = null;
        this.segments = [];
        this.analysis = null;
        this.route = null;
        /** @type {ReturnType<typeof setTimeout>|null} */
        this._hideTimer = null;

        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        this.root = document.createElement("div");
        this.root.id = "kairos-map";
        this.root.innerHTML = `
            <div id="jm-canvas" style="position:absolute;inset:0;"></div>
            <div class="jm-ui">
                <div class="jm-top">
                    <div class="jm-brand">KAIROS</div>
                    <button class="jm-close" id="jm-close" type="button">Back to road</button>
                </div>
                <div class="jm-card">
                    <div class="jm-kicker">Route planner</div>
                    <div class="jm-fields">
                        <div class="jm-field">
                            <label for="jm-from">From</label>
                            <select id="jm-from"></select>
                        </div>
                        <div class="jm-field">
                            <label for="jm-to">To</label>
                            <select id="jm-to"></select>
                        </div>
                        <div class="jm-field">
                            <label for="jm-depart">Departure</label>
                            <input id="jm-depart" type="time" value="16:00" step="900" />
                        </div>
                    </div>
                    <button class="jm-go" id="jm-analyze" type="button">Analyze journey</button>
                    <p class="jm-status" id="jm-status"></p>
                    <div class="jm-legend">
                        <div><b>●</b> ML risk available · trained corridor</div>
                        <div><b>○</b> Weather-only · not yet trained</div>
                    </div>
                    <div class="jm-result" id="jm-result">
                        <div class="jm-route" id="jm-route"></div>
                        <div class="jm-title" id="jm-title">Route intelligence</div>
                        <div class="jm-meta">
                            <div><span>Distance</span><b id="jm-dist">—</b></div>
                            <div><span>Model coverage</span><b id="jm-cov">—</b></div>
                            <div><span>Trained sections</span><b id="jm-secs">—</b></div>
                            <div><span>Highest risk</span><b id="jm-risk">—</b></div>
                        </div>
                        <p class="jm-note" id="jm-note"></p>
                        <div class="jm-intel" id="jm-intel"></div>
                        <div class="jm-actions">
                            <button class="jm-chip" data-act="why" type="button">Why this risk?</button>
                            <button class="jm-chip" data-act="wait" type="button">If I wait 2h</button>
                            <button class="jm-chip" data-act="safest" type="button">Safest window</button>
                            <button class="jm-chip" data-act="ask" type="button">Ask KAIROS</button>
                        </div>
                        <button class="jm-explore" id="jm-explore" type="button" disabled>
                            Enter road view
                        </button>
                        <button class="jm-winter" id="jm-winter" type="button">
                            Illustrative winter scenario
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(this.root);

        this.el = {
            from: this.root.querySelector("#jm-from"),
            to: this.root.querySelector("#jm-to"),
            depart: this.root.querySelector("#jm-depart"),
            analyze: this.root.querySelector("#jm-analyze"),
            close: this.root.querySelector("#jm-close"),
            status: this.root.querySelector("#jm-status"),
            result: this.root.querySelector("#jm-result"),
            route: this.root.querySelector("#jm-route"),
            title: this.root.querySelector("#jm-title"),
            dist: this.root.querySelector("#jm-dist"),
            cov: this.root.querySelector("#jm-cov"),
            secs: this.root.querySelector("#jm-secs"),
            risk: this.root.querySelector("#jm-risk"),
            note: this.root.querySelector("#jm-note"),
            intel: this.root.querySelector("#jm-intel"),
            explore: this.root.querySelector("#jm-explore"),
            winter: this.root.querySelector("#jm-winter"),
        };

        for (const p of PLACES) {
            for (const sel of [this.el.from, this.el.to]) {
                const o = document.createElement("option");
                o.value = p.id;
                o.textContent = p.label;
                sel.appendChild(o);
            }
        }
        this.el.from.value = "almaty";
        this.el.to.value = "shymkent";

        this.el.analyze.addEventListener("click", () => this.analyze());
        this.el.explore.addEventListener("click", () => this.explore());
        this.el.close.addEventListener("click", () => this.onClose?.());
        this.el.winter.addEventListener("click", () => this.onWinterScenario?.());
        this.root.querySelectorAll(".jm-chip").forEach((btn) => {
            btn.addEventListener("click", () => this.intelAction(btn.getAttribute("data-act")));
        });
    }

    async init() {
        this.map = new maplibregl.Map({
            container: "jm-canvas",
            style: {
                version: 8,
                sources: {
                    carto: {
                        type: "raster",
                        tiles: [
                            "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
                        ],
                        tileSize: 256,
                        attribution: "© OpenStreetMap © CARTO",
                    },
                },
                layers: [{ id: "carto", type: "raster", source: "carto" }],
            },
            center: [66.9, 48.0],
            zoom: 4.2,
            attributionControl: true,
        });
        this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

        await new Promise((resolve) => this.map.once("load", resolve));
        // Empty route / hotspot sources so later updates never race layer creation.
        this.map.addSource("route", {
            type: "geojson",
            data: { type: "Feature", geometry: { type: "LineString", coordinates: [] } },
        });
        this.map.addLayer({
            id: "route-line",
            type: "line",
            source: "route",
            paint: {
                "line-color": "#c9d7e6",
                "line-width": 2.5,
                "line-opacity": 0.85,
            },
        });
        this.map.addSource("hotspots", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
        });
        this.map.addLayer({
            id: "hotspots",
            type: "circle",
            source: "hotspots",
            paint: {
                "circle-radius": [
                    "interpolate", ["linear"], ["get", "risk"],
                    0.2, 6, 0.5, 9, 0.8, 12,
                ],
                "circle-color": [
                    "interpolate", ["linear"], ["get", "risk"],
                    0.25, "#8fc4e8",
                    0.45, "#c9b07a",
                    0.65, "#e8b04f",
                    0.85, "#e8734f",
                ],
                "circle-stroke-width": 1.5,
                "circle-stroke-color": "#e8f0f8",
            },
        });
        this.segments = await fetchCoverageSegments();
        this._drawCoverage();
    }

    show() {
        this.active = true;
        if (this._hideTimer) {
            clearTimeout(this._hideTimer);
            this._hideTimer = null;
        }
        this.root.style.visibility = "visible";
        this.root.classList.add("active");
        // Resume map paint after the fade-in.
        requestAnimationFrame(() => {
            this.map?.resize();
            try { this.map?.triggerRepaint(); } catch { /* */ }
        });
    }

    hide() {
        this.active = false;
        this.root.classList.remove("active");
        // After the opacity transition, drop visibility so MapLibre idles.
        if (this._hideTimer) clearTimeout(this._hideTimer);
        this._hideTimer = setTimeout(() => {
            if (!this.active) this.root.style.visibility = "hidden";
            this._hideTimer = null;
        }, 720);
    }

    _setStatus(text, err = false) {
        this.el.status.textContent = text || "";
        this.el.status.dataset.err = err ? "1" : "0";
    }

    _drawCoverage() {
        if (!this.map || !this.segments.length) return;
        const features = this.segments.map((s) => ({
            type: "Feature",
            properties: {
                id: s.segment_id,
                label: s.label,
                note: s.coverage_note || "",
                trained: s.trained !== false,
            },
            geometry: {
                type: "Point",
                coordinates: [s.longitude, s.latitude],
            },
        }));
        const src = {
            type: "FeatureCollection",
            features,
        };
        if (this.map.getSource("coverage")) {
            this.map.getSource("coverage").setData(src);
            return;
        }
        this.map.addSource("coverage", { type: "geojson", data: src });
        this.map.addLayer({
            id: "coverage-glow",
            type: "circle",
            source: "coverage",
            paint: {
                // Surveyed segments carry the wider, brighter halo; the demo
                // corridor network reads as a quieter connective mesh.
                "circle-radius": ["case", ["get", "trained"], 18, 10],
                "circle-color": "#8fc4e8",
                "circle-opacity": ["case", ["get", "trained"], 0.12, 0.06],
            },
        });
        this.map.addLayer({
            id: "coverage-core",
            type: "circle",
            source: "coverage",
            paint: {
                "circle-radius": ["case", ["get", "trained"], 5, 2.6],
                "circle-color": "#8fc4e8",
                "circle-opacity": ["case", ["get", "trained"], 1, 0.55],
                "circle-stroke-width": ["case", ["get", "trained"], 1, 0],
                "circle-stroke-color": "#e8f0f8",
            },
        });
    }

    _drawRoute(coords, hotspots = []) {
        this.map.getSource("route")?.setData({
            type: "Feature",
            geometry: { type: "LineString", coordinates: coords },
        });
        this.map.getSource("hotspots")?.setData({
            type: "FeatureCollection",
            features: hotspots.map((h) => ({
                type: "Feature",
                properties: {
                    risk: h.risk,
                    label: h.segment_label || h.segment_id,
                },
                geometry: {
                    type: "Point",
                    coordinates: [h.longitude, h.latitude],
                },
            })),
        });

        const bounds = new maplibregl.LngLatBounds();
        for (const c of coords) bounds.extend(c);
        this.map.fitBounds(bounds, { padding: 80, duration: 1200, maxZoom: 7.5 });
    }

    async analyze() {
        const from = PLACES.find((p) => p.id === this.el.from.value);
        const to = PLACES.find((p) => p.id === this.el.to.value);
        if (!from || !to) return;
        if (from.id === to.id) {
            this._setStatus("Choose different places", true);
            return;
        }

        this.el.analyze.disabled = true;
        this.el.explore.disabled = true;
        this.el.result.classList.remove("shown");
        this._setStatus("Routing across Kazakhstan");

        try {
            this.route = await routeDriving(from, to);
            this._setStatus("Matching trained corridors");
            this.analysis = await analyzeJourney({
                fromLabel: from.label,
                toLabel: to.label,
                departure: this.el.depart.value || "16:00",
                geometry: this.route.geometry,
                distanceKm: this.route.distanceKm,
            });

            const cov = this.analysis.coverage || {};
            const matches = cov.covered_segments || [];
            const highest = this.analysis.highest_risk_segment;

            // Enrich hotspots with coords from segment catalog
            const hotspots = (this.analysis.predictions || []).map((p) => {
                const seg = this.segments.find((s) => s.segment_id === p.segment_id);
                return {
                    ...p,
                    latitude: seg?.latitude,
                    longitude: seg?.longitude,
                };
            }).filter((h) => h.latitude != null);

            this._drawRoute(this.route.geometry, hotspots);

            this.el.route.textContent = `${from.label} → ${to.label}`;
            this.el.title.textContent = this.analysis.ml_available
                ? "Route intelligence"
                : "Weather-only journey";
            this.el.dist.textContent = `${Math.round(this.route.distanceKm)} km`;
            this.el.cov.textContent = `${cov.percent ?? 0}%`;
            this.el.secs.textContent = String(matches.length);
            this.el.risk.textContent = highest
                ? `${Math.round(highest.risk * 100)}% · ${highest.risk_label}`
                : "—";
            this.el.note.textContent =
                this.analysis.note ||
                cov.note ||
                "Coverage uses representative midpoints — not surveyed polylines.";

            this.el.result.classList.add("shown");
            this.el.explore.disabled = !highest;
            this._setStatus(
                this.analysis.ml_available
                    ? "Trained coverage detected"
                    : "No trained coverage on this route",
            );

            // Route Intelligence summary — stay on the map; 3D only via Enter road view.
            this._setStatus("Composing route intelligence");
            try {
                const intel = await journeyIntelligence({ action: "summarize", locale: "en" });
                this.el.intel.innerHTML = formatIntelHtml(intel.answer);
            } catch {
                this.el.intel.textContent =
                    "Route analysis ready. AI briefing temporarily unavailable.";
            }

            if (highest) {
                this._setStatus("Analysis ready · Enter road view for 3D conditions");
            } else {
                this._setStatus(
                    "No trained corridor on this route · stay for weather-only notes, or pick another journey",
                    true,
                );
            }
        } catch (err) {
            console.warn("[kairos] journey analyze failed", err);
            this._setStatus("Journey analysis unavailable", true);
        } finally {
            this.el.analyze.disabled = false;
        }
    }

    async intelAction(action) {
        if (!this.analysis) return;
        if (action === "ask") {
            const q = window.prompt("Ask KAIROS about this journey:");
            if (!q?.trim()) return;
            this._setStatus("Analyzing road conditions");
            try {
                const intel = await journeyIntelligence({
                    action: "ask",
                    message: q.trim(),
                    locale: "en",
                });
                this.el.intel.innerHTML = formatIntelHtml(intel.answer);
                this._setStatus("");
            } catch {
                this._setStatus("AI explanation temporarily unavailable", true);
            }
            return;
        }
        if ((action === "why" || action === "wait" || action === "safest") &&
            !this.analysis.ml_available) {
            this._setStatus("Needs a trained corridor on this route", true);
            return;
        }
        this._setStatus("Analyzing road conditions");
        try {
            const intel = await journeyIntelligence({ action, locale: "en" });
            this.el.intel.innerHTML = formatIntelHtml(intel.answer);
            this._setStatus("");
        } catch {
            this._setStatus("AI explanation temporarily unavailable", true);
        }
    }

    explore() {
        const highest = this.analysis?.highest_risk_segment;
        if (!highest) return;
        const from = PLACES.find((p) => p.id === this.el.from.value);
        const to = PLACES.find((p) => p.id === this.el.to.value);
        this.onExplore?.({
            segmentId: highest.segment_id,
            label: highest.segment_label || highest.segment_id,
            departure: this.el.depart.value || "16:00",
            journeyLabel: `${from?.label || "A"} → ${to?.label || "B"}`,
        });
    }
}
