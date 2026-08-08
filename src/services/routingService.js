/**
 * Driving route abstraction (OSRM public demo endpoint).
 */

const OSRM =
    (import.meta.env.VITE_OSRM_URL || "https://router.project-osrm.org").replace(
        /\/$/,
        "",
    );

/**
 * @param {{lat:number,lon:number}} from
 * @param {{lat:number,lon:number}} to
 * @returns {Promise<{
 *   distanceKm: number,
 *   durationMinutes: number,
 *   geometry: number[][],
 *   waypoints: Array<{lat:number,lon:number}>,
 * }>}
 */
export async function routeDriving(from, to) {
    const path = `${from.lon},${from.lat};${to.lon},${to.lat}`;
    const url =
        `${OSRM}/route/v1/driving/${path}` +
        "?overview=full&geometries=geojson&steps=false";

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 20000);
    try {
        const res = await fetch(url, { signal: ctrl.signal });
        if (!res.ok) throw new Error(`Routing ${res.status}`);
        const data = await res.json();
        const r = data?.routes?.[0];
        if (!r?.geometry?.coordinates?.length) {
            throw new Error("No route found");
        }
        return {
            distanceKm: (r.distance || 0) / 1000,
            durationMinutes: (r.duration || 0) / 60,
            geometry: r.geometry.coordinates, // [lon, lat]
            waypoints: [
                { lat: from.lat, lon: from.lon },
                { lat: to.lat, lon: to.lon },
            ],
        };
    } finally {
        clearTimeout(t);
    }
}
