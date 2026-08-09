/**
 * The prediction boundary.
 *
 * When `VITE_ML_API_URL` is set, Analyse uses the live LightGBM backend and
 * caches its risk curve. The departure scrubber stays on `predictLocal`, which
 * interpolates that curve synchronously — never an HTTP call per slider tick.
 * Copilot / DeepSeek is never reached from this file.
 */

import {
    predict as mockPredict,
    evaluate as mockEvaluate,
} from "./mockPredictionService.js";
import * as real from "./realPredictionService.js";

/**
 * @typedef {{
 *   origin?: string,
 *   destination?: string,
 *   segmentId?: string,
 *   label?: string,
 *   departure: string,
 * }} RouteQuery
 */

/**
 * @typedef {{
 *   risk: number,
 *   riskLabel: string,
 *   windSpeed: number,
 *   windGusts: number,
 *   snowfall: number,
 *   visibility: number,
 *   temperature: number,
 *   recommendedDeparture: string,
 *   headline: string,
 *   detail: string,
 *   source?: string,
 *   rawModelRisk?: number,
 *   applicability?: "active"|"inactive"|string,
 *   applicabilityReason?: string,
 *   winterHazardActive?: boolean,
 *   seasonalContext?: string,
 *   seasonalReason?: string,
 *   oodCaution?: boolean,
 *   assessment?: {
 *     verdict: string,
 *     title: string,
 *     summary: string,
 *     bestWindow: string,
 *     primaryConcerns: string[],
 *     quickPrompts: string[],
 *   },
 * }} Prediction
 */

/** @type {"live"|"fallback"|"unknown"} */
export let predictionMode = "unknown";

/**
 * @param {any} raw
 * @returns {Prediction}
 */
export function normalise(raw) {
    const seasonal = raw.seasonal || {};
    const assessment = raw.assessment || null;
    const applicability =
        raw.applicability ??
        seasonal.applicability ??
        (seasonal.winter_hazard_active === false ||
        raw.winterHazardActive === false ||
        raw.winter_hazard_active === false
            ? "inactive"
            : "active");
    return {
        risk: Number(raw.risk) || 0,
        rawModelRisk: Number(
            raw.raw_model_risk ?? raw.rawModelRisk ?? raw.risk,
        ) || 0,
        riskLabel: raw.risk_label ?? raw.riskLabel ?? "",
        applicability,
        applicabilityReason:
            raw.applicability_reason ??
            seasonal.applicability_reason ??
            seasonal.reason ??
            raw.applicabilityReason ??
            "",
        windSpeed: Number(raw.wind_speed ?? raw.windSpeed) || 0,
        windGusts: Number(raw.wind_gusts ?? raw.windGusts ?? raw.wind_speed ?? raw.windSpeed) || 0,
        snowfall: Number(raw.snowfall) || 0,
        visibility: Number(raw.visibility) || 0,
        temperature: Number(raw.temperature) || 0,
        recommendedDeparture:
            raw.recommended_departure ?? raw.recommendedDeparture ?? "",
        headline: raw.headline ?? "",
        detail: raw.detail ?? "",
        source: raw.source ?? "",
        winterHazardActive:
            seasonal.winter_hazard_active ??
            raw.winterHazardActive ??
            raw.winter_hazard_active ??
            applicability !== "inactive",
        seasonalContext:
            seasonal.seasonal_context ??
            raw.seasonalContext ??
            "",
        seasonalReason: seasonal.reason ?? raw.seasonalReason ?? "",
        oodCaution: Boolean(seasonal.ood_caution ?? raw.oodCaution),
        assessment: assessment
            ? {
                verdict: assessment.verdict,
                title: assessment.title,
                summary: assessment.summary,
                bestWindow: assessment.best_window ?? assessment.bestWindow ?? "",
                primaryConcerns:
                    assessment.primary_concerns ?? assessment.primaryConcerns ?? [],
                quickPrompts:
                    assessment.quick_prompts ?? assessment.quickPrompts ?? [],
            }
            : undefined,
    };
}

/** @type {(q: RouteQuery) => Promise<Prediction>} */
let impl = mockPredict;

/** @param {(q: RouteQuery) => Promise<Prediction>} fn */
export function setPredictionService(fn) {
    impl = fn;
}

/**
 * @param {RouteQuery} query
 * @returns {Prediction}
 */
export function predictLocal(query) {
    if (real.getCachedCurve()) {
        try {
            return normalise(real.evaluateLocal(query));
        } catch (err) {
            console.warn("[kairos] local ML interpolate failed, using mock", err);
        }
    }
    return normalise(mockEvaluate({
        origin: query.origin || query.segmentId || "A",
        destination: query.destination || query.label || "B",
        departure: query.departure,
    }));
}

/**
 * @param {RouteQuery} query
 * @returns {Promise<Prediction>}
 */
export async function predict(query) {
    const base = real.getApiBase();
    if (base) {
        try {
            const p = normalise(await real.predict(query));
            predictionMode = "live";
            return p;
        } catch (err) {
            console.warn("[kairos] live ML unavailable · demo fallback", err);
            predictionMode = "fallback";
            real.setMlStatus("fallback");
            real.clearCache();
            const mock = await mockPredict({
                origin: query.origin || query.segmentId || "A",
                destination: query.destination || query.label || "B",
                departure: query.departure,
            });
            return normalise({ ...mock, source: "demo-fallback" });
        }
    }
    predictionMode = "fallback";
    return normalise(await impl(query));
}

export async function loadSegments() {
    if (!real.getApiBase()) return null;
    try {
        return await real.fetchSegments();
    } catch (err) {
        console.warn("[kairos] segment catalog unavailable", err);
        return null;
    }
}

export function getPredictionMode() {
    return predictionMode;
}

/** Cached ML curve for Copilot compare-times (no network). */
export function getCachedCurve() {
    return real.getCachedCurve();
}
