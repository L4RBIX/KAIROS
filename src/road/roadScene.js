/**
 * The highway corridor: carriageway, delineators, power line and signs.
 *
 * One mesh, one material, one pipeline. The pieces are separate objects in the
 * world but they are one thing to the renderer, which matters more than it
 * sounds: every extra material here would need its own shadow material per
 * cascade, its own depth-prepass material and its own warm-up, and would add
 * draw calls to a frame that is already fill-bound. A `kind` in the vertex
 * stream costs nothing and the fragment shader branches on it coherently.
 *
 * Geometry is built once, in world space, against the CPU mirror of the
 * heightfield — which already has the corridor graded into it, so the asphalt
 * lands on the ground rather than near it. Nothing here is rebuilt or re-uploaded
 * per frame; `update()` pushes uniforms and nothing else.
 */

import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { ShaderMaterial } from "@babylonjs/core/Materials/shaderMaterial";
import { ShaderLanguage } from "@babylonjs/core/Materials/shaderLanguage";
import { Vector3, Vector4 } from "@babylonjs/core/Maths/math";

import { S } from "../core/settings.js";
import { whenReady, bindMatrixArray } from "../core/gpuUtil.js";
import { CASCADE_COUNT } from "../render/shadows.js";
import {
    ROAD_DIR, ROAD_PERP, ROAD_HALF_WIDTH, ROAD_LENGTH, ROAD_LIFT,
} from "./roadLayout.js";

/** Metres between road cross-sections. */
const SEGMENT = 6;
/** Metres between delineator posts, each side. */
const POST_SPACING = 48;
/** Metres between power poles. */
const POLE_SPACING = 130;
/** Which side of the road the power line runs, and how far out. */
const POLE_OFFSET = 21;
/** How far the corridor furniture extends either side of the origin. */
const PROP_RANGE = 900;

/** Cascades the corridor casts into. The far cascade covers 330 m at 32 cm a
 *  texel, where a 9 cm delineator post is a fifth of a texel and its shadow is
 *  noise. The road surface itself is nearly flat and casts almost nothing. */
const ROAD_CASCADES = 2;

const _splits = new Vector4();

/**
 * Cross-section of the carriageway, as (offset across in metres, height above
 * the road base in metres).
 *
 * The two outermost pairs are the skirt: they drop well below the surrounding
 * snow so the asphalt is watertight against a heightfield it does not share
 * vertices with. Without them the road is a floating ribbon with daylight under
 * its edges, which is the single most obvious way to get this wrong.
 */
const SECTION = [
    [-1.14, -0.85],  // skirt, buried well under the ploughed bank
    [-0.94, -0.10],  // shoulder lip
    [-0.88,  0.00],  // paved edge
    [-0.50,  0.035], // camber
    [ 0.00,  0.055], // crown
    [ 0.50,  0.035],
    [ 0.88,  0.00],
    [ 0.94, -0.10],
    [ 1.14, -0.85],
];
/** The offsets above are fractions of this, so the section scales with the road. */
const SECTION_SCALE = ROAD_HALF_WIDTH / 0.88;

export class RoadScene {
    /**
     * @param {import("@babylonjs/core/scene").Scene} scene
     * @param {import("../render/sky.js").Sky} sky
     * @param {import("../render/shadows.js").ShadowSystem} shadows
     * @param {import("../terrain/terrain.js").Terrain} terrain
     */
    constructor(scene, sky, shadows, terrain) {
        this.scene = scene;
        this.sky = sky;
        this.shadows = shadows;
        this.terrain = terrain;

        /** 0..1, how buried the carriageway is. Driven by the weather state. */
        this.snowCover = 0.12;
        /**
         * 0..1 wet/greasy asphalt.
         *
         * Kept low. The sun sits 13 degrees up and the road runs at its own
         * vanishing point, so the specular lobe points straight back down the
         * carriageway into the lens — at 0.35 the entire road was a blown white
         * band and the markings were gone. Wet asphalt is a storm look, and the
         * weather state can raise it when there is a storm to justify it.
         */
        this.wetness = 0.10;

        this.mesh = this._build();
        this.material = this._makeMaterial();
        this.mesh.material = this.material;
        this.mesh.renderingGroupId = 1;

        /** @type {ShaderMaterial[]} */
        this._depthMats = [];
        shadows.registerCaster(
            this.mesh, (c) => this._makeDepthMaterial(c), ROAD_CASCADES
        );

        this._cameraPos = new Vector3();
    }

    // ------------------------------------------------------------- geometry

    _build() {
        /** @type {number[]} */
        const pos = [];
        const nrm = [];
        const uv = [];
        const aux = [];
        const idx = [];

        const ctx = { pos, nrm, uv, aux, idx };
        this._buildCarriageway(ctx);
        this._buildDelineators(ctx);
        this._buildPowerLine(ctx);
        this._buildSigns(ctx);

        const mesh = new Mesh("road", this.scene);
        const vd = new VertexData();
        vd.positions = new Float32Array(pos);
        vd.normals = new Float32Array(nrm);
        vd.uvs = new Float32Array(uv);
        vd.indices = new Uint32Array(idx);
        vd.applyToMesh(mesh, false);
        mesh.setVerticesData("aux", new Float32Array(aux), false, 4);

        mesh.alwaysSelectAsActiveMesh = true;
        mesh.isPickable = false;
        mesh.freezeWorldMatrix();
        mesh.doNotSyncBoundingInfo = true;
        mesh.metadata = { triangles: idx.length / 3, vertices: pos.length / 3 };
        return mesh;
    }

    /** Height of the graded corridor `t` metres along the centreline. */
    _baseAt(t) {
        return this.terrain.heightAt(ROAD_DIR.x * t, ROAD_DIR.z * t) + ROAD_LIFT;
    }

    _buildCarriageway(c) {
        const cols = SECTION.length;
        const t0 = -ROAD_LENGTH;
        const rows = Math.ceil((ROAD_LENGTH * 2) / SEGMENT) + 1;

        for (let r = 0; r < rows; r++) {
            const t = t0 + r * SEGMENT;
            const base = this._baseAt(t);
            // Slope along the road, so the surface normal tilts with the grade
            // instead of every section being level and the lighting stepping.
            const dh = (this._baseAt(t + SEGMENT) - this._baseAt(t - SEGMENT))
                     / (SEGMENT * 2);

            for (let s = 0; s < cols; s++) {
                const off = SECTION[s][0] * SECTION_SCALE;
                const dy = SECTION[s][1];
                c.pos.push(
                    ROAD_DIR.x * t + ROAD_PERP.x * off,
                    base + dy,
                    ROAD_DIR.z * t + ROAD_PERP.z * off
                );

                // Across-slope from the section profile, along-slope from the
                // grade. Both are small, so the normal is essentially up — but
                // the camber is what catches the low sun across the crown.
                const dxPrev = s > 0 ? SECTION[s - 1] : SECTION[s];
                const dxNext = s < cols - 1 ? SECTION[s + 1] : SECTION[s];
                const run = (dxNext[0] - dxPrev[0]) * SECTION_SCALE;
                const rise = dxNext[1] - dxPrev[1];
                const slopeAcross = run !== 0 ? rise / run : 0;

                const nx = -slopeAcross * ROAD_PERP.x - dh * ROAD_DIR.x;
                const nz = -slopeAcross * ROAD_PERP.z - dh * ROAD_DIR.z;
                const inv = 1 / Math.hypot(nx, 1, nz);
                c.nrm.push(nx * inv, inv, nz * inv);

                c.uv.push(off, t);
                c.aux.push(0, 0, 0, 0); // KIND_ROAD
            }
        }

        for (let r = 0; r < rows - 1; r++) {
            for (let s = 0; s < cols - 1; s++) {
                const a = r * cols + s;
                const b = a + 1;
                const d = a + cols;
                const e = d + 1;
                c.idx.push(a, d, b, b, d, e);
            }
        }
    }

    _buildDelineators(c) {
        const off = ROAD_HALF_WIDTH + 1.35;
        for (let t = -PROP_RANGE; t <= PROP_RANGE; t += POST_SPACING) {
            for (const side of [-1, 1]) {
                const x = ROAD_DIR.x * t + ROAD_PERP.x * off * side;
                const z = ROAD_DIR.z * t + ROAD_PERP.z * off * side;
                const y = this.terrain.heightAt(x, z);
                // Post: slim, white, 1.05 m of it above the snow.
                addPrism(c, x, y - 0.15, z, 0.055, 1.20, 1, 0.85);
                // Reflector head, facing back down the road at the traffic.
                addPlate(
                    c, x, y + 0.90, z,
                    ROAD_DIR.x, ROAD_DIR.z,
                    0.075, 0.11, 2, 0
                );
            }
        }
    }

    _buildPowerLine(c) {
        /** @type {Array<{x:number,y:number,z:number,top:number}>} */
        const poles = [];
        for (let t = -PROP_RANGE; t <= PROP_RANGE; t += POLE_SPACING) {
            const x = ROAD_DIR.x * t + ROAD_PERP.x * POLE_OFFSET;
            const z = ROAD_DIR.z * t + ROAD_PERP.z * POLE_OFFSET;
            const y = this.terrain.heightAt(x, z);
            const height = 8.6;
            addPrism(c, x, y - 0.4, z, 0.13, height + 0.4, 1, 0.55);
            // Crossarm, across the line so it silhouettes against the sky.
            addBeam(
                c, x, y + height - 0.55, z,
                ROAD_PERP.x, ROAD_PERP.z, 1.15, 0.07, 1, 0.55
            );
            poles.push({ x, y, z, top: y + height });
        }

        // Three conductors per span, sagging. The sag is what makes a power line
        // read as a power line rather than as a row of poles joined by rulers.
        for (let i = 0; i < poles.length - 1; i++) {
            const a = poles[i];
            const b = poles[i + 1];
            for (const lane of [-1.0, 0, 1.0]) {
                addWire(
                    c,
                    a.x + ROAD_PERP.x * lane, a.top - 0.55, a.z + ROAD_PERP.z * lane,
                    b.x + ROAD_PERP.x * lane, b.top - 0.55, b.z + ROAD_PERP.z * lane,
                    2.1
                );
            }
        }
    }

    _buildSigns(c) {
        // Sparse and deliberately plain. Enough to say "maintained highway";
        // not so many that the steppe starts to look like a retail park.
        const at = [-430, 120, 610];
        const off = ROAD_HALF_WIDTH + 3.4;
        for (let i = 0; i < at.length; i++) {
            const t = at[i];
            const x = ROAD_DIR.x * t + ROAD_PERP.x * off;
            const z = ROAD_DIR.z * t + ROAD_PERP.z * off;
            const y = this.terrain.heightAt(x, z);
            addPrism(c, x - ROAD_PERP.x * 0.5, y - 0.2, z - ROAD_PERP.z * 0.5, 0.05, 2.5, 1, 0.4);
            addPrism(c, x + ROAD_PERP.x * 0.5, y - 0.2, z + ROAD_PERP.z * 0.5, 0.05, 2.5, 1, 0.4);
            addPlate(
                c, x, y + 2.45, z,
                ROAD_DIR.x, ROAD_DIR.z,
                1.15, 0.72, 4, 1
            );
        }
    }

    // ------------------------------------------------------------- material

    _makeMaterial() {
        const mat = new ShaderMaterial(
            "road", this.scene, { vertex: "road", fragment: "road" },
            {
                attributes: ["position", "normal", "uv", "aux"],
                uniforms: [
                    "viewProjection", "cameraPos",
                    "sunDir", "sunRadiance", "shR",
                    "cascadeMatrices", "cascadeSplits", "cascadeParams",
                    "shadowTexel", "shadowSoftness", "shadowBias",
                    "fogDensity", "fogHeightFalloff", "fogStart", "aerialStrength",
                    "ambientIntensity", "snowCover", "roadWetness", "halfWidth",
                ],
                samplers: ["skyLUT", "cascade0", "cascade1", "cascade2"],
                shaderLanguage: ShaderLanguage.WGSL,
            }
        );
        // Posts, wires and sign plates are single-quad shells; the fragment
        // stage turns the normal toward the viewer rather than trusting winding.
        mat.backFaceCulling = false;
        mat.setTexture("skyLUT", this.sky.lut);
        for (let i = 0; i < CASCADE_COUNT; i++) {
            mat.setTexture("cascade" + i, this.shadows.maps[i]);
        }
        return mat;
    }

    _makeDepthMaterial(cascade) {
        const mat = new ShaderMaterial(
            "roadDepth" + cascade, this.scene,
            { vertex: "roadDepth", fragment: "terrainDepth" },
            {
                attributes: ["position"],
                uniforms: ["lightViewProjection"],
                shaderLanguage: ShaderLanguage.WGSL,
                // A distinct Effect per cascade, so each holds its own matrix
                // without any mid-frame uniform juggling.
                defines: ["ROAD_CASCADE " + cascade],
            }
        );
        mat.backFaceCulling = false;
        this._depthMats.push(mat);
        return mat;
    }

    /** @param {import("../render/depthPass.js").DepthPass} depth */
    registerPrepass(depth) {
        const mat = new ShaderMaterial(
            "roadPrepass", this.scene,
            { vertex: "roadPrepass", fragment: "prepass" },
            {
                attributes: ["position"],
                uniforms: ["viewProjection"],
                shaderLanguage: ShaderLanguage.WGSL,
            }
        );
        mat.backFaceCulling = false;
        this.prepassMat = mat;
        depth.registerCaster(this.mesh, mat);
    }

    // --------------------------------------------------------------- frame

    /** @param {Vector3} cameraPos */
    update(cameraPos) {
        this._cameraPos.copyFrom(cameraPos);
        const m = this.material;
        const sky = this.sky;
        const sh = this.shadows;

        m.setVector3("cameraPos", this._cameraPos);
        m.setVector3("sunDir", sky.sunDir);
        m.setColor3("sunRadiance", sky.sunRadiance);
        m.setArray4("shR", sky.sh);

        bindMatrixArray(m, "cascadeMatrices", sh.matrixData);
        _splits.set(sh.splits[0], sh.splits[1], sh.splits[2], sh.splits[3]);
        m.setVector4("cascadeSplits", _splits);
        m.setArray4("cascadeParams", sh.paramData);
        m.setFloat("shadowTexel", sh.texelSize);
        m.setFloat("shadowSoftness", 1.5);
        // Tighter than the terrain's: the corridor is nearly flat, so there is
        // no slope to acne, and a loose bias would detach the delineators'
        // contact shadows — the thing that tells you they are standing in snow.
        m.setFloat("shadowBias", 0.015);

        m.setFloat("fogDensity", S.fogDensity);
        m.setFloat("fogHeightFalloff", S.fogHeightFalloff);
        m.setFloat("fogStart", S.fogStart);
        m.setFloat("aerialStrength", S.aerialStrength);
        m.setFloat("ambientIntensity", S.ambientIntensity);

        m.setFloat("snowCover", this.snowCover);
        m.setFloat("roadWetness", this.wetness);
        m.setFloat("halfWidth", ROAD_HALF_WIDTH);
    }

    async warmUp() {
        await whenReady(this.material, "road material", [this.mesh, false]);
        for (let i = 0; i < this._depthMats.length; i++) {
            await whenReady(
                this._depthMats[i], this._depthMats[i].name, [this.mesh, false]
            );
        }
        if (this.prepassMat) {
            await whenReady(this.prepassMat, "road prepass", [this.mesh, false]);
        }
    }

    get triangles() {
        return this.mesh.isVisible ? this.mesh.metadata.triangles : 0;
    }

    dispose() {
        this.mesh.dispose();
        this.material.dispose();
    }
}

// --------------------------------------------------------------- primitives
//
// All of these append into the shared arrays and share one convention: `kind`
// goes into aux.x and a per-kind parameter into aux.y.

/** A square prism standing on its base. Posts, poles, sign legs. */
function addPrism(c, x, y, z, radius, height, kind, tone) {
    const base = c.pos.length / 3;
    const r = radius;
    const corners = [[-r, -r], [r, -r], [r, r], [-r, r]];
    const normals = [[0, -1], [1, 0], [0, 1], [-1, 0]];

    for (let i = 0; i < 4; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 4];
        const n = normals[i];
        for (const [cx, cz, cy, v] of [
            [a[0], a[1], 0, 0], [b[0], b[1], 0, 0],
            [b[0], b[1], height, 1], [a[0], a[1], height, 1],
        ]) {
            c.pos.push(x + cx, y + cy, z + cz);
            c.nrm.push(n[0], 0, n[1]);
            c.uv.push(v, cy);
            c.aux.push(kind, tone, 0, 0);
        }
        const q = base + i * 4;
        c.idx.push(q, q + 1, q + 2, q, q + 2, q + 3);
    }
}

/** A horizontal box, for crossarms. `dx,dz` is its long axis. */
function addBeam(c, x, y, z, dx, dz, halfLen, radius, kind, tone) {
    const base = c.pos.length / 3;
    const px = -dz, pz = dx;
    const r = radius;
    // Four faces around the long axis.
    const ring = [[0, -r], [r, 0], [0, r], [-r, 0]];
    for (let i = 0; i < 4; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % 4];
        const nx = (a[0] + b[0]) * 0.5;
        const ny = (a[1] + b[1]) * 0.5;
        const inv = 1 / (Math.hypot(nx, ny) || 1);
        for (const [o, s] of [[a, -1], [b, -1], [b, 1], [a, 1]]) {
            c.pos.push(
                x + dx * halfLen * s + px * o[0],
                y + o[1],
                z + dz * halfLen * s + pz * o[0]
            );
            c.nrm.push(px * nx * inv, ny * inv, pz * nx * inv);
            c.uv.push(s * halfLen, o[1]);
            c.aux.push(kind, tone, 0, 0);
        }
        const q = base + i * 4;
        c.idx.push(q, q + 1, q + 2, q, q + 2, q + 3);
    }
}

/**
 * A flat plate facing along `(dx, dz)`. Reflector heads and sign faces.
 * `uv` runs -1..1 across both axes so the fragment stage can draw a border.
 */
function addPlate(c, x, y, z, dx, dz, halfW, halfH, kind, face) {
    const base = c.pos.length / 3;
    const px = -dz, pz = dx;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        c.pos.push(x + px * halfW * u, y + halfH * v, z + pz * halfW * u);
        c.nrm.push(dx, 0, dz);
        c.uv.push(u, v);
        c.aux.push(kind, face, 0, 0);
    }
    c.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** A sagging conductor between two points, as a thin ribbon. */
function addWire(c, x0, y0, z0, x1, y1, z1, sag) {
    const STEPS = 10;
    const base = c.pos.length / 3;
    const halfW = 0.035;
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const px = -dz / len, pz = dx / len;

    for (let i = 0; i <= STEPS; i++) {
        const t = i / STEPS;
        // A parabola is indistinguishable from a catenary at these spans and
        // costs nothing to evaluate.
        const droop = sag * 4 * t * (1 - t);
        const x = x0 + dx * t;
        const z = z0 + dz * t;
        const y = y0 + (y1 - y0) * t - droop;
        for (const s of [-1, 1]) {
            c.pos.push(x + px * halfW * s, y, z + pz * halfW * s);
            c.nrm.push(0, 1, 0);
            c.uv.push(s, t * len);
            c.aux.push(3, 0, 0, 0); // KIND_WIRE
        }
    }
    for (let i = 0; i < STEPS; i++) {
        const a = base + i * 2;
        c.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
}
