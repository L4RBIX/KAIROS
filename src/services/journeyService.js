/**
 * Journey analysis + Route Intelligence client.
 */

const API_BASE = (import.meta.env.VITE_ML_API_URL || "").replace(/\/$/, "");

async function api(path, init) {
    if (!API_BASE) throw new Error("VITE_ML_API_URL is not set");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60000);
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
            throw new Error(text || `API ${res.status}`);
        }
        return res.json();
    } finally {
        clearTimeout(t);
    }
}

/** The analyse endpoint rejects geometry longer than this. */
const MAX_GEOMETRY_POINTS = 5000;

/**
 * Thin a route to at most `max` points, always keeping both endpoints.
 *
 * OSRM returns one vertex per road node, so anything past ~1200 km overruns the
 * API limit and the whole analysis 422s. Even a 2700 km route keeps a point
 * every ~500 m after thinning, which is far finer than the coverage buffers.
 *
 * @param {number[][]} coords
 * @param {number} max
 * @returns {number[][]}
 */
export function thinGeometry(coords, max = MAX_GEOMETRY_POINTS) {
    if (!Array.isArray(coords) || coords.length <= max) return coords;
    const stride = Math.ceil((coords.length - 1) / (max - 1));
    const out = [];
    for (let i = 0; i < coords.length; i += stride) out.push(coords[i]);
    const last = coords[coords.length - 1];
    if (out[out.length - 1] !== last) out.push(last);
    return out;
}

/**
 * @param {{
 *   fromLabel: string,
 *   toLabel: string,
 *   departure: string,
 *   geometry: number[][],
 *   distanceKm: number,
 * }} q
 */
export async function analyzeJourney(q) {
    return api("/api/journey/analyze", {
        method: "POST",
        body: JSON.stringify({
            from_label: q.fromLabel,
            to_label: q.toLabel,
            departure: q.departure,
            geometry: thinGeometry(q.geometry),
            // Distance stays the router's own figure, not the thinned polyline.
            distance_km: q.distanceKm,
        }),
    });
}

/**
 * @param {{
 *   action: "summarize"|"why"|"wait"|"safest"|"ask",
 *   message?: string,
 *   locale?: string,
 *   profile?: string,
 * }} q
 */
export async function journeyIntelligence(q) {
    return api("/api/journey/intelligence", {
        method: "POST",
        body: JSON.stringify({
            action: q.action || "summarize",
            message: q.message || "",
            locale: q.locale || "en",
            profile: q.profile || "car",
        }),
    });
}

export async function fetchCoverageSegments() {
    if (!API_BASE) return [];
    try {
        return await api("/api/segments");
    } catch {
        return [];
    }
}
