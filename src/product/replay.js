/**
 * Winter scenario replay.
 *
 * Plays / scrubs an illustrative recorded day through the same weather director
 * the live prediction drives. Not a LightGBM score — demo narrative only.
 *
 * Advances on the render loop when playing. Date + time can be changed by the
 * user without leaving the cinematic scene.
 */

import {
    WINTER_SCENARIOS,
    ADVISORY_THRESHOLD,
    hoursOf,
    clockOf,
    riskAtHour,
    thresholdCrossing,
    durationLabel,
    scenarioById,
    resolveScenario,
} from "../app/demoData.js";
import { weatherFromRisk } from "../app/weatherState.js";

/** Seconds of wall clock for a full autoplay pass of the recorded window. */
const DURATION = 20;

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

        // Session-stable onset: random per scenario id, sticky in this tab.
        this.scenario = resolveScenario(WINTER_SCENARIOS[0]);
        this._bindScenario(this.scenario);

        this.active = false;
        this.playing = false;
        this.hour = this.startHour;

        /** Called when the replay finishes. */
        this.onEnd = null;

        this.el = this.shell.replayEl;
        this.el.start.addEventListener("click", () => this.start());
        this.el.exit.addEventListener("click", () => this.stop());

        this.shell.populateWinterScenarios?.(WINTER_SCENARIOS);
        this.el.datePick?.addEventListener("change", () => {
            const next = resolveScenario(scenarioById(this.el.datePick.value));
            this.setScenario(next, { restartClock: true });
        });
        this.el.scrub?.addEventListener("input", () => {
            if (!this.active) return;
            const mins = +this.el.scrub.value;
            this.seek(mins / 60);
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
        const s = scenario.samples;
        this.startHour = hoursOf(s[0].time);
        this.endHour = hoursOf(s[s.length - 1].time);
        this.crossing = thresholdCrossing(s);
        this.leadTime = this.endHour - this.crossing;
    }

    /**
     * @param {import("../app/demoData.js").WinterScenario} scenario
     * @param {{ restartClock?: boolean }} [opts]
     */
    setScenario(scenario, opts = {}) {
        this._bindScenario(resolveScenario(scenario));
        if (!this.active) return;

        if (opts.restartClock) this.hour = this.startHour;
        else {
            this.hour = Math.min(
                this.endHour,
                Math.max(this.startHour, this.hour),
            );
        }

        this.shell.enterReplay(
            this.scenario,
            (this.crossing - this.startHour) / (this.endHour - this.startHour),
        );
        this._syncControls();
        const risk = riskAtHour(this.hour, this.scenario.samples);
        this.weather.setTarget(weatherFromRisk(risk));
        this._render(risk);
        // Soft camera settle when switching days mid-scenario.
        this.camera.cut("risk", 2.6);
    }

    start() {
        // Re-resolve so a prior session pick is reused; never re-roll mid-window.
        this._bindScenario(resolveScenario(this.scenario.id));
        this.active = true;
        this.playing = true;
        this.hour = this.startHour;
        if (this.el.datePick) this.el.datePick.value = this.scenario.id;
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
        if (!this.el.scrub) return;
        const min = Math.round(this.startHour * 60);
        const max = Math.round(this.endHour * 60);
        if (+this.el.scrub.min !== min) this.el.scrub.min = String(min);
        if (+this.el.scrub.max !== max) this.el.scrub.max = String(max);
        if (!opts.fromSeek) {
            this.el.scrub.value = String(Math.round(this.hour * 60));
        }
        if (this.el.timeRead) {
            this.el.timeRead.textContent = clockOf(this.hour);
        }
        if (this.el.scrubEnds) {
            this.el.scrubEnds.innerHTML =
                `<span>${clockOf(this.startHour)}</span><span>${clockOf(this.endHour)}</span>`;
        }
    }

    _setPlayLabel() {
        if (!this.el.play) return;
        this.el.play.textContent = this.playing ? "Pause" : "Play";
    }

    _render(risk) {
        const done = this.hour >= this.endHour;
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
            lead: durationLabel(this.leadTime),
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
