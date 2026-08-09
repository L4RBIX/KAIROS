/**
 * Illustrative winter-scenario data.
 *
 * Kept separate from the live LightGBM path on purpose: these curves are not
 * model outputs. They demonstrate the product argument (advisory lead time vs
 * official closure). Live Analyse uses trained road segments and never scores
 * these routes as live ML.
 */

/**
 * @typedef {{ time: string, risk: number, note?: string }} ReplaySample
 * @typedef {{
 *   id: string,
 *   label: string,
 *   date: string,
 *   route: { from: string, to: string },
 *   closedAt: string,
 *   closureLabel: string,
 *   samples: ReplaySample[],
 * }} WinterScenario
 */

/** Shared storm build-up used by the January corridor day. */
const ASTANA_KARAGANDA_SAMPLES = [
    { time: "06:00", risk: 0.11 },
    { time: "08:00", risk: 0.19, note: "Light snow, wind 6 m/s" },
    { time: "10:00", risk: 0.28 },
    { time: "11:00", risk: 0.34, note: "Drifting reported near Osakarovka" },
    { time: "12:30", risk: 0.46 },
    { time: "14:00", risk: 0.61, note: "Wind 17 m/s, visibility falling" },
    { time: "15:30", risk: 0.71, note: "Advisory threshold crossed (illustrative)" },
    { time: "17:00", risk: 0.83, note: "Visibility below 150 m" },
    { time: "18:30", risk: 0.92 },
    { time: "19:40", risk: 0.97, note: "Road closed" },
];

const ALMATY_SHYMKENT_SAMPLES = [
    { time: "06:00", risk: 0.14 },
    { time: "08:00", risk: 0.22, note: "Snow begins on mountain passes" },
    { time: "10:00", risk: 0.31 },
    { time: "12:00", risk: 0.44, note: "Crosswinds on open steppe sections" },
    { time: "14:00", risk: 0.58, note: "Visibility falling toward 400 m" },
    { time: "15:45", risk: 0.72, note: "Advisory threshold crossed (illustrative)" },
    { time: "17:30", risk: 0.86, note: "Blowing snow, drifting on carriageway" },
    { time: "19:00", risk: 0.93 },
    { time: "20:10", risk: 0.97, note: "Restrictions reported" },
];

const KYZ_SAMPLES = [
    { time: "05:30", risk: 0.16 },
    { time: "08:00", risk: 0.27, note: "Ice + light snow" },
    { time: "10:30", risk: 0.39 },
    { time: "13:00", risk: 0.55, note: "Gusts building" },
    { time: "15:00", risk: 0.70, note: "Advisory threshold crossed (illustrative)" },
    { time: "16:45", risk: 0.84, note: "Near whiteout in exposed sections" },
    { time: "18:20", risk: 0.94 },
    { time: "19:15", risk: 0.98, note: "Corridor closed" },
];

/** @type {WinterScenario[]} */
export const WINTER_SCENARIOS = [
    {
        id: "jan14-astana-karaganda",
        label: "14 January",
        date: "2024-01-14",
        route: { from: "Astana", to: "Karaganda" },
        closedAt: "19:40",
        closureLabel: "Road closed by the regional authority",
        samples: ASTANA_KARAGANDA_SAMPLES,
    },
    {
        id: "feb03-almaty-shymkent",
        label: "3 February",
        date: "2024-02-03",
        route: { from: "Almaty", to: "Shymkent" },
        closedAt: "20:10",
        closureLabel: "Restrictions reported on the corridor",
        samples: ALMATY_SHYMKENT_SAMPLES,
    },
    {
        id: "dec22-kyzylorda",
        label: "22 December",
        date: "2023-12-22",
        route: { from: "Kyzylorda", to: "Aralsk" },
        closedAt: "19:15",
        closureLabel: "Corridor closed after blizzard",
        samples: KYZ_SAMPLES,
    },
];

/** Default scenario (back-compat for anything still importing CLOSURE_REPLAY). */
export const CLOSURE_REPLAY = WINTER_SCENARIOS[0];

/**
 * Illustrative risk at which the product would have advised against travel.
 */
export const ADVISORY_THRESHOLD = 0.70;

/** @param {string} id */
export function scenarioById(id) {
    return WINTER_SCENARIOS.find((s) => s.id === id) || WINTER_SCENARIOS[0];
}

/** "HH:MM" to decimal hours. */
export function hoursOf(clock) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(clock);
    return m ? +m[1] + +m[2] / 60 : 0;
}

/** Decimal hours to "HH:MM". */
export function clockOf(hours) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    const carry = m === 60;
    return String(carry ? h + 1 : h).padStart(2, "0") + ":" +
           String(carry ? 0 : m).padStart(2, "0");
}

/**
 * Risk at an arbitrary time, linearly interpolated between samples.
 * @param {number} hours
 * @param {ReplaySample[]} [samples]
 */
export function riskAtHour(hours, samples = CLOSURE_REPLAY.samples) {
    const first = hoursOf(samples[0].time);
    const last = hoursOf(samples[samples.length - 1].time);
    if (hours <= first) return samples[0].risk;
    if (hours >= last) return samples[samples.length - 1].risk;

    for (let i = 0; i < samples.length - 1; i++) {
        const a = hoursOf(samples[i].time);
        const b = hoursOf(samples[i + 1].time);
        if (hours >= a && hours <= b) {
            const t = (hours - a) / (b - a);
            return samples[i].risk + (samples[i + 1].risk - samples[i].risk) * t;
        }
    }
    return samples[samples.length - 1].risk;
}

/**
 * When the advisory threshold was first crossed, in decimal hours.
 */
export function thresholdCrossing(samples = CLOSURE_REPLAY.samples) {
    for (let i = 0; i < samples.length - 1; i++) {
        const r0 = samples[i].risk;
        const r1 = samples[i + 1].risk;
        if (r0 < ADVISORY_THRESHOLD && r1 >= ADVISORY_THRESHOLD) {
            const a = hoursOf(samples[i].time);
            const b = hoursOf(samples[i + 1].time);
            return a + (b - a) * (ADVISORY_THRESHOLD - r0) / (r1 - r0);
        }
    }
    return hoursOf(samples[samples.length - 1].time);
}

/** "4h 10m" for a duration in decimal hours. */
export function durationLabel(hours) {
    const total = Math.max(0, Math.round(hours * 60));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
