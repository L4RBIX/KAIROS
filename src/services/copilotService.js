/**
 * KAIROS Copilot client.
 *
 * Called only on explicit user actions (open explain / quick prompt / ask).
 * Never from the departure scrubber.
 */

const API_BASE = (import.meta.env.VITE_ML_API_URL || "").replace(/\/$/, "");

/**
 * @param {{
 *   message: string,
 *   segmentId: string,
 *   departure: string,
 *   locale?: "en"|"ru"|"kk",
 *   profile?: "car"|"truck"|"family",
 *   compareTimes?: string[],
 *   segmentLabel?: string,
 * }} req
 */
export async function askCopilot(req) {
    if (!API_BASE) {
        throw new Error("ML API not configured");
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 28000);
    try {
        const res = await fetch(`${API_BASE}/api/copilot`, {
            method: "POST",
            signal: ctrl.signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                message: req.message,
                segment_id: req.segmentId,
                departure: req.departure,
                locale: req.locale || "en",
                profile: req.profile || "car",
                compare_times: req.compareTimes || [],
                segment_label: req.segmentLabel || undefined,
            }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(text || `Copilot ${res.status}`);
        }
        return res.json();
    } finally {
        clearTimeout(t);
    }
}

export async function fetchCopilotStatus() {
    if (!API_BASE) return { available: false };
    try {
        const res = await fetch(`${API_BASE}/api/copilot/status`);
        if (!res.ok) return { available: false };
        return res.json();
    } catch {
        return { available: false };
    }
}
