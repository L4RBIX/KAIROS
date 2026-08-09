/**
 * Winter scenario replay.
 *
 * Plays / scrubs an illustrative day through the same weather director the live
 * prediction drives. Not a LightGBM score — demo narrative only.
 *
 * Any calendar date and any clock time (00:00–23:59). Storm onset is randomised
 * per date and sticky within the browser tab.
 */

import {
    ADVISORY_THRESHOLD,
    hoursOf,
    clockOf,
    riskAtHour,
    thresholdCrossing,
    durationLabel,
    buildScenarioForDate,
    sessionScenarioDate,
    rememberScenarioDate,
    WINTER_SCENARIOS,
} from "../app/demoData.js";
import { weatherFromRisk } from "../app/weatherState.js";

/** Seconds of wall clock for a full autoplay pass of the day. */
const DURATION = 24;

const DAY_START = 0;
const DAY_END = 23 + 59 / 60;

export class Replay {
    /**
     * @param {{
     *   shell: import("./shell.js").Shell,
     *   weather: import("../app/weatherDirector.js").WeatherDirector,
     *   camera: import("../app/cinematicCamera.js").CinematicCamera,
     * }} deps
     */
    constructor(deps) {
        this.shell = deps.shell;
        this.weather = deps.weather;
        this.camera = deps.camera;

        this.scenario = buildScenarioForDate(sessionScenarioDate());
        this._bindScenario(this.scenario);

        this.active = false;
        this.playing = false;
        this.hour = this.startHour;

        /** Called when the replay finishes. */
        this.onEnd = null;

        this.el = this.shell.replayEl;
        this.el.start.addEventListener("click", () => this.start());
        this.el.exit.addEventListener("click", () => this.stop());

        this.shell.initWinterDateControl?.(this.scenario.date);
        this.el.datePick?.addEventListener("change", () => {
            const date = this.el.datePick.value || sessionScenarioDate();
            rememberScenarioDate(date);
            this.setDate(date, { restartClock: true });
        });
        this.el.timePick?.addEventListener("change", () => {
            if (!this.active) return;
            const raw = this.el.timePick.value || "00:00";
            this.seek(hoursOf(raw.length === 5 ? raw : raw.slice(0, 5)));
            this.pause();
        });
        this.el.timePick?.addEventListener("input", () => {
            if (!this.active) return;
            const raw = this.el.timePick.value || "00:00";
            this.seek(hoursOf(raw.length === 5 ? raw : raw.slice(0, 5)));
            this.pause();
        });
        this.el.scrub?.addEventListener("input", () => {
            if (!this.active) return;
            this.seek((+this.el.scrub.value) / 60);
            this.pause();
        });
        this.el.play?.addEventListener("click", () => {
            if (!this.active) return;
            if (this.playing) this.pause();
            else this.resume();
        });
    }

    /** @param {import("../app/demoData.js").WinterScenario} scenario */
    _bindScenario(scenario) {
        this.scenario = scenario;
        this.startHour = DAY_START;
        this.endHour = DAY_END;
        this.crossing = thresholdCrossing(scenario.samples);
        this.leadTime = this.endHour - this.crossing;
    }

    /**
     * @param {string} dateISO
     * @param {{ restartClock?: boolean }} [opts]
     */
    setDate(dateISO, opts = {}) {
        this._bindScenario(buildScenarioForDate(dateISO));
        if (!this.active) return;

        if (opts.restartClock) this.hour = this.startHour;
        else {
            this.hour = Math.min(this.endHour, Math.max(this.startHour, this.hour));
        }

        this.shell.enterReplay(
            this.scenario,
            (this.crossing - this.startHour) / (this.endHour - this.startHour),
        );
        this._syncControls();
        const risk = riskAtHour(this.hour, this.scenario.samples);
        this.weather.setTarget(weatherFromRisk(risk));
        this._render(risk);
        this.camera.cut("risk", 2.6);
    }

    /** @deprecated kept for any callers still switching presets */
    setScenario(scenario, opts = {}) {
        const date = scenario?.date || sessionScenarioDate();
        this.setDate(date, opts);
    }

    start() {
        const date = this.el.datePick?.value || sessionScenarioDate(WINTER_SCENARIOS[0].date);
        this._bindScenario(buildScenarioForDate(date));
        this.active = true;
        this.playing = true;
        this.hour = this.startHour;
        if (this.el.datePick) this.el.datePick.value = this.scenario.date;
        this.shell.enterReplay(
            this.scenario,
            (this.crossing - this.startHour) / (this.endHour - this.startHour),
        );
        this._syncControls();
        this._setPlayLabel();
        this.camera.cut("risk", 4.0);
        this.weather.setTarget(
            weatherFromRisk(riskAtHour(this.startHour, this.scenario.samples)),
        );
        this._render(riskAtHour(this.startHour, this.scenario.samples));
    }

    stop() {
        this.active = false;
        this.playing = false;
        this.shell.exitReplay();
        this.camera.cut("landing", 3.2);
        this.weather.setTarget(weatherFromRisk(0.12));
        this.onEnd?.();
    }

    pause() {
        this.playing = false;
        this._setPlayLabel();
    }

    resume() {
        if (this.hour >= this.endHour) this.hour = this.startHour;
        this.playing = true;
        this._setPlayLabel();
    }

    /** @param {number} hours decimal hours */
    seek(hours) {
        this.hour = Math.min(this.endHour, Math.max(this.startHour, hours));
        const risk = riskAtHour(this.hour, this.scenario.samples);
        this.weather.setTarget(weatherFromRisk(risk));
        this._render(risk);
        this._syncControls({ fromSeek: true });
    }

    /** @param {number} dt seconds */
    update(dt) {
        if (!this.active || !this.playing) return;
        if (this.hour >= this.endHour) {
            this.playing = false;
            this._setPlayLabel();
            return;
        }

        const span = this.endHour - this.startHour;
        this.hour = Math.min(this.endHour, this.hour + (span / DURATION) * dt);

        const risk = riskAtHour(this.hour, this.scenario.samples);
        this.weather.setTarget(weatherFromRisk(risk));
        this._render(risk);
        this._syncControls();
    }

    _syncControls(opts = {}) {
        const clock = clockOf(this.hour);
        if (this.el.scrub) {
            const min = 0;
            const max = 23 * 60 + 59;
            if (+this.el.scrub.min !== min) this.el.scrub.min = String(min);
            if (+this.el.scrub.max !== max) this.el.scrub.max = String(max);
            if (!opts.fromSeek) {
                this.el.scrub.value = String(Math.round(this.hour * 60));
            }
        }
        if (this.el.timeRead) this.el.timeRead.textContent = clock;
        if (this.el.timePick && document.activeElement !== this.el.timePick) {
            this.el.timePick.value = clock;
        }
        if (this.el.datePick && this.scenario.date) {
            this.el.datePick.value = this.scenario.date;
        }
        if (this.el.scrubEnds) {
            this.el.scrubEnds.innerHTML = `<span>00:00</span><span>23:59</span>`;
        }
    }

    _setPlayLabel() {
        if (!this.el.play) return;
        this.el.play.textContent = this.playing ? "Pause" : "Play";
    }

    _render(risk) {
        const closedHour = hoursOf(this.scenario.closedAt);
        const done = this.hour >= closedHour || risk >= 0.95;
        const progress =
            (this.hour - this.startHour) / (this.endHour - this.startHour);
        this.shell.updateReplay({
            clock: clockOf(this.hour),
            risk,
            progress,
            crossed: this.hour >= this.crossing,
            note: noteAt(this.hour, this.scenario.samples),
            closed: done,
            closedAt: this.scenario.closedAt,
            crossingClock: clockOf(this.crossing),
            lead: durationLabel(closedHour - this.crossing),
            threshold: ADVISORY_THRESHOLD,
        });
    }
}

/** The most recent annotated sample at or before `hours`. */
function noteAt(hours, samples) {
    let note = "";
    for (let i = 0; i < samples.length; i++) {
        if (hoursOf(samples[i].time) <= hours && samples[i].note) {
            note = samples[i].note;
        }
    }
    return note;
}
