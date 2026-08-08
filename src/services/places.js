/**
 * Curated Kazakhstan places for reliable demo routing (no frontend geocoder key).
 */

/** @type {Array<{id:string,label:string,lat:number,lon:number}>} */
export const PLACES = [
    { id: "almaty", label: "Almaty", lat: 43.2389, lon: 76.9455 },
    { id: "astana", label: "Astana", lat: 51.1694, lon: 71.4491 },
    { id: "shymkent", label: "Shymkent", lat: 42.3417, lon: 69.5901 },
    { id: "karaganda", label: "Karaganda", lat: 49.8047, lon: 73.1094 },
    { id: "aktobe", label: "Aktobe", lat: 50.2839, lon: 57.167 },
    { id: "atyrau", label: "Atyrau", lat: 47.1164, lon: 51.9207 },
    { id: "oral", label: "Oral", lat: 51.2333, lon: 51.3667 },
    { id: "kostanay", label: "Kostanay", lat: 53.2144, lon: 63.6246 },
    { id: "pavlodar", label: "Pavlodar", lat: 52.2873, lon: 76.9674 },
    { id: "semey", label: "Semey", lat: 50.4111, lon: 80.2275 },
    { id: "oskemen", label: "Oskemen", lat: 49.9483, lon: 82.627 },
    { id: "taraz", label: "Taraz", lat: 42.9, lon: 71.3667 },
    { id: "kyzylorda", label: "Kyzylorda", lat: 44.8528, lon: 65.5092 },
    { id: "turkistan", label: "Turkistan", lat: 43.3017, lon: 68.2517 },
    { id: "aktau", label: "Aktau", lat: 43.65, lon: 51.2 },
    { id: "taldykorgan", label: "Taldykorgan", lat: 45.0156, lon: 78.3739 },
    { id: "petropavl", label: "Petropavl", lat: 54.8753, lon: 69.1628 },
    { id: "kokshetau", label: "Kokshetau", lat: 53.2833, lon: 69.3833 },
];

export function placeById(id) {
    return PLACES.find((p) => p.id === id) || null;
}
