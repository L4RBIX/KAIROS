/**
 * The product camera.
 *
 * BORAN's camera is choreographed, not steered. This replaces the spring arm,
 * which existed to chase a player and took its look direction straight from the
 * mouse — neither of which is meaningful now.
 *
 * It is a pose interpolator. Named poses declare where the camera stands, what
 * it looks at, and how wide; moving between them is an eased transition on a
 * fixed duration. Later stages add poses and call `cut()`; nothing about the
 * mechanism changes.
 *
 * It deliberately keeps the read surface the spring arm exposed — `camera`,
 * `yaw`, `pitch`, `distance`, `fov` — because `Sky.render` and the tuning
 * overlay both read it. That is a few lines of bookkeeping here against
 * modifying two working systems, which is the wrong trade at this stage.
 *
 * ## Why the drift is so slight
 *
 * There is a continuous sway on top of whatever pose is active, and it is
 * roughly a decimetre over twenty seconds. It exists so the frame is not
 * literally frozen — a still 3D image reads as a photograph, and the viewer
 * stops believing it is live. Any more than this and it reads as a handheld
 * camera, which is a completely different and much cheaper look.
 */

import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { UniversalCamera } from "@babylonjs/core/Cameras/universalCamera";
import { expDamp } from "../core/camera.js";
import { ROAD_DIR, ROAD_PERP, ROAD_HALF_WIDTH } from "../road/roadLayout.js";

const _tmp = new Vector3();
const _eye = new Vector3();
const _aim = new Vector3();

/**
 * @typedef {{
 *   pos: [number, number, number],
 *   target: [number, number, number],
 *   fov: number,
 *   focus: number,
 * }} Pose
 */

/** Seconds a pose transition takes unless one is given. */
const DEFAULT_TRANSITION = 3.2;

export class CinematicCamera {
    /**
     * @param {import("@babylonjs/core/scene").Scene} scene
     * @param {HTMLCanvasElement} canvas
     */
    constructor(scene, canvas) {
        const cam = new UniversalCamera("cam", new Vector3(0, 3, -6), scene);
        cam.minZ = 0.12;
        cam.maxZ = 4200;
        cam.fov = 0.82;
        cam.inertia = 0;
        // No attachControl, and no input manager: this camera is not steerable.
        cam.inputs.clear();

        this.camera = cam;
        this.scene = scene;

        /** @type {Record<string, Pose>} */
        this.poses = {};

        this._from = blankPose();
        this._to = blankPose();
        this._cur = blankPose();
        this._t = 1;
        this._duration = DEFAULT_TRANSITION;
        this._name = "";

        this.time = 0;

        /**
         * Metres to the subject, for depth of field. Published because the post
         * chain took this from the spring arm's length and still needs a number.
         */
        this.focusDistance = 60;

        /** Height sampler, injected once the terrain exists. */
        this.groundAt = null;
        /** Metres the eye is kept above the snow. */
        this.groundClearance = 1.1;

        // Bookkeeping the sky and the overlay read.
        this.yaw = 0;
        this.pitch = 0;
        this.distance = 60;
        this.fov = cam.fov;
    }

    /**
     * Declare a pose.
     * @param {string} name
     * @param {Pose} pose
     */
    addPose(name, pose) {
        this.poses[name] = pose;
        return this;
    }

    /**
     * Move to a pose. `seconds = 0` snaps.
     *
     * A snap invalidates the temporal history — the resolve would otherwise
     * reproject last frame's frustum through this one and smear the whole
     * image. The caller is handed that responsibility via `onCut`, because this
     * class has no business knowing the post chain exists.
     *
     * @param {string} name
     * @param {number} [seconds]
     */
    cut(name, seconds) {
        const p = this.poses[name];
        if (!p) {
            console.warn("[camera] no pose named " + name);
            return;
        }
        copyPose(this._cur, this._from);
        copyPose(p, this._to);
        this._duration = seconds === undefined ? DEFAULT_TRANSITION : seconds;
        this._t = this._duration <= 0 ? 1 : 0;
        this._name = name;
        if (this._duration <= 0) {
            copyPose(p, this._cur);
            this.onCut?.();
        }
    }

    /** True while a transition is running. */
    get moving() {
        return this._t < 1;
    }

    /** The pose most recently asked for. */
    get pose() {
        return this._name;
    }

    /** @param {number} dt seconds */
    update(dt) {
        this.time += dt;

        if (this._t < 1) {
            this._t = Math.min(1, this._t + dt / Math.max(1e-4, this._duration));
            // Slow in, slow out. A camera that starts and stops abruptly reads
            // as a jump cut however long the move takes.
            const k = easeInOutCubic(this._t);
            lerpPose(this._from, this._to, k, this._cur);
        }

        const c = this._cur;

        // ---- the sway ------------------------------------------------------
        // Two incommensurable periods, so it never visibly repeats. Applied to
        // the eye and to the aim by different amounts, which produces a slight
        // parallax rather than a rigid translation of the whole frame.
        const s1 = Math.sin(this.time * 0.081);
        const s2 = Math.sin(this.time * 0.117 + 1.7);
        const s3 = Math.sin(this.time * 0.063 + 4.1);

        _eye.set(
            c.pos[0] + s1 * 0.16,
            c.pos[1] + s2 * 0.09,
            c.pos[2] + s3 * 0.16
        );
        _aim.set(
            c.target[0] + s2 * 0.05,
            c.target[1] + s3 * 0.04,
            c.target[2] + s1 * 0.05
        );

        // Never let the eye drop into the snow. Eased, so a pose that grazes a
        // drift lifts smoothly instead of stepping.
        if (this.groundAt) {
            const g = this.groundAt(_eye.x, _eye.z) + this.groundClearance;
            if (_eye.y < g) {
                this._lift = expDamp(this._lift || 0, g - _eye.y, 12, dt);
                _eye.y += this._lift;
            } else if (this._lift) {
                this._lift = expDamp(this._lift, 0, 4, dt);
                _eye.y += this._lift;
            }
        }

        const cam = this.camera;
        cam.position.copyFrom(_eye);
        cam.fov = c.fov;
        cam.setTarget(_aim);

        // ---- published state -----------------------------------------------
        _tmp.copyFrom(_aim).subtractInPlace(_eye);
        this.distance = _tmp.length();
        this.focusDistance = c.focus > 0 ? c.focus : this.distance;
        this.fov = c.fov;
        this.yaw = Math.atan2(_tmp.x, _tmp.z);
        this.pitch = Math.atan2(-_tmp.y, Math.hypot(_tmp.x, _tmp.z));
    }
}

/**
 * The poses BORAN opens with.
 *
 * Built from the road layout rather than from hand-typed coordinates, so moving
 * the highway moves the camera with it.
 *
 * @param {CinematicCamera} cam
 * @param {(x:number, z:number) => number} heightAt
 */
export function installRoadPoses(cam, heightAt) {
    /** A point `t` metres along the road, `off` metres to its left. */
    const at = (t, off, up) => {
        const x = ROAD_DIR.x * t + ROAD_PERP.x * off;
        const z = ROAD_DIR.z * t + ROAD_PERP.z * off;
        return [x, heightAt(x, z) + up, z];
    };

    // LANDING — high and back, off the shoulder, the road running away to the
    // vanishing point. Wide enough to hold the steppe, long enough that the
    // road is the line the eye follows rather than a detail in the corner.
    cam.addPose("landing", {
        pos: at(-58, ROAD_HALF_WIDTH + 4.2, 5.4),
        target: at(190, 0, 1.6),
        fov: 0.78,
        focus: 120,
    });

    // ROUTE — dropped toward the carriageway and pushed forward. The road fills
    // more of the frame and the delineators start to have scale.
    cam.addPose("route", {
        pos: at(-38, ROAD_HALF_WIDTH + 3.2, 3.6),
        target: at(280, 0, 1.4),
        fov: 0.74,
        focus: 110,
    });

    // RISK — near the surface, close to the centreline. At this height the
    // carriageway is most of the frame, which is what makes snow closing over
    // it read as the road going rather than as weather happening nearby.
    cam.addPose("risk", {
        pos: at(-14, 1.6, 1.55),
        target: at(240, 0.4, 0.9),
        fov: 0.70,
        focus: 80,
    });

    cam.cut("landing", 0);
    return cam;
}

// ------------------------------------------------------------------ helpers

function blankPose() {
    return { pos: [0, 0, 0], target: [0, 0, 1], fov: 0.8, focus: 60 };
}

function copyPose(src, dst) {
    dst.pos[0] = src.pos[0]; dst.pos[1] = src.pos[1]; dst.pos[2] = src.pos[2];
    dst.target[0] = src.target[0];
    dst.target[1] = src.target[1];
    dst.target[2] = src.target[2];
    dst.fov = src.fov;
    dst.focus = src.focus;
}

function lerpPose(a, b, k, out) {
    for (let i = 0; i < 3; i++) {
        out.pos[i] = a.pos[i] + (b.pos[i] - a.pos[i]) * k;
        out.target[i] = a.target[i] + (b.target[i] - a.target[i]) * k;
    }
    out.fov = a.fov + (b.fov - a.fov) * k;
    out.focus = a.focus + (b.focus - a.focus) * k;
}

function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
