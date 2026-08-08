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
            geometry: q.geometry,
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
