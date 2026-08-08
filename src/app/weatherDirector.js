/**
 * The one place weather data becomes pixels.
 *
 * Everything the storm does to the picture is decided here and written into the
 * existing render parameters. Nothing else in the codebase reads a `risk`, and
 * no shader has a hardcoded storm state — which is the requirement that lets an
 * ML backend replace the prediction source without the 3D environment noticing.
 *
 * ## Why it writes into `S`
 *
 * `core/settings.js` is already a flat parameter bus that every system samples
 * once a frame with no allocation. Fog density, exposure, contrast, ambient and
 * wind are all live there. Building a second parallel bus alongside it would
 * mean every material grew a second source of truth for the same numbers. So
 * this writes `S` directly, and `S` stops being a debug panel's backing store
 * and becomes the render state the product drives.
 *
 * ## What it deliberately does not touch
 *
 * `S.windDirection` is baked into the heightfield at load: it sets the dune
 * anisotropy and the sastrugi shear, and the CPU height mirror is read back
 * from that bake. Animating it would desynchronise the ground the camera stands
 * on from the ground that is drawn. The weather's own wind bearing is published
 * separately, for the things that can honour it.
 *
 * `S.sunIntensity` is not touched either, and this one is subtler. It feeds two
 * things: `sunRadiance`, recomputed every frame, and the baked sky LUT, which is
 * only rebuilt when the sun *moves*. Turning it down would dim the direct light
 * while leaving the sky texture at its old brightness — a dark landscape under a
 * bright sky. Overcast is done with cloud cover and ambient instead, both of
 * which are per-frame uniforms.
 *
 * ## Easing
 *
 * Every parameter eases at its own rate, and that is the point rather than an
 * accident. Air clears and thickens quickly; lying snow does not. Moving them
 * all at one speed makes the transition read as a single crossfade — a slider
 * being dragged — instead of weather arriving.
 */

import { S } from "../core/settings.js";
import { expDamp } from "../core/camera.js";
import { createWeatherState } from "./weatherState.js";

/**
 * Approach rates, per second. Larger settles faster; a rate of `k` covers about
 * 63% of the remaining distance in `1/k` seconds, so these land between roughly
 * two and six seconds.
 */
const RATE = {
    fog: 0.42,
    light: 0.55,
    wind: 0.30,
    cloud: 0.25,
    /** Slowest by a wide margin: snow has to physically accumulate. */
    cover: 0.16,
    post: 0.50,
    /** Airborne mass arrives with the wind, a beat behind fog. */
    blizzard: 0.38,
};

/** Endpoints of every driven render parameter, at calm and at whiteout. */
const CALM = {
    fogHeightFalloff: 0.045,
    aerialStrength: 1.00,
    ambientIntensity: 1.00,
    exposure: 0.105,
    contrast: 1.14,
    bloomStrength: 0.22,
    shaftStrength: 0.30,
    cloudAmount: 0.45,
    wetness: 0.10,
};
const STORM = {
    fogHeightFalloff: 0.010,
    aerialStrength: 1.45,
    ambientIntensity: 1.80,
    // Down, not up: the ambient rise more than compensates, and a whiteout that
    // clips to pure white loses the road silhouette that carries the whole
    // message.
    exposure: 0.086,
    contrast: 0.90,
    bloomStrength: 0.42,
    // A blizzard has no sunbeams. Leaving these in is the single fastest way to
    // make a storm read as a nice afternoon.
    shaftStrength: 0.03,
    cloudAmount: 1.00,
    wetness: 0.48,
};

export class WeatherDirector {
    /**
     * @param {{ road: import("../road/roadScene.js").RoadScene }} systems
     */
    constructor(systems) {
        this.road = systems.road;

        /** What the product has asked for. */
        this.target = createWeatherState();
        /** What is actually on screen right now. Eased toward `target`. */
        this.current = createWeatherState();

        /** Wind bearing for effects that can honour it. NOT `S.windDirection`. */
        this.windBearing = S.windDirection;

        /** Deterministic gust clock — continuous, replay-stable for a given dt stream. */
        this._gustT = 0;

        this._first = true;
    }

    /**
     * Ask for a weather state. Product data in; nothing is rendered here.
     * @param {import("./weatherState.js").WeatherState} ws
     */
    setTarget(ws) {
        Object.assign(this.target, ws);
    }

    /** Jump straight to the target, skipping the transition. */
    snap() {
        Object.assign(this.current, this.target);
        this._apply(0, true);
    }

    /** @param {number} dt seconds */
    update(dt) {
        if (this._first) {
            this.snap();
            this._first = false;
            return;
        }

        const c = this.current;
        const t = this.target;

        // Each quantity approaches at the rate that suits what it physically is.
        c.risk = expDamp(c.risk, t.risk, RATE.light, dt);
        c.windSpeed = expDamp(c.windSpeed, t.windSpeed, RATE.wind, dt);
        c.snowfall = expDamp(c.snowfall, t.snowfall, RATE.fog, dt);
        c.temperature = expDamp(c.temperature, t.temperature, RATE.wind, dt);
        // Visibility is eased in log space. It spans 900 m to 25 m — a factor of
        // 36 — and easing it linearly spends almost the whole transition in the
        // clear half and then collapses at the end.
        c.visibility = Math.exp(
            expDamp(Math.log(c.visibility), Math.log(Math.max(5, t.visibility)), RATE.fog, dt)
        );
        this.windBearing = t.windDirection;
        this._gustT += dt;

        this._apply(dt, false);
    }

    /**
     * Write the eased state into the render parameters.
     * @param {number} dt
     * @param {boolean} immediate
     */
    _apply(dt, immediate) {
        const c = this.current;
        // Storm severity, from risk. Smoothed so the ends of the range are not
        // where all the visual change happens.
        const sev = smooth01(c.risk);

        // ---- visibility -----------------------------------------------------
        // Density from metres, by the standard contrast threshold: a target is
        // at the visibility limit when its contrast has fallen to 5%, which is
        // exp(-density * range) = 0.05, so density = 3 / range. Expressing it
        // this way means the number the product shows a driver and the number
        // the fog integral uses are the same physical claim.
        const wantFog = 3.0 / clamp(c.visibility, 25, 4000);

        // ---- everything else ------------------------------------------------
        const step = (key, want, rate) => {
            S[key] = immediate ? want : expDamp(S[key], want, rate, dt);
        };

        step("fogDensity", wantFog, RATE.fog);
        step("fogHeightFalloff", lerpK("fogHeightFalloff", sev), RATE.fog);
        step("aerialStrength", lerpK("aerialStrength", sev), RATE.fog);
        step("ambientIntensity", lerpK("ambientIntensity", sev), RATE.light);
        step("exposure", lerpK("exposure", sev), RATE.post);
        step("contrast", lerpK("contrast", sev), RATE.post);
        step("bloomStrength", lerpK("bloomStrength", sev), RATE.post);
        step("shaftStrength", lerpK("shaftStrength", sev), RATE.post);
        step("cloudAmount", lerpK("cloudAmount", sev), RATE.cloud);

        // Wind strength drives heritage spray drift. 8 m/s is the reference:
        // the setting was authored as 1.0 at a stiff breeze.
        step("windStrength", clamp(c.windSpeed / 8, 0.15, 4.5), RATE.wind);

        // ---- GPU blizzard ----------------------------------------------------
        // Airborne mass from risk, snowfall and wind. Thresholded so calm risk
        // stays almost empty; whiteout fills the preallocated field.
        // Gate hard on risk so the landing / calm forecast stays empty even when
        // residual snowfall/wind numbers are non-zero in the weather state.
        const riskGate = clamp((c.risk - 0.16) / 0.28, 0, 1);
        const fromRisk = clamp((sev - 0.06) / 0.94, 0, 1);
        // Milder curve so mid-risk (~0.5) already reads as active drift.
        const densCurve = Math.pow(fromRisk, 0.85);
        const fromSnow = clamp(c.snowfall / 6.8, 0, 1);
        const fromWind = clamp((c.windSpeed - 3) / 27, 0, 1);
        const wantDens = clamp(
            (densCurve * 0.74 + fromSnow * 0.14 + fromWind * 0.22) * riskGate,
            0, 1
        );
        const wantOpacity = clamp(0.28 + wantDens * 0.70, 0, 1);
        const wantNear = clamp((sev - 0.28) / 0.55, 0, 1);
        const wantGust = clamp((c.windSpeed - 4) / 26, 0, 1) * (0.35 + 0.65 * sev);

        step("blizzardDensity", wantDens, RATE.blizzard);
        step("blizzardOpacity", wantOpacity, RATE.blizzard);
        step("nearSnowIntensity", wantNear, RATE.blizzard);
        step("gustStrength", wantGust, RATE.wind);

        // Runtime wind from weather bearing — never writes baked S.windDirection.
        // Gust is a smooth sum of sines so replay stays continuous under the same
        // clock; no per-frame random.
        const g = this._gustT;
        const gust =
            0.55 * Math.sin(g * 0.37) +
            0.32 * Math.sin(g * 0.13 + 2.1) +
            0.18 * Math.sin(g * 0.79 + 0.4);
        const bearing = (this.windBearing * Math.PI) / 180;
        const base = clamp(c.windSpeed / 8, 0.08, 4.5) * (0.65 + 0.55 * sev);
        const gustMul = 1 + S.gustStrength * gust * 0.9;
        const wantWx = Math.sin(bearing) * base * gustMul;
        const wantWz = Math.cos(bearing) * base * gustMul;
        if (immediate) {
            S.runtimeWindX = wantWx;
            S.runtimeWindZ = wantWz;
        } else {
            S.runtimeWindX = expDamp(S.runtimeWindX, wantWx, RATE.wind, dt);
            S.runtimeWindZ = expDamp(S.runtimeWindZ, wantWz, RATE.wind, dt);
        }

        // ---- the road --------------------------------------------------------
        const road = this.road;
        if (road) {
            // Cover is driven by snowfall *and* wind: on this corridor the road
            // disappears under snow that has already fallen and is being moved,
            // which is why wind carries most of the weight here.
            const fromFall = clamp(c.snowfall / 7.5, 0, 1);
            const fromWind = clamp((c.windSpeed - 8) / 20, 0, 1);
            const wantCover = clamp(0.04 + 0.55 * fromFall + 0.55 * fromWind, 0, 1);
            road.snowCover = immediate
                ? wantCover
                : expDamp(road.snowCover, wantCover, RATE.cover, dt);
            const wantWet = lerpK("wetness", sev);
            road.wetness = immediate
                ? wantWet
                : expDamp(road.wetness, wantWet, RATE.post, dt);
        }
    }
}

// ------------------------------------------------------------------ helpers

function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
}

/** Smoothstep on 0..1, so severity does not change fastest at the extremes. */
function smooth01(t) {
    const x = clamp(t, 0, 1);
    return x * x * (3 - 2 * x);
}

function lerpK(key, k) {
    return CALM[key] + (STORM[key] - CALM[key]) * k;
}
