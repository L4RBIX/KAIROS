/**
 * The BORAN interface.
 *
 * Plain DOM over the WebGPU canvas. There is no framework here on purpose: the
 * render loop runs at whatever the GPU allows and must not be sharing a main
 * thread with a reconciler, and the interface is a handful of elements whose
 * text changes a few times per interaction. Everything is created once and
 * mutated in place; nothing in this file runs per frame.
 *
 * It owns markup and text only. It does not know what a risk is, does not
 * compute one, and does not touch the renderer — the caller wires `onAnalyze`
 * to whatever produces a prediction.
 */

import { CSS } from "./shell.css.js";

/** Route endpoints the demo offers. */
const CITIES = ["Astana", "Karaganda", "Temirtau", "Osakarovka", "Shchuchinsk"];

export class Shell {
    constructor() {
        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        const root = document.createElement("div");
        root.id = "boran";
        root.innerHTML = MARKUP;
        document.body.appendChild(root);
        this.root = root;

        this.el = {
            from: root.querySelector("#b-from"),
            to: root.querySelector("#b-to"),
            depart: root.querySelector("#b-depart"),
            go: root.querySelector("#b-go"),
            loc: root.querySelector("#b-loc"),
            form: root.querySelector("#b-form"),
            result: root.querySelector("#b-result"),
            route: root.querySelector("#b-route"),
            pct: root.querySelector("#b-pct"),
            band: root.querySelector("#b-band"),
            headline: root.querySelector("#b-headline"),
            detail: root.querySelector("#b-detail"),
            advice: root.querySelector("#b-advice"),
            adviceTime: root.querySelector("#b-advice-time"),
            back: root.querySelector("#b-back"),
            time: root.querySelector("#b-time"),
            timeRead: root.querySelector("#b-time-read"),
        };

        this.replayEl = {
            panel: root.querySelector("#b-replay"),
            date: root.querySelector("#b-rp-date"),
            clock: root.querySelector("#b-rp-clock"),
            risk: root.querySelector("#b-rp-risk"),
            fill: root.querySelector("#b-rp-fill"),
            mark: root.querySelector("#b-rp-mark"),
            note: root.querySelector("#b-rp-note"),
            verdict: root.querySelector("#b-rp-verdict"),
            start: root.querySelector("#b-replay-start"),
            exit: root.querySelector("#b-replay-exit"),
        };

        fillCities(this.el.from, "Astana");
        fillCities(this.el.to, "Karaganda");

        /** @type {((r: {from:string, to:string, departure:string}) => void)|null} */
        this.onAnalyze = null;
        this.el.go.addEventListener("click", () => this.onAnalyze?.(this.route()));

        // A route to nowhere is the one input error worth preventing outright.
        const guard = () => {
            const same = this.el.from.value === this.el.to.value;
            this.el.go.disabled = same;
        };
        this.el.from.addEventListener("change", guard);
        this.el.to.addEventListener("change", guard);
        guard();
    }

    /** The route currently entered. */
    route() {
        return {
            from: this.el.from.value,
            to: this.el.to.value,
            departure: this.el.depart.value,
        };
    }

    /** Fade the interface in. Called once the first frame is actually on screen. */
    reveal() {
        // Two frames: one for the element to exist with its initial style, one
        // for the class change to be a transition rather than an initial value.
        requestAnimationFrame(() => requestAnimationFrame(() => {
            this.root.classList.add("ready");
        }));
    }

    /** @param {string} text */
    setStatus(text) {
        this.el.loc.textContent = text;
    }

    /** Put the button into its working state while a prediction is in flight. */
    setBusy(busy) {
        this.el.go.disabled = busy;
        this.el.go.textContent = busy ? "Analyzing" : "Analyze route";
    }

    /** Fade the route form out. The result takes its place. */
    hideForm() {
        this.el.form.classList.add("b-gone");
    }

    /** Bring the form back and drop the result. */
    showForm() {
        this.el.form.classList.remove("b-gone");
        this.el.result.classList.remove("b-shown");
        this.setBusy(false);
    }

    /**
     * Display a prediction.
     * @param {import("../services/predictionService.js").Prediction} p
     * @param {{from:string, to:string}} route
     */
    showResult(p, route) {
        const e = this.el;
        e.route.textContent = `${route.from} → ${route.to}`;
        e.pct.textContent = Math.round(p.risk * 100) + "%";
        e.band.textContent = p.riskLabel + " risk";
        e.headline.textContent = p.headline;
        e.detail.textContent = p.detail;

        // One accent, spent only on risk. `data-band` drives the colour rather
        // than a class per level, so the CSS stays a table instead of a ladder.
        e.result.dataset.band = p.riskLabel;

        if (p.recommendedDeparture) {
            e.adviceTime.textContent = p.recommendedDeparture;
            e.advice.hidden = false;
        } else {
            e.advice.hidden = true;
        }

        e.result.classList.add("b-shown");
    }

    /**
     * Update only what changes while the departure slider is dragged.
     *
     * Separate from `showResult` on purpose: this runs on every input event, so
     * it writes text nodes and one dataset attribute and nothing else. No layout
     * is read and no class is toggled that could start a transition mid-drag.
     * The route line is left alone because it has not changed.
     *
     * Every piece of copy that depends on risk is updated, including the ones
     * it is tempting to skip. Updating only the headline left "Road expected to
     * stay open." sitting above "Closure is likely within hours of departure."
     * — the product contradicting itself in the same paragraph.
     *
     * @param {import("../services/predictionService.js").Prediction} p
     * @param {string} clock "HH:MM"
     */
    updateScrub(p, clock) {
        const e = this.el;
        e.timeRead.textContent = clock;
        e.pct.textContent = Math.round(p.risk * 100) + "%";
        e.band.textContent = p.riskLabel + " risk";
        e.headline.textContent = p.headline;
        e.detail.textContent = p.detail;
        if (p.recommendedDeparture) {
            e.adviceTime.textContent = p.recommendedDeparture;
            e.advice.hidden = false;
        } else {
            e.advice.hidden = true;
        }
        if (e.result.dataset.band !== p.riskLabel) {
            e.result.dataset.band = p.riskLabel;
        }
    }

    /** Put the slider handle at a departure time without firing its listener. */
    setScrubTime(clock) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(clock || "");
        if (!m) return;
        this.el.time.value = String(+m[1] * 60 + +m[2]);
        this.el.timeRead.textContent = clock;
    }
}

/**
 * Replay mode: the result panel steps aside for the timeline.
 * @param {{label:string, route:{from:string,to:string}}} rec
 */
Shell.prototype.enterReplay = function (rec, markFraction) {
    this.el.result.classList.remove("b-shown");
    this.replayEl.panel.classList.add("b-shown");
    this.replayEl.date.textContent =
        `${rec.route.from} → ${rec.route.to} · ${rec.label}`;
    this.replayEl.verdict.classList.remove("b-shown");
    this.replayEl.panel.dataset.band = "low";
    this.replayEl.mark.dataset.on = "0";
    // Positioned from the data, not from the stylesheet.
    this.replayEl.mark.style.left = (markFraction * 100).toFixed(2) + "%";
    this.setStatus(`Historical replay · ${rec.label}`);
};

Shell.prototype.exitReplay = function () {
    this.replayEl.panel.classList.remove("b-shown");
    this.el.form.classList.remove("b-gone");
    this.setBusy(false);
    this.setStatus("Kazakhstan · winter road network");
};

/**
 * One frame of the replay. Called from the render loop, so it does the least
 * possible: it writes text and one transform, and only touches the classList
 * and dataset when they actually change.
 */
Shell.prototype.updateReplay = function (s) {
    const e = this.replayEl;
    const pct = Math.round(s.risk * 100) + "%";
    if (e.clock.textContent !== s.clock) e.clock.textContent = s.clock;
    if (e.risk.textContent !== pct) e.risk.textContent = pct;
    if (e.note.textContent !== s.note) e.note.textContent = s.note;

    e.fill.style.transform = `scaleX(${s.progress.toFixed(4)})`;

    const band = s.risk < 0.25 ? "low"
        : s.risk < 0.5 ? "moderate"
        : s.risk < 0.75 ? "high"
        : s.risk < 0.9 ? "severe" : "extreme";
    if (e.panel.dataset.band !== band) e.panel.dataset.band = band;

    const crossed = s.crossed ? "1" : "0";
    if (e.mark.dataset.on !== crossed) e.mark.dataset.on = crossed;

    if (s.closed && !e.verdict.classList.contains("b-shown")) {
        e.verdict.innerHTML =
            `<strong>Road closed &middot; ${s.closedAt}</strong>` +
            `<span>BORAN crossed ${Math.round(s.threshold * 100)}% risk at ` +
            `${s.crossingClock} &mdash; <b>${s.lead} earlier</b></span>`;
        e.verdict.classList.add("b-shown");
    }
};

/** Slider units are minutes past midnight. */
export function minutesToClock(mins) {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function fillCities(select, initial) {
    for (const c of CITIES) {
        const o = document.createElement("option");
        o.value = c;
        o.textContent = c;
        select.appendChild(o);
    }
    select.value = initial;
}

const MARKUP = `
<header class="b-top">
    <div class="b-mark b-rise b-d1">BORAN</div>
    <div class="b-loc b-rise b-d1" id="b-loc">Kazakhstan &middot; winter road network</div>
</header>

<section class="b-panel">
    <div id="b-form">
        <h1 class="b-lede b-rise b-d2">
            Know the road<em>before it closes.</em>
        </h1>

        <div class="b-fields b-rise b-d3">
            <div class="b-field">
                <label for="b-from">From</label>
                <select id="b-from"></select>
            </div>
            <div class="b-field">
                <label for="b-to">To</label>
                <select id="b-to"></select>
            </div>
            <div class="b-field">
                <label for="b-depart">Departure</label>
                <input id="b-depart" type="time" value="16:00" step="900" />
            </div>
        </div>

        <div class="b-rise b-d4">
            <button class="b-go" id="b-go">Analyze route</button>
        </div>
    </div>

    <div id="b-result" class="b-result" aria-live="polite">
        <div class="b-route" id="b-route"></div>
        <div class="b-pct" id="b-pct"></div>
        <div class="b-band" id="b-band"></div>
        <p class="b-headline" id="b-headline"></p>
        <p class="b-detail" id="b-detail"></p>
        <p class="b-advice" id="b-advice" hidden>
            Recommended departure <b>before <span id="b-advice-time"></span></b>
        </p>

        <div class="b-scrub">
            <label class="b-scrub-label" for="b-time">
                Departure <b id="b-time-read">16:00</b>
            </label>
            <input class="b-slider" id="b-time" type="range"
                   min="600" max="1200" step="5" value="960"
                   aria-label="Departure time" />
            <div class="b-scrub-ends"><span>10:00</span><span>20:00</span></div>
        </div>

        <div class="b-actions">
            <button class="b-back" id="b-back">Change route</button>
            <button class="b-back" id="b-replay-start">Replay a real closure</button>
        </div>
    </div>

    <div id="b-replay" class="b-replay" aria-live="polite">
        <div class="b-route" id="b-rp-date"></div>
        <div class="b-rp-head">
            <span class="b-rp-clock" id="b-rp-clock">06:00</span>
            <span class="b-rp-risk" id="b-rp-risk">11%</span>
        </div>
        <div class="b-rp-track">
            <div class="b-rp-fill" id="b-rp-fill"></div>
            <div class="b-rp-mark" id="b-rp-mark"><span></span></div>
        </div>
        <div class="b-rp-note" id="b-rp-note"></div>
        <div class="b-rp-verdict" id="b-rp-verdict"></div>
        <button class="b-back" id="b-replay-exit">Exit replay</button>
    </div>
</section>

<footer class="b-foot b-rise b-d5">
    <span>Wind &middot; snowfall &middot; historical closures</span>
    <span>Real-time conditions model</span>
</footer>
`;
