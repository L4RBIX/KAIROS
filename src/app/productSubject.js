/**
 * The thing the scene is composed around.
 *
 * SNOWFLOW framed everything on a player character: the camera rig chased it,
 * the terrain clipmap centred its LOD rings on it, and the deformation window
 * followed it. BORAN has no player, but those three systems still need a point
 * to be about — so this is that point, and nothing more.
 *
 * The contract is deliberately five numbers wide:
 *
 *   position    where the scene is centred
 *   velocity    how that point is moving (camera lead, spring arm stretch)
 *   lean        signed bank, -1..1
 *   speed01     normalised speed, drives the rig's FOV widening
 *   streak01    0..1, drives the display transform's speed streaks
 *
 * That is exactly the set `CameraRig.update` and `PostChain.update` consume, so
 * it can stand in for the controller without either of them being touched. What
 * is *not* here matters as much: no facing, no surf, no carve, no gait, no
 * footfalls, no input. Later BORAN stages drive a cinematic camera and a weather
 * state off this, and neither should be able to reach a gameplay concept through
 * it.
 *
 * Static for now. Stage 3 gives it a path along the highway; the shape of this
 * object does not have to change for that to happen.
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";

export class ProductSubject {
    constructor() {
        /** World position the camera, clipmap and deformation window centre on. */
        this.position = new Vector3(0, 0, 0);
        /** World velocity. Zero while the subject is static. */
        this.velocity = new Vector3(0, 0, 0);
        /** Signed bank, -1..1. The rig rolls into it. */
        this.lean = 0;
        /** Normalised speed, 0..1. The rig widens its FOV with it. */
        this.speed01 = 0;
        /** 0..1 speed-streak amount, read by the display transform. */
        this.streak01 = 0;
    }

    /**
     * Advance the subject.
     *
     * A no-op while the subject is static, and called from the render loop
     * anyway: the call site is where a cinematic path will be integrated in a
     * later stage, and having it already in the right place in the frame order
     * is the point.
     *
     * @param {number} dt seconds
     */
    update(dt) {}
}
