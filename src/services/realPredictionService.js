/**
 * Live ML prediction service.
 *
 * One HTTP round-trip per Analyse fetches the day's risk curve. The departure
 * scrubber then calls `evaluateLocal` synchronously and never hits the network.
 */

const API_BASE = (import.meta.env.VITE_ML_API_URL || "").replace(/\/$/, "");

/** Offline-safe catalog matching the trained model (labels only; no coords). */
export const DEFAULT_SEGMENTS = [
    { segment_id: "KAZ06__KM_1240_1362", label: "KAZ-06 · км 1240–1362" },
    { segment_id: "ALMATY_TASHKENT_TERMEZ__KM_159_238", label: "Алматы–Ташкент–Термез · км 159–238" },
    { segment_id: "ALMATY_TASHKENT_TERMEZ__KM_534_593", label: "Алматы–Ташкент–Термез · км 534–593" },
    { segment_id: "ALMATY_TASHKENT_TERMEZ__KM_143_214", label: "Алматы–Ташкент–Термез · км 143–214" },
    { segment_id: "KAZ14__KM_12_216", label: "KAZ-14 · км 12–216" },
    { segment_id: "MOMYSHULY_KOLTOGAN__KM_10_76", label: "Б. Момышулы–Кольтоган · км 10–76" },
    { segment_id: "KAZ06__KM_1474_1806", label: "KAZ-06 · км 1474–1806" },
];

/** @type {null | {
 *   segmentId: string,
 *   label: string,
 *   curve: Array<{time:string,risk:number,wind_speed:number,snowfall:number,visibility:number,temperature:number}>,
 *   meta: { medium_risk_threshold?: number, high_risk_threshold?: number },
 *   seasonal?: any,
 *   assessment?: any,
 *   wind_gusts?: number,
 * }} */
let cached = null;

/** @type {"live"|"fallback"|"unknown"} */
export let mlStatus = "unknown";

export function setMlStatus(status) {
    mlStatus = status;
}

export function getApiBase() {
    return API_BASE;
}

export function getCachedCurve() {
    return cached;
}

export function clearCache() {
    cached = null;
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function api(path, init) {
    if (!API_BASE) {
        throw new Error("VITE_ML_API_URL is not set");
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25000);
    try {
        const res = await fetch(`${API_BASE}${path}`, {
            ...init,
            signal: ctrl.signal,
            headers: {
                "Content-Type": "application/json",
                ...(init?.headers || {}),
            },
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`ML API ${res.status}: ${text || res.statusText}`);
        }
        return res.json();
    } finally {
        clearTimeout(t);
    }
}

function toMinutes(hhmm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
    if (!m) return 16 * 60;
    return (+m[1]) * 60 + (+m[2]);
}

/**
 * @param {{ departure: string }} query
 */
export function evaluateLocal(query) {
    if (!cached?.curve?.length) {
        throw new Error("no ML curve cached");
    }
    const mins = toMinutes(query.departure);
    const timed = cached.curve.map((p) => ({ ...p, m: toMinutes(p.time) }))
        .sort((a, b) => a.m - b.m);

    let lo = timed[0];
    let hi = timed[timed.length - 1];
    if (mins <= lo.m) {
        hi = lo;
    } else if (mins >= hi.m) {
        lo = hi;
    } else {
        for (let i = 0; i < timed.length - 1; i++) {
            if (mins >= timed[i].m && mins <= timed[i + 1].m) {
                lo = timed[i];
                hi = timed[i + 1];
                break;
            }
        }
    }

    const span = Math.max(1, hi.m - lo.m);
    const t = hi === lo ? 0 : (mins - lo.m) / span;
    const lerp = (a, b) => a + (b - a) * t;

    const risk = lerp(lo.risk, hi.risk);
    const medium = cached.meta?.medium_risk_threshold ?? 0.28399814979606014;
    const high = cached.meta?.high_risk_threshold ?? 0.516360272356473;
    let risk_label = "low";
    if (risk >= high) risk_label = "high";
    else if (risk >= medium) risk_label = "moderate";

    const wind_speed = lerp(lo.wind_speed, hi.wind_speed);
    const snowfall = lerp(lo.snowfall, hi.snowfall);
    const visibility = lerp(lo.visibility, hi.visibility);
    const temperature = lerp(lo.temperature, hi.temperature);
    const seasonal = cached.seasonal || {
        winter_hazard_active: true,
        seasonal_context: "unknown",
        reason: "",
        ood_caution: false,
    };

    let recommended_departure = "";
    if (risk >= high) {
        let lastSafe = null;
        for (const p of timed) {
            if (p.m > mins) break;
            if (p.risk < high) lastSafe = p;
            else if (lastSafe) break;
        }
        if (lastSafe) recommended_departure = lastSafe.time;
    }

    const winter = !!seasonal.winter_hazard_active;
    let headline;
    let detail;
    if (!winter) {
        headline = "Winter hazard inactive under current conditions.";
        detail =
            (seasonal.reason || "No snow or freezing conditions in the current forecast.") +
            ` Live weather along the corridor. Model score ${Math.round(risk * 100)}%.`;
    } else if (risk_label === "high") {
        headline = "High risk of closure or restriction.";
        detail = `KAIROS risk score ${Math.round(risk * 100)}%. Wind ${wind_speed.toFixed(0)} m/s, snowfall ${snowfall.toFixed(1)} mm/h, visibility ~${Math.round(visibility)} m.`;
    } else if (risk_label === "moderate") {
        headline = "Conditions are deteriorating.";
        detail = `KAIROS risk score ${Math.round(risk * 100)}%. Live weather along the selected corridor.`;
    } else {
        headline = "Road conditions are currently below the warning threshold.";
        detail = `KAIROS risk score ${Math.round(risk * 100)}%. Live weather along the selected corridor.`;
    }

    return {
        risk,
        risk_label,
        wind_speed,
        wind_gusts: cached.wind_gusts ?? wind_speed,
        snowfall,
        visibility,
        temperature,
        recommended_departure,
        headline,
        detail,
        segment_id: cached.segmentId,
        source: "live-ml-local",
        seasonal,
        assessment: cached.assessment,
    };
}

/**
 * @param {{ segmentId: string, label?: string, departure: string }} query
 */
export async function predict(query) {
    const segmentId = query.segmentId || query.origin;
    if (!segmentId) throw new Error("segmentId required");

    const raw = await api("/api/predict", {
        method: "POST",
        body: JSON.stringify({
            segment_id: segmentId,
            departure: query.departure,
        }),
    });

    cached = {
        segmentId,
        label: query.label || segmentId,
        curve: raw.curve || [],
        meta: {
            medium_risk_threshold: raw.medium_risk_threshold ?? 0.28399814979606014,
            high_risk_threshold: raw.high_risk_threshold ?? 0.516360272356473,
        },
        seasonal: raw.seasonal,
        assessment: raw.assessment,
        wind_gusts: raw.wind_gusts,
    };
    mlStatus = "live";

    return { ...raw, source: "live-ml" };
}

export async function fetchSegments() {
    return api("/api/segments");
}
