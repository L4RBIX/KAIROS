/**
 * The analyse sequence.
 *
 * Slider → predictLocal() → weather only. Never DeepSeek. Never /api/predict
 * while dragging.
 */

import {
    predict,
    predictLocal,
    getPredictionMode,
    getCachedCurve,
} from "../services/predictionService.js";
import { askCopilot } from "../services/copilotService.js";
import { createWeatherState } from "../app/weatherState.js";
import { minutesToClock } from "./shell.js";

const T_WEATHER = 1500;
const T_RESULT = 3200;
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
        this.current = null;
        this.route = null;
        this.scrubClock = null;
        this.onResult = null;

        this.shell.onAnalyze = (route) => this.run(route);
        this.shell.el.back.addEventListener("click", () => this.reset());

        this.shell.el.time.addEventListener("input", (e) => {
            if (!this.route) return;
            const clock = minutesToClock(+e.target.value);
            const p = predictLocal({
                segmentId: this.route.segmentId,
                label: this.route.label,
                departure: clock,
            });
            this.current = p;
            this.scrubClock = clock;
            this.shell.updateScrub(p, clock);
            this.weather.setTarget(weatherFor(p));
            this.shell.setStatus(`${this.route.label} · departing ${clock}`);
        });

        // Copilot: only on explicit user actions.
        this.shell.onCopilotAsk = (message, extras = {}) =>
            this.askCopilot(message, extras);
        this.shell.onWinterReplay = () => {
            this.shell.replayEl.start?.click();
        };
    }

    cancel() {
        for (const t of this._timers) clearTimeout(t);
        this._timers.length = 0;
    }

    _after(ms, fn) {
        this._timers.push(setTimeout(fn, ms));
    }

    /**
     * @param {{segmentId:string, label:string, departure:string}} route
     */
    async run(route) {
        this.cancel();
        this.route = route;
        this.shell.setBusy(true);
        this.shell.setStatus("Analysing corridor conditions");
        this.shell.closeCopilot();

        this.camera.cut("route", CAM_MOVE);
        this.shell.hideForm();

        let prediction;
        try {
            prediction = await predict({
                segmentId: route.segmentId,
                label: route.label,
                departure: route.departure,
            });
            this.shell.setPredictionMode(getPredictionMode());
        } catch (err) {
            console.error("[kairos] prediction failed", err);
            this.shell.setPredictionMode(
                "fallback",
                "Live ML temporarily unavailable · demo fallback"
            );
            this.shell.setStatus("Prediction unavailable · try again");
            this.shell.showForm();
            return;
        }

        this.current = prediction;
        this.scrubClock = route.departure;

        this._after(T_WEATHER, () => {
            this.weather.setTarget(weatherFor(prediction));
            if (
                prediction.winterHazardActive !== false &&
                prediction.risk >= 0.6
            ) {
                this.camera.cut("risk", 4.2);
            }
        });

        this._after(T_RESULT, () => {
            this.shell.showResult(prediction, route);
            this.shell.setScrubTime(route.departure);
            this.shell.setStatus(
                `${route.label} · departing ${route.departure}`
            );
            this.onResult?.(prediction, route);
        });
    }

    /**
     * @param {string} message
     * @param {{ compareTimes?: string[] }} [extras]
     */
    async askCopilot(message, extras = {}) {
        if (!this.route || !this.current) return;
        const departure = this.scrubClock || this.route.departure;
        const locale = this.shell.getCopilotLocale();
        const profile = this.shell.getCopilotProfile();

        let compareTimes = extras.compareTimes || [];
        if (!compareTimes.length && /compare|сравн|салыстыр/i.test(message)) {
            const curve = getCachedCurve()?.curve || [];
            if (curve.length >= 2) {
                const mid = curve[Math.floor(curve.length * 0.35)]?.time;
                compareTimes = [mid || "14:00", departure].filter(Boolean);
            }
        }

        this.shell.setCopilotBusy(true);
        try {
            const res = await askCopilot({
                message,
                segmentId: this.route.segmentId,
                departure,
                locale,
                profile,
                compareTimes,
                segmentLabel: this.route.label,
            });
            this.shell.showCopilotAnswer(res.answer, res.available !== false);
        } catch (err) {
            console.warn("[kairos] copilot unavailable", err);
            this.shell.showCopilotAnswer(
                "AI explanation temporarily unavailable.",
                false
            );
        } finally {
            this.shell.setCopilotBusy(false);
        }
    }

    reset() {
        this.cancel();
        this.current = null;
        this.scrubClock = null;
        this.shell.closeCopilot();
        this.shell.showForm();
        this.shell.setStatus("Kazakhstan · winter road network");
        this.camera.cut("landing", 3.0);
        this.weather.setTarget(weatherFor({
            risk: 0.12, windSpeed: 4, snowfall: 0.3,
            visibility: 860, temperature: -9,
            winterHazardActive: true,
        }));
        this.onResult?.(null, null);
    }
}

/**
 * Map prediction → weather for the director.
 *
 * When live winter hazard is inactive, keep the scene calm. The real LightGBM
 * score stays on screen — only the visual severity is restrained.
 */
export function weatherFor(p) {
    const calmLive = p.winterHazardActive === false;
    return createWeatherState({
        risk: calmLive ? Math.min(0.07, (p.risk || 0) * 0.12) : p.risk,
        windSpeed: calmLive ? Math.min(p.windSpeed || 4, 5.5) : p.windSpeed,
        snowfall: calmLive ? 0 : p.snowfall,
        visibility: calmLive ? Math.max(p.visibility || 0, 16000) : p.visibility,
        temperature: p.temperature,
    });
}
