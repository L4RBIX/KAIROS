/**
 * Weather as product data.
 *
 * This module knows nothing about rendering. It describes conditions on a road
 * in the units a meteorologist or a model would use, and that is the whole
 * point: the prediction can come from a mock, from a slider, or from an ML
 * service later, and the renderer cannot tell the difference.
 *
 * The translation from these numbers into fog density, exposure and snow cover
 * lives in `weatherDirector.js`, on the other side of this boundary.
 */

/**
 * @typedef {{
 *   risk: number,          0..1 probability the road becomes dangerous/closed
 *   windSpeed: number,     m/s
 *   snowfall: number,      mm/h water equivalent
 *   visibility: number,    metres
 *   temperature: number,   degrees C
 *   windDirection: number, compass degrees the wind blows *from*
 * }} WeatherState
 */

/**
 * @param {Partial<WeatherState>} [init]
 * @returns {WeatherState}
 */
export function createWeatherState(init) {
    return {
        risk: 0,
        windSpeed: 4,
        snowfall: 0.1,
        visibility: 900,
        temperature: -8,
        windDirection: 42,
        ...(init || {}),
    };
}

/**
 * The deterministic risk → conditions curve.
 *
 * A stand-in for the model, and deliberately a *documented* one rather than a
 * scattering of magic numbers: when the real predictor arrives it will supply
 * wind, snowfall and visibility directly and this function stops being called,
 * so it has to be obvious what it was standing in for.
 *
 * The bands come from what actually closes roads on the Astana–Karaganda
 * corridor: it is almost never snowfall alone. It is wind moving snow that has
 * already fallen, which is why visibility collapses far faster than snowfall
 * rises, and why the wind curve is the steep one.
 *
 * @param {number} risk 0..1
 * @param {WeatherState} [out] written in place if given, so this can run per frame
 * @returns {WeatherState}
 */
export function weatherFromRisk(risk, out) {
    const r = risk < 0 ? 0 : risk > 1 ? 1 : risk;
    const w = out || createWeatherState();

    w.risk = r;

    // Wind: a calm 3 m/s to a 32 m/s severe blizzard. Accelerating, because the
    // difference between 20 and 30 m/s matters far more to a road than the
    // difference between 3 and 13.
    w.windSpeed = 3 + 29 * r * r;

    // Snowfall rises roughly linearly and saturates — there is a ceiling to how
    // much water the air can carry at these temperatures.
    w.snowfall = 0.1 + 6.2 * Math.pow(r, 1.35);

    // Visibility, metres. 900 m in clear air to 55 m in a whiteout — under a
    // three-second gap at highway speed, which is the physical reason these
    // roads get closed.
    //
    // Calibrated against three points rather than picked as a shape:
    //   risk 0.50 -> 447 m, which lands the mid-range on almost exactly the
    //                fog density this scene was originally art-directed at
    //   risk 0.82 -> 137 m, the "do not leave" case
    //   risk 1.00 ->  55 m
    //
    // The squared exponent matters. A geometric collapse (900 * k^r) reaches
    // 48 m by risk 0.82, and at 48 m the road is simply not in frame any more —
    // there is nothing left for the storm to take away, so the top quarter of
    // the range stops reading as worse and just reads as fog.
    w.visibility = 900 * Math.exp(-2.8 * r * r);

    // Colder with the front, then slightly less cold as the wind mixes the air.
    w.temperature = -6 - 22 * r + 6 * r * r;

    return w;
}

/** Coarse label for the risk bands the product talks in. */
export function riskLabel(risk) {
    if (risk < 0.25) return "low";
    if (risk < 0.5) return "moderate";
    if (risk < 0.75) return "high";
    if (risk < 0.9) return "severe";
    return "extreme";
}
