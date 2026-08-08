/**
 * The prediction boundary.
 *
 * Everything upstream of this file is product and rendering; everything
 * downstream is a model. The visualisation must not be able to tell which
 * implementation answered, which is why the shape below is the *only* contract
 * and why the mock is a peer of the real service rather than a special case
 * inside it.
 *
 * The wire format the backend will eventually speak is snake_case
 * (`wind_speed`, `recommended_departure`, `risk_label`). Normalising it happens
 * here, at the edge, so exactly one file changes when that endpoint appears and
 * nothing in `product/` or `app/` ever sees a raw response.
 */

import {
    predict as mockPredict,
    evaluate as mockEvaluate,
} from "./mockPredictionService.js";

/**
 * @typedef {{
 *   origin: string,
 *   destination: string,
 *   departure: string,   "HH:MM"
 * }} RouteQuery
 */

/**
 * @typedef {{
 *   risk: number,                 0..1
 *   riskLabel: string,
 *   windSpeed: number,            m/s
 *   snowfall: number,             mm/h
 *   visibility: number,           metres
 *   temperature: number,          degrees C
 *   recommendedDeparture: string, "HH:MM", or "" when leaving now is fine
 *   headline: string,
 *   detail: string,
 * }} Prediction
 */

/**
 * Normalise a backend response into the shape the product uses.
 * Exported because the real service will need exactly this and nothing else.
 * @param {any} raw
 * @returns {Prediction}
 */
export function normalise(raw) {
    return {
        risk: Number(raw.risk) || 0,
        riskLabel: raw.risk_label ?? raw.riskLabel ?? "",
        windSpeed: Number(raw.wind_speed ?? raw.windSpeed) || 0,
        snowfall: Number(raw.snowfall) || 0,
        visibility: Number(raw.visibility) || 0,
        temperature: Number(raw.temperature) || 0,
        recommendedDeparture:
            raw.recommended_departure ?? raw.recommendedDeparture ?? "",
        headline: raw.headline ?? "",
        detail: raw.detail ?? "",
    };
}

/**
 * The active implementation.
 *
 * Swapping this for a `fetch`-backed service is the whole of the integration
 * work; no caller changes. See `mockPredictionService.js` for the contract it
 * has to satisfy.
 *
 * @type {(q: RouteQuery) => Promise<Prediction>}
 */
let impl = mockPredict;

/** @param {(q: RouteQuery) => Promise<Prediction>} fn */
export function setPredictionService(fn) {
    impl = fn;
}

/**
 * A synchronous local estimate, for continuous scrubbing.
 *
 * Explicitly *not* `impl`. The departure slider recomputes on every input
 * event, and awaiting a network round trip per event would either lag the drag
 * or race itself; debouncing would break the one thing the interaction exists
 * for, which is watching the road change while the handle moves.
 *
 * With a real backend this stays a local function. The integration is to fetch
 * the risk curve once per route — the response already describes a day — and
 * interpolate it here, rather than to make this call out.
 *
 * @param {RouteQuery} query
 * @returns {Prediction}
 */
export function predictLocal(query) {
    return normalise(mockEvaluate(query));
}

/**
 * Ask for a prediction.
 *
 * Normalisation happens here rather than in each implementation, so a service
 * may answer in the backend's own wire format and still satisfy the contract.
 *
 * @param {RouteQuery} query
 * @returns {Promise<Prediction>}
 */
export async function predict(query) {
    return normalise(await impl(query));
}
