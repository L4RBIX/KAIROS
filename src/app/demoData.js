/**
 * Demo data. Every fabricated number in BORAN lives in this file.
 *
 * That is the whole point of it existing: the rendering systems, the weather
 * director and the product interface all take their values from live state, so
 * when the backend arrives this module is deleted rather than hunted for.
 *
 * The closure below is representative of the Astana–Karaganda corridor rather
 * than a record of a specific incident: the shape — a morning that looks
 * survivable, a wind that gets up through the afternoon, and an official
 * closure hours after the road had actually become dangerous — is the pattern
 * the product is arguing about.
 */

/**
 * @typedef {{ time: string, risk: number, note?: string }} ReplaySample
 */

/**
 * A day that ended with the road shut.
 *
 * Samples are hourly through the build-up and tighten toward the closure,
 * because that is where the interesting behaviour is and a replay that spends
 * equal time on the quiet morning wastes the viewer's attention.
 *
 * @type {{
 *   label: string, route: {from: string, to: string},
 *   closedAt: string, closureLabel: string,
 *   samples: ReplaySample[],
 * }}
 */
export const CLOSURE_REPLAY = {
    label: "14 January",
    route: { from: "Astana", to: "Karaganda" },
    closedAt: "19:40",
    closureLabel: "Road closed by the regional authority",
    samples: [
        { time: "06:00", risk: 0.11 },
        { time: "08:00", risk: 0.19, note: "Light snow, wind 6 m/s" },
        { time: "10:00", risk: 0.28 },
        { time: "11:00", risk: 0.34, note: "Drifting reported near Osakarovka" },
        { time: "12:30", risk: 0.46 },
        { time: "14:00", risk: 0.61, note: "Wind 17 m/s, visibility falling" },
        { time: "15:30", risk: 0.71, note: "BORAN advisory threshold crossed" },
        { time: "17:00", risk: 0.83, note: "Visibility below 150 m" },
        { time: "18:30", risk: 0.92 },
        { time: "19:40", risk: 0.97, note: "Road closed" },
    ],
};

/**
 * Risk at which BORAN would have advised against travel.
 *
 * The replay's entire claim is the gap between this crossing and the official
 * closure, so it is defined once, here, and both the curve and the summary read
 * it rather than each carrying their own copy.
 */
export const ADVISORY_THRESHOLD = 0.70;

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
 *
 * Solved from the same interpolation the replay animates, so the headline
 * number and the curve on screen can never disagree.
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
