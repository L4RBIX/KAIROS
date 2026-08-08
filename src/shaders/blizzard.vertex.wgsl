// GPU blizzard billboards.
//
// position.x = particle id, position.yz = corner in [-1,1].
// World position is reconstructed here — no particle texture, no CPU sim.

attribute position: vec3f;

uniform viewProjection: mat4x4f;
uniform cameraPos: vec3f;
uniform camRight: vec3f;
uniform camUp: vec3f;
uniform camForward: vec3f;
uniform time: f32;
uniform runtimeWind: vec3f;
uniform gustStrength: f32;
uniform blizzardDensity: f32;
uniform blizzardOpacity: f32;
uniform nearSnowIntensity: f32;
uniform volumeHalf: vec3f;
uniform volumeDepth: f32;

varying vCorner: vec2f;
varying vAlpha: f32;
varying vViewDist: f32;
varying vNear: f32;
varying vSeed: f32;

fn hash11(n: f32) -> f32 {
    var p = fract(n * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}

fn hash13(n: f32) -> vec3f {
    var p = fract(vec3f(n) * vec3f(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
}

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let id = vertexInputs.position.x;
    let corner = vertexInputs.position.yz;
    let seed = hash11(id * 17.13 + 0.7);
    let h = hash13(id * 3.1 + 11.0);

    // Density gate: calm weather collapses most grains; whiteout keeps nearly all.
    let alive = step(h.x, uniforms.blizzardDensity * 0.98 + 0.02);
    // Near layer: ~18% of the pool, stronger when nearSnowIntensity rises.
    let nearGate = step(0.82, h.y);
    let near = nearGate * uniforms.nearSnowIntensity;

    let halfW = max(1.0, uniforms.volumeHalf.x);
    let halfH = max(1.0, uniforms.volumeHalf.y);
    let depth = max(4.0, uniforms.volumeDepth);
    let spanW = halfW * 2.0;
    let spanH = halfH * 2.0;

    // Advection rates. Fall always present; wind dominates as gustStrength rises.
    let fall = 1.15 + seed * 1.65;
    let windScale = 2.4 + uniforms.gustStrength * 3.8;
    let wind = uniforms.runtimeWind * windScale;
    let t = uniforms.time;

    // Stable wrap via fract — avoids float precision death after long sessions.
    let turbX = sin(t * (1.3 + seed * 0.7) + id * 0.11) * (0.35 + uniforms.gustStrength * 0.9);
    let turbY = cos(t * (0.9 + seed * 0.5) + id * 0.07) * 0.25;
    let turbZ = sin(t * (1.1 + seed * 0.6) + id * 0.13) * (0.35 + uniforms.gustStrength * 0.9);

    let u = fract(h.x + (wind.x + turbX) * t / spanW + seed * 0.37);
    let v = fract(h.y + (-fall + turbY) * t / spanH + seed * 0.19);
    // Near grains stay in the first ~12 m; far grains fill the volume.
    let zSpan = select(12.0, depth, near < 0.5);
    let zBase = select(0.5, 3.5, near < 0.5);
    let w = fract(h.z + (wind.z + turbZ) * t / zSpan + seed * 0.53);
    let wx = (u - 0.5) * spanW * select(0.55, 1.0, near < 0.5);
    let wy = (v - 0.5) * spanH * select(0.65, 1.0, near < 0.5);
    let wz = zBase + w * (zSpan - zBase);

    // Soft fade near the far wrap plane.
    let wrapFade = smoothstep(0.0, 2.2, wz) * smoothstep(zSpan, zSpan - 3.5, wz);

    let center = uniforms.cameraPos
        + uniforms.camRight * wx
        + uniforms.camUp * wy
        + uniforms.camForward * wz;

    var vel = wind + vec3f(turbX, turbY - fall, turbZ);
    var along = vel - uniforms.camForward * dot(vel, uniforms.camForward);
    let alongLen = length(along);
    if (alongLen > 1e-4) {
        along /= alongLen;
    } else {
        along = uniforms.camRight;
    }
    var across = cross(uniforms.camForward, along);
    let acrossLen = length(across);
    if (acrossLen > 1e-4) {
        across /= acrossLen;
    } else {
        across = uniforms.camUp;
    }

    let speed = length(vel);
    let stretch = select(
        1.15 + min(2.2, speed * 0.12),
        2.4 + min(5.5, speed * 0.22) * (0.55 + near),
        near >= 0.5
    );
    let width = select(
        0.018 + seed * 0.028,
        0.028 + seed * 0.045,
        near >= 0.5
    ) * select(0.55, 1.0, alive > 0.5);

    let world = center
        + along * (corner.x * width * stretch)
        + across * (corner.y * width);

    let viewDist = distance(world, uniforms.cameraPos);
    var alpha = uniforms.blizzardOpacity
        * select(0.34 + seed * 0.22, 0.62 + seed * 0.30, near >= 0.5)
        * wrapFade
        * alive;
    alpha *= mix(0.80, 1.20, smoothstep(3.0, 16.0, viewDist));
    alpha = clamp(alpha, 0.0, 0.92) * alive;

    vertexOutputs.position = uniforms.viewProjection * vec4f(world, 1.0);
    vertexOutputs.vCorner = corner;
    vertexOutputs.vAlpha = alpha;
    vertexOutputs.vViewDist = viewDist;
    vertexOutputs.vNear = near;
    vertexOutputs.vSeed = seed;
}
