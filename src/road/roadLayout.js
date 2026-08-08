/**
 * Where the highway is. One source of truth, shared by everything that needs
 * to agree about it.
 *
 * Three systems derive from these numbers and they must not drift:
 *
 *   the heightfield bake  flattens a corridor here, so the road has ground to
 *                         sit on rather than riding over dunes
 *   the road mesh         is built along this line
 *   the camera            frames this line
 *
 * The bake runs on the GPU and the mesh is built on the CPU, so the two would
 * be trivially easy to let diverge. They read the same constants from here, and
 * the mesh takes its heights from the CPU mirror of the bake rather than
 * recomputing them — so the asphalt cannot float or sink.
 *
 * Geometry convention: bearings are compass degrees, and a direction is
 * `(sin, cos)` in world XZ — the same convention `sunAzimuth` and
 * `windDirection` already use in `core/settings.js`.
 */

/**
 * Compass bearing the road runs along.
 *
 * Chosen against the two directions already in the scene rather than picked for
 * its own sake. The sun sits at 118 degrees and 13 degrees up, so a road within
 * ten degrees of that runs at its own vanishing point into a low sun — long
 * shadows raking across the carriageway, haze down the length of it. The wind
 * is at 42 degrees, which puts the sastrugi and every drift crossing the road
 * at almost a right angle: snow blowing *across* the highway, which is the
 * hazard BORAN is about.
 */
export const ROAD_BEARING = 128;

/** Half the paved width, metres. An 8 m carriageway — two lanes, no hard shoulder. */
export const ROAD_HALF_WIDTH = 4.0;

/**
 * Metres over which the flattened corridor returns to natural ground.
 *
 * Wide enough that a dune flank becomes an embankment rather than a cliff, and
 * narrow enough that the road still reads as cut into the steppe rather than
 * laid on a plain.
 */
export const ROAD_SHOULDER = 22.0;

/**
 * Height of the ploughed snow bank thrown up outside the carriageway, metres.
 * It is what makes the road read as *cleared* rather than merely as a strip of
 * different ground.
 */
export const ROAD_BERM = 0.85;

/**
 * How far the road runs either side of the origin, metres.
 *
 * Bounded by the heightfield, not by taste. The field is 2048 m square, so a
 * point `t` along a bearing of 128 degrees leaves it at t = 1024/0.788 = 1300 m.
 * Past that `heightAt` clamps to the edge of the CPU mirror, the road stops
 * agreeing with the ground it is supposed to be sitting on, and the far end
 * either floats or submerges. Well inside the fog anyway.
 */
export const ROAD_LENGTH = 1150;

/**
 * Metres the asphalt stands above the flattened corridor.
 *
 * This number is a clearance budget, not a style choice, and getting it wrong is
 * visible immediately. The terrain's fine layer — sastrugi, ripples and grain —
 * is evaluated live in the snow shaders and is *not* suppressed inside the
 * corridor, so it lifts the ground by up to 11 cm; the tail of the ploughed bank
 * adds about 6 cm more at the paved edge. At the original 16 cm the two summed
 * to 17.8 cm and the snow surfaced *through* the tarmac in scalloped patches
 * along both edges.
 *
 * 30 cm clears the worst case by 12 cm and still reads as a road rather than a
 * causeway, because the skirt in `roadScene.js` buries the step.
 */
export const ROAD_LIFT = 0.30;

/** Unit direction along the road in world XZ. */
export const ROAD_DIR = Object.freeze({
    x: Math.sin((ROAD_BEARING * Math.PI) / 180),
    z: Math.cos((ROAD_BEARING * Math.PI) / 180),
});

/** Unit direction across the road, pointing to its left. */
export const ROAD_PERP = Object.freeze({
    x: -ROAD_DIR.z,
    z: ROAD_DIR.x,
});

/**
 * A point on the centreline, `t` metres along from the origin.
 * @param {number} t
 * @param {{x:number, z:number}} out
 */
export function centreline(t, out) {
    out.x = ROAD_DIR.x * t;
    out.z = ROAD_DIR.z * t;
    return out;
}
