/**
 * GPU blizzard — camera-relative airborne snow for BORAN.
 *
 * One preallocated billboard field. Particle positions are reconstructed in the
 * vertex shader from (id, time, camera, runtime wind). There is no per-frame JS
 * particle loop and no write into a particle texture.
 *
 * WeatherDirector owns the look via `S.blizzard*` and `S.runtimeWind*`. This
 * module only pushes camera basis + time into the material.
 */

import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Vector3 } from "@babylonjs/core/Maths/math";

import { S } from "../core/settings.js";
import { whenReady } from "../core/gpuUtil.js";

/**
 * Billboard count. Sized for a dense mid/far mass plus a thinner near streak
 * layer inside one draw. Cheaper than SprayField per grain (no shadow lookups).
 */
export const BLIZZARD_COUNT = 14000;

const _right = new Vector3();
const _up = new Vector3();
const _fwd = new Vector3();
const _wind = new Vector3();
const _volHalf = new Vector3(22, 9, 0);
const _localFwd = new Vector3(0, 0, 1);
const _localRight = new Vector3(1, 0, 0);
const _localUp = new Vector3(0, 1, 0);

export class BlizzardField {
    /**
     * @param {import("@babylonjs/core/scene").Scene} scene
     * @param {import("../render/sky.js").Sky} sky
     */
    constructor(scene, sky) {
        this.scene = scene;
        this.sky = sky;
        this.count = BLIZZARD_COUNT;
        this.triangleCount = 0;

        this.mesh = buildQuadMesh(scene, BLIZZARD_COUNT);
        this.material = this._makeMaterial();
        this.mesh.material = this.material;
        this.mesh.renderingGroupId = 2;

        this._camPos = new Vector3();
    }

    _makeMaterial() {
        const mat = new ShaderMaterial(
            "blizzard", this.scene, { vertex: "blizzard", fragment: "blizzard" },
            {
                attributes: ["position"],
                uniforms: [
                    "viewProjection", "cameraPos",
                    "camRight", "camUp", "camForward",
                    "time",
                    "runtimeWind",
                    "gustStrength",
                    "blizzardDensity",
                    "blizzardOpacity",
                    "nearSnowIntensity",
                    "sunDir", "sunRadiance",
                    "fogDensity", "fogHeightFalloff", "fogStart",
                    "aerialStrength", "ambientIntensity",
                    "volumeHalf", "volumeDepth",
                ],
                samplers: ["skyLUT"],
                shaderLanguage: ShaderLanguage.WGSL,
                needAlphaBlending: true,
            }
        );
        mat.backFaceCulling = false;
        mat.disableDepthWrite = true;
        mat.alphaMode = Constants.ALPHA_COMBINE;
        mat.needAlphaBlending = () => true;
        mat.setTexture("skyLUT", this.sky.lut);

        // Volume sized for the cinematic FOV (~0.82 rad) at 1600×900: deep enough
        // to fill mid visibility, wide enough to cover lateral FOV with margin.
        mat.setVector3("volumeHalf", _volHalf);
        mat.setFloat("volumeDepth", 42);

        return mat;
    }

    /**
     * Push per-frame uniforms. No particle simulation.
     * @param {number} time seconds
     * @param {import("@babylonjs/core/Cameras/camera").Camera} camera
     */
    update(time, camera) {
        const dens = S.blizzardDensity;
        const visible = dens > 0.012;
        this.mesh.isVisible = visible;
        this.triangleCount = visible ? BLIZZARD_COUNT * 2 : 0;
        if (!visible) return;

        this._camPos.copyFrom(camera.position);
        camera.getDirectionToRef(_localRight, _right);
        camera.getDirectionToRef(_localUp, _up);
        camera.getDirectionToRef(_localFwd, _fwd);

        const m = this.material;
        m.setVector3("cameraPos", this._camPos);
        m.setVector3("camRight", _right);
        m.setVector3("camUp", _up);
        m.setVector3("camForward", _fwd);
        m.setFloat("time", time);
        _wind.set(S.runtimeWindX, 0, S.runtimeWindZ);
        m.setVector3("runtimeWind", _wind);
        m.setFloat("gustStrength", S.gustStrength);
        m.setFloat("blizzardDensity", dens);
        m.setFloat("blizzardOpacity", S.blizzardOpacity);
        m.setFloat("nearSnowIntensity", S.nearSnowIntensity);
        m.setVector3("sunDir", this.sky.sunDir);
        m.setColor3("sunRadiance", this.sky.sunRadiance);
        m.setFloat("fogDensity", S.fogDensity);
        m.setFloat("fogHeightFalloff", S.fogHeightFalloff);
        m.setFloat("fogStart", S.fogStart);
        m.setFloat("aerialStrength", S.aerialStrength);
        m.setFloat("ambientIntensity", S.ambientIntensity);
    }

    async warmUp() {
        await whenReady(this.material, "blizzard material", [this.mesh, false]);
    }

    dispose() {
        this.mesh.dispose();
        this.material.dispose();
    }
}

/**
 * Static grid of quads. `position` = (particleIndex, cornerX, cornerY).
 * @param {import("@babylonjs/core/scene").Scene} scene
 * @param {number} count
 */
function buildQuadMesh(scene, count) {
    const pos = new Float32Array(count * 4 * 3);
    const idx = new Uint32Array(count * 6);
    const CORNERS = [-1, -1, 1, -1, 1, 1, -1, 1];

    for (let i = 0; i < count; i++) {
        for (let c = 0; c < 4; c++) {
            const o = (i * 4 + c) * 3;
            pos[o] = i;
            pos[o + 1] = CORNERS[c * 2];
            pos[o + 2] = CORNERS[c * 2 + 1];
        }
        const b = i * 4;
        const q = i * 6;
        idx[q] = b; idx[q + 1] = b + 1; idx[q + 2] = b + 2;
        idx[q + 3] = b; idx[q + 4] = b + 2; idx[q + 5] = b + 3;
    }

    const mesh = new Mesh("blizzard", scene);
    const vd = new VertexData();
    vd.positions = pos;
    vd.indices = idx;
    vd.applyToMesh(mesh, false);
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.isPickable = false;
    mesh.freezeWorldMatrix();
    mesh.doNotSyncBoundingInfo = true;
    mesh.metadata = { triangles: count * 2, vertices: count * 4 };
    return mesh;
}
