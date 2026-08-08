/**
 * The analyse sequence.
 *
 * One place decides how a prediction becomes an experience: what the camera
 * does, when the storm starts arriving, and when the number appears. Spreading
 * that across the shell, the camera and the weather director would mean the
 * timing lived in three files and could only be tuned by reading all three.
 *
 * ## The timing, and why it is in this order
 *
 * The storm is deliberately started *before* the number is shown. If the result
 * lands first, the viewer reads "82%" and then watches some weather; the weather
 * becomes an illustration of a number they have already accepted. Started first,
 * they watch the road begin to disappear and the number arrives as the
 * explanation for something they have already felt. That ordering is the whole
 * difference between a dashboard with a nice background and a product whose
 * environment is the argument.
 *
 *   0.0s  form fades, camera begins its move toward the carriageway
 *   0.6s  prediction resolves (held)
 *   1.5s  weather target set — the storm starts arriving, slowly
 *   3.2s  camera settles; the risk figure fades up
 *
 * Nothing here polls. Each step is a timer, and `cancel()` drops them all so a
 * second analyse cannot interleave with the first.
 */

import { predict, predictLocal } from "../services/predictionService.js";
import { createWeatherState } from "../app/weatherState.js";
import { minutesToClock } from "./shell.js";

/** Milliseconds from the button to each beat of the sequence. */
const T_WEATHER = 1500;
const T_RESULT = 3200;
/** Seconds the camera takes to reach the carriageway. */
const CAM_MOVE = 3.4;

export class RouteFlow {
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

        /** @type {number[]} */
        this._timers = [];
        /** The prediction currently on screen, if any. */
        this.current = null;
        /** The route it was made for. */
        this.route = null;

        /** Fired once a result is on screen. The slider hangs off this. */
        this.onResult = null;

        this.shell.onAnalyze = (route) => this.run(route);
        this.shell.el.back.addEventListener("click", () => this.reset());

        // The departure scrubber. This is the interaction the demo turns on, so
        // it is wired straight through with nothing in the way: input event ->
        // synchronous local estimate -> weather target. The director's own
        // easing does the smoothing, so dragging fast chases rather than snaps
        // and there is no debounce to make the road lag the handle.
        this.shell.el.time.addEventListener("input", (e) => {
            if (!this.route) return;
            const clock = minutesToClock(+e.target.value);
            const p = predictLocal({
                origin: this.route.from,
                destination: this.route.to,
                departure: clock,
            });
            this.current = p;
            this.scrubClock = clock;
            this.shell.updateScrub(p, clock);
            this.weather.setTarget(weatherFor(p));
            this.shell.setStatus(
                `${this.route.from} → ${this.route.to} · departing ${clock}`
            );
        });
    }

    /** Drop every pending step. */
    cancel() {
        for (const t of this._timers) clearTimeout(t);
        this._timers.length = 0;
    }

    _after(ms, fn) {
        this._timers.push(setTimeout(fn, ms));
    }

    /**
     * Run the sequence for a route.
     * @param {{from:string, to:string, departure:string}} route
     */
    async run(route) {
        this.cancel();
        this.route = route;
        this.shell.setBusy(true);
        this.shell.setStatus("Analysing route conditions");

        // The camera starts moving immediately — before the answer is back. It
        // is establishing the subject, and it would be establishing it either
        // way, so there is no reason to make the viewer wait for a round trip.
        this.camera.cut("route", CAM_MOVE);
        this.shell.hideForm();

        let prediction;
        try {
            prediction = await predict({
                origin: route.from,
                destination: route.to,
                departure: route.departure,
            });
        } catch (err) {
            console.error("[boran] prediction failed", err);
            this.shell.setStatus("Prediction unavailable");
            this.shell.showForm();
            return;
        }

        this.current = prediction;

        this._after(T_WEATHER, () => {
            this.weather.setTarget(weatherFor(prediction));
            // A severe forecast drops the camera to the surface, where the
            // carriageway fills the frame and snow closing over it is the
            // subject rather than a detail in the middle distance.
            if (prediction.risk >= 0.6) this.camera.cut("risk", 4.2);
        });

        this._after(T_RESULT, () => {
            this.shell.showResult(prediction, route);
            // Park the handle on the time that was actually asked for, so the
            // first drag continues from the answer rather than jumping.
            this.shell.setScrubTime(route.departure);
            this.shell.setStatus(
                `${route.from} → ${route.to} · departing ${route.departure}`
            );
            this.onResult?.(prediction, route);
        });
    }

    /** Back to the landing state. */
    reset() {
        this.cancel();
        this.current = null;
        this.shell.showForm();
        this.shell.setStatus("Kazakhstan · winter road network");
        this.camera.cut("landing", 3.0);
        this.weather.setTarget(weatherFor({
            risk: 0.12, windSpeed: 4, snowfall: 0.3,
            visibility: 860, temperature: -9,
        }));
        this.onResult?.(null, null);
    }
}

/**
 * A prediction, as weather.
 *
 * The prediction already carries physical conditions, so this is a field copy
 * rather than a model — which is the point of the boundary. When the real
 * service starts returning measured values instead of derived ones, nothing
 * here changes.
 */
export function weatherFor(p) {
    return createWeatherState({
        risk: p.risk,
        windSpeed: p.windSpeed,
        snowfall: p.snowfall,
        visibility: p.visibility,
        temperature: p.temperature,
    });
}
