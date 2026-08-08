/**
 * Historical replay.
 *
 * Plays a recorded day through the same weather director the live prediction
 * drives, so the storm the viewer watches build is produced by exactly the
 * mechanism the forecast uses. That is the argument: BORAN would have said this
 * hours before the barrier went across the road.
 *
 * The replay advances on the render loop's own clock via `update(dt)` rather
 * than on a timer, so it cannot drift away from what is on screen and it stops
 * cleanly when the tab is backgrounded and rAF stops firing.
 */

import {
    CLOSURE_REPLAY, ADVISORY_THRESHOLD,
    hoursOf, clockOf, riskAtHour, thresholdCrossing, durationLabel,
} from "../app/demoData.js";
import { weatherFromRisk } from "../app/weatherState.js";

/** Seconds of wall clock for the whole recorded day. */
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

        const s = CLOSURE_REPLAY.samples;
        this.startHour = hoursOf(s[0].time);
        this.endHour = hoursOf(s[s.length - 1].time);
        this.crossing = thresholdCrossing();
        this.leadTime = this.endHour - this.crossing;

        this.active = false;
        this.hour = this.startHour;

        /** Called when the replay finishes. */
        this.onEnd = null;

        this.el = this.shell.replayEl;
        this.el.start.addEventListener("click", () => this.start());
        this.el.exit.addEventListener("click", () => this.stop());
    }

    start() {
        this.active = true;
        this.hour = this.startHour;
        this.shell.enterReplay(
            CLOSURE_REPLAY,
            (this.crossing - this.startHour) / (this.endHour - this.startHour)
        );
        // Low and close: the whole point is watching the carriageway go.
        this.camera.cut("risk", 4.0);
        this.weather.setTarget(weatherFromRisk(riskAtHour(this.startHour)));
        this._render(0);
    }

    stop() {
        this.active = false;
        this.shell.exitReplay();
        this.camera.cut("landing", 3.2);
        this.weather.setTarget(weatherFromRisk(0.12));
        this.onEnd?.();
    }

    /** @param {number} dt seconds */
    update(dt) {
        if (!this.active) return;
        if (this.hour >= this.endHour) return;

        const span = this.endHour - this.startHour;
        this.hour = Math.min(this.endHour, this.hour + (span / DURATION) * dt);

        const risk = riskAtHour(this.hour);
        this.weather.setTarget(weatherFromRisk(risk));
        this._render(risk);
    }

    _render(risk) {
        const done = this.hour >= this.endHour;
        const progress = (this.hour - this.startHour) / (this.endHour - this.startHour);
        this.shell.updateReplay({
            clock: clockOf(this.hour),
            risk,
            progress,
            crossed: this.hour >= this.crossing,
            note: noteAt(this.hour),
            closed: done,
            closedAt: CLOSURE_REPLAY.closedAt,
            crossingClock: clockOf(this.crossing),
            lead: durationLabel(this.leadTime),
            threshold: ADVISORY_THRESHOLD,
        });
    }
}

/** The most recent annotated sample at or before `hours`. */
function noteAt(hours) {
    const s = CLOSURE_REPLAY.samples;
    let note = "";
    for (let i = 0; i < s.length; i++) {
        if (hoursOf(s[i].time) <= hours && s[i].note) note = s[i].note;
    }
    return note;
}
