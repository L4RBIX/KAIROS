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

/**
 * Possible advisory-crossing clocks (decimal hours). Real blizzards are not
 * always mid-afternoon — morning onsets are common on the steppe.
 */
const ONSET_POOL_H = [
    6 + 20 / 60,  // 06:20
    7 + 10 / 60,  // 07:10
    8 + 5 / 60,   // 08:05
    9 + 40 / 60,  // 09:40
    11 + 15 / 60, // 11:15
    13 + 0 / 60,  // 13:00
    15 + 20 / 60, // 15:20
];

const ONSET_SESSION_KEY = "kairos.winterStormOnset.v1";

/** @type {Map<string, number>} */
const onsetMemory = new Map();

/** @param {string} id */
export function scenarioById(id) {
    return WINTER_SCENARIOS.find((s) => s.id === id) || WINTER_SCENARIOS[0];
}

/**
 * Pick (or reuse) a storm-onset hour for this browser window.
 * Same scenario id always returns the same onset until the tab is closed.
 * @param {string} scenarioId
 * @param {number} startHour
 * @param {number} endHour
 */
export function onsetForSession(scenarioId, startHour, endHour) {
    const lo = startHour + 0.35;
    const hi = endHour - 1.4;
    const pool = ONSET_POOL_H.filter((h) => h >= lo && h <= hi);
    const choices = pool.length ? pool : [Math.min(hi, Math.max(lo, 8))];

    const mem = onsetMemory.get(scenarioId);
    if (typeof mem === "number" && mem >= lo && mem <= hi) return mem;

    /** @type {Record<string, number>} */
    let map = {};
    try {
        map = JSON.parse(sessionStorage.getItem(ONSET_SESSION_KEY) || "{}") || {};
    } catch {
        map = {};
    }

    const cached = map[scenarioId];
    if (typeof cached === "number" && cached >= lo && cached <= hi) {
        onsetMemory.set(scenarioId, cached);
        return cached;
    }

    // Bias toward morning onsets — afternoon is only one of several real cases.
    const morning = choices.filter((h) => h < 10);
    const later = choices.filter((h) => h >= 10);
    const bag = morning.length && Math.random() < 0.55
        ? morning
        : (later.length ? later : choices);
    const pick = bag[Math.floor(Math.random() * bag.length)];
    onsetMemory.set(scenarioId, pick);
    map[scenarioId] = pick;
    try {
        sessionStorage.setItem(ONSET_SESSION_KEY, JSON.stringify(map));
    } catch {
        /* private mode — memory map still keeps this tab stable */
    }
    return pick;
}

/**
 * Rebuild sample risks so the advisory threshold falls near `crossingHour`,
 * while the day still ends near closure severity.
 * @param {ReplaySample[]} template
 * @param {number} crossingHour
 * @returns {ReplaySample[]}
 */
export function shapeSamplesAroundCrossing(template, crossingHour) {
    const start = hoursOf(template[0].time);
    const end = hoursOf(template[template.length - 1].time);
    const cross = Math.min(end - 1.2, Math.max(start + 0.3, crossingHour));
    const closedRisk = template[template.length - 1].risk;

    // Exact onset sample — sparse templates otherwise miss 06:xx / 08:xx.
    // Never replace the first/last anchors (need a sample below the threshold).
    /** @type {{ time: string, note?: string }[]} */
    const times = template.map((s) => ({ time: s.time, note: s.note }));
    const nearIdx = times.findIndex((s, i) => {
        if (i === 0 || i === times.length - 1) return false;
        return Math.abs(hoursOf(s.time) - cross) < 0.35;
    });
    if (nearIdx >= 0) {
        times[nearIdx] = {
            time: clockOf(cross),
            note: "Advisory threshold crossed (illustrative)",
        };
    } else {
        times.push({
            time: clockOf(cross),
            note: "Advisory threshold crossed (illustrative)",
        });
        times.sort((a, b) => hoursOf(a.time) - hoursOf(b.time));
    }

    return times.map((sample) => {
        const h = hoursOf(sample.time);
        let risk;
        if (h <= start) {
            risk = 0.11;
        } else if (h < cross - 1e-6) {
            const t = (h - start) / (cross - start);
            risk = 0.10 + (ADVISORY_THRESHOLD - 0.02 - 0.10) * Math.pow(t, 1.08);
        } else if (Math.abs(h - cross) <= 1e-6) {
            risk = ADVISORY_THRESHOLD;
        } else {
            const t = (h - cross) / (end - cross);
            risk = ADVISORY_THRESHOLD + (closedRisk - ADVISORY_THRESHOLD) * Math.pow(t, 0.9);
        }
        risk = Math.min(0.99, Math.max(0.05, risk));

        /** @type {ReplaySample} */
        const out = { time: sample.time, risk: Math.round(risk * 1000) / 1000 };
        if (Math.abs(h - cross) < 0.25) {
            out.note = "Advisory threshold crossed (illustrative)";
        } else if (h >= end - 0.05) {
            out.note = sample.note || "Road closed";
        } else if (sample.note && !/Advisory threshold/i.test(sample.note)) {
            if (h < cross || risk >= 0.8) out.note = sample.note;
        }
        return out;
    });
}

/**
 * Scenario with a session-stable randomised storm onset.
 * @param {WinterScenario|string} scenarioOrId
 * @returns {WinterScenario}
 */
export function resolveScenario(scenarioOrId) {
    const base = typeof scenarioOrId === "string"
        ? scenarioById(scenarioOrId)
        : scenarioOrId;
    const start = hoursOf(base.samples[0].time);
    const end = hoursOf(base.samples[base.samples.length - 1].time);
    const onset = onsetForSession(base.id, start, end);
    return {
        ...base,
        samples: shapeSamplesAroundCrossing(base.samples, onset),
        onsetClock: clockOf(onset),
    };
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
