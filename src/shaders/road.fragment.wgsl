// -----------------------------------------------------------------------------
// The highway surface, and the furniture standing beside it.
//
// Everything here is procedural off the road's own parameterisation — `vUV` is
// (metres across, metres along) — so there is not one texture in the corridor.
// That is not a purity exercise: the markings have to stay pin sharp a hundred
// metres out and the snow has to be able to creep across the carriageway on a
// continuous parameter, and both are far easier to do analytically than to
// author and then fight the mip chain over.
//
// Lighting is not reimplemented. The sun, the SH ambient, the cascade lookup and
// the aerial perspective all come from the same includes the snow material uses,
// so the asphalt sits under the identical sky and the identical fog. A road lit
// by its own approximation of this scene's light would read as pasted on, and
// no amount of surface detail would rescue it.
//
// `snowCover` is the parameter BORAN drives. At 0 the carriageway is clear wet
// asphalt; at 1 it has disappeared under drifting snow, wheel tracks and all.
// Everything in between is the visual half of the risk story.
// -----------------------------------------------------------------------------

#include<snowNoise>
#include<snowShading>
#include<snowAtmosphere>

varying vWorld: vec3f;
varying vNormal: vec3f;
varying vUV: vec2f;
varying vAux: vec4f;
varying vViewDist: f32;

var skyLUT: texture_2d<f32>;
var skyLUTSampler: sampler;
var cascade0: texture_2d<f32>;
var cascade0Sampler: sampler;
var cascade1: texture_2d<f32>;
var cascade1Sampler: sampler;
var cascade2: texture_2d<f32>;
var cascade2Sampler: sampler;

uniform cameraPos: vec3f;
uniform sunDir: vec3f;
uniform sunRadiance: vec3f;
uniform shR: array<vec4f, 9>;

uniform cascadeMatrices: array<mat4x4f, 3>;
uniform cascadeSplits: vec4f;
uniform cascadeParams: array<vec4f, 3>;
uniform shadowTexel: f32;
uniform shadowSoftness: f32;
uniform shadowBias: f32;

uniform fogDensity: f32;
uniform fogHeightFalloff: f32;
uniform fogStart: f32;
uniform aerialStrength: f32;
uniform ambientIntensity: f32;

/// 0 = clear carriageway, 1 = fully covered. Driven by the weather state.
uniform snowCover: f32;
/// 0 = dry, 1 = wet/greasy. Darkens the asphalt and sharpens its specular.
uniform roadWetness: f32;
/// Half the paved width in metres, so the markings track the real geometry.
uniform halfWidth: f32;

#include<snowShadowLookup>

// Surface kinds, matching `road/roadScene.js`.
const KIND_ROAD: f32 = 0.0;
const KIND_POST: f32 = 1.0;
const KIND_REFLECTOR: f32 = 2.0;
const KIND_WIRE: f32 = 3.0;
const KIND_SIGN: f32 = 4.0;

/// Fresh snow, matched to the terrain's own albedo so the drift creeping onto
/// the tarmac is the same white as the drift it came from.
const SNOW_ALBEDO: vec3f = vec3f(0.83, 0.86, 0.91);

/// Analytically antialiased stripe: 1 inside `|x| < half`, fading over one pixel.
/// `fw` is the world-space width of a pixel across the road, from fwidth().
fn stripe(x: f32, half: f32, fw: f32) -> f32 {
    return 1.0 - smoothstep(half - fw, half + fw, abs(x));
}

/// The painted markings: a dashed centre line and two solid edge lines.
///
/// Returns coverage 0..1. Worn by a slow noise along the road so the paint is
/// patchy rather than freshly laid — a perfect line is the fastest way to make a
/// road read as a placeholder.
fn markings(uv: vec2f, fw: f32, hw: f32) -> f32 {
    // Centre line: 15 cm wide, 3 m painted in every 12 m.
    let dash = step(fract(uv.y / 12.0), 0.25);
    var m = stripe(uv.x, 0.075, fw) * dash;

    // Edge lines: 15 cm wide, set 40 cm in from the paved edge.
    let edge = hw - 0.4;
    m = max(m, stripe(abs(uv.x) - edge, 0.075, fw));

    // Wear. Paint goes first where the wheels cross it.
    let wear = 0.55 + 0.45 * noise2(vec2f(uv.y * 0.35, uv.x * 0.8));
    return clamp(m * wear, 0.0, 1.0);
}

/// How much snow is lying at a point on the carriageway.
///
/// Snow does not arrive uniformly. It builds at the edges and along the crown
/// between the wheel paths first, because that is where nothing is driving over
/// it, and the wheel tracks are the last thing to close. Watching those two dark
/// ribbons narrow and finally vanish is the single clearest read on the whole
/// scene that the road is going.
fn roadSnow(uv: vec2f, hw: f32, cover: f32) -> f32 {
    if (cover <= 0.001) { return 0.0; }

    // Four wheel paths: two lanes, tracks 1.6 m apart about each lane centre.
    let laneCentre = hw * 0.5;
    let t0 = abs(abs(uv.x) - (laneCentre - 0.8));
    let t1 = abs(abs(uv.x) - (laneCentre + 0.8));
    let track = max(
        1.0 - smoothstep(0.0, 0.42, t0),
        1.0 - smoothstep(0.0, 0.42, t1)
    );

    // Drift creeps in from the verges.
    let fromEdge = 1.0 - smoothstep(0.0, hw * 0.85, abs(uv.x));
    let edgeBias = mix(1.35, 0.85, fromEdge);

    // Patchiness, stretched along the road the way blown snow actually lies.
    // `drift`, not `patch` — the latter is a reserved keyword in WGSL.
    let drift = 0.62 + 0.5 * noise2(vec2f(uv.x * 0.55, uv.y * 0.11));

    // The tracks resist until the cover is high, then close over.
    let resist = track * (1.0 - smoothstep(0.55, 1.0, cover)) * 0.85;
    return clamp((cover * edgeBias * drift) - resist, 0.0, 1.0);
}

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let world = input.vWorld;
    let uv = input.vUV;
    let kind = input.vAux.x;
    let V = normalize(uniforms.cameraPos - world);
    var N = normalize(input.vNormal);
    // Posts, wires and sign backs are drawn double-sided; turn the normal to
    // face the viewer rather than trusting the winding of a generated strip.
    if (dot(N, V) < 0.0 && kind > 0.5) { N = -N; }

    let L = uniforms.sunDir;
    let viewDist = input.vViewDist;

    // Hoisted out of the `kind` branch below. `fwidth` is a derivative, and WGSL
    // requires those to be evaluated in uniform control flow — `kind` comes from
    // a varying, so a quad straddling the road edge and a delineator would be
    // taking different branches and the derivative would be undefined. Only the
    // road surface uses it; the cost of computing it always is one subtract.
    let fwAcross = max(fwidth(uv.x), 1e-4);

    var albedo = vec3f(0.5);
    var roughness = 0.6;
    var f0 = vec3f(0.04);
    var emissive = vec3f(0.0);
    // Snow lying on the surface, whatever the surface is.
    var lying = 0.0;

    if (kind < 0.5) {
        // ------------------------------------------------------------ asphalt
        let fw = fwAcross;

        // Aggregate. Two scales, because one reads as noise and two read as
        // chippings in binder.
        let coarse = noise2(world.xz * 3.1);
        let fine = noise2(world.xz * 17.0);
        let grain = 0.82 + 0.26 * coarse + 0.14 * fine;

        // Dark, and darker still where it is wet. Asphalt is one of the lowest
        // albedo surfaces there is, and letting it drift up towards grey is what
        // makes a snow scene with a road in it look like a car park.
        var base = vec3f(0.052, 0.054, 0.060) * grain;
        base = mix(base, base * 0.62, uniforms.roadWetness);

        // Ruts polished by traffic: slightly darker and much smoother.
        let laneCentre = uniforms.halfWidth * 0.5;
        let rut = max(
            1.0 - smoothstep(0.0, 0.5, abs(abs(uv.x) - (laneCentre - 0.8))),
            1.0 - smoothstep(0.0, 0.5, abs(abs(uv.x) - (laneCentre + 0.8)))
        );
        base *= mix(1.0, 0.86, rut);

        let paint = markings(uv, fw, uniforms.halfWidth);
        albedo = mix(base, vec3f(0.62, 0.63, 0.60), paint);

        // The wet floor is 0.42, not 0.30. Below that the GGX lobe narrows
        // enough that a 13-degree sun looking straight down the road returns a
        // highlight brighter than the snow beside it, and the carriageway
        // becomes a white band with no markings on it.
        roughness = mix(0.62, 0.42, uniforms.roadWetness) * mix(1.0, 0.86, rut);
        roughness = mix(roughness, 0.52, paint);
        f0 = mix(vec3f(0.04), vec3f(0.055), uniforms.roadWetness);

        lying = roadSnow(uv, uniforms.halfWidth, uniforms.snowCover);
    } else if (kind < 1.5) {
        // ------------------------------------------- galvanised post / concrete
        // `tone` 0 is weathered steel, 1 is the white plastic of a delineator.
        // The posts have to read as markers against snow at two hundred metres,
        // and mid-grey does not — it reads as a row of dark stakes.
        let tone = input.vAux.y;
        albedo = mix(vec3f(0.115, 0.122, 0.133), vec3f(0.56, 0.57, 0.56), tone);
        roughness = 0.58;
        f0 = vec3f(0.06);
        // Snow sticks to the windward face and to anything near horizontal.
        lying = uniforms.snowCover * 0.55 * clamp(N.y, 0.0, 1.0);
    } else if (kind < 2.5) {
        // -------------------------------------------------------- reflector
        // A delineator head. Retroreflective sheeting sends light back the way
        // it came, so it lifts sharply as the view direction closes on the
        // normal — which is what makes a line of them read as a receding chain
        // of points rather than as a row of specks.
        let facing = pow(clamp(dot(N, V), 0.0, 1.0), 3.0);
        albedo = vec3f(0.42, 0.20, 0.06);
        roughness = 0.34;
        f0 = vec3f(0.05);
        // Deliberately restrained. This is a daylight scene; the reflectors
        // should catch the eye down the road, not glow.
        emissive = vec3f(1.00, 0.46, 0.16) * facing * 0.85;
    } else if (kind < 3.5) {
        // ------------------------------------------------------------- wire
        albedo = vec3f(0.030, 0.031, 0.034);
        roughness = 0.42;
        f0 = vec3f(0.07);
    } else {
        // ------------------------------------------------------------- sign
        let face = input.vAux.y;
        // Blue ground with a white border, the European/CIS convention.
        let border = max(
            1.0 - smoothstep(0.80, 0.88, abs(uv.x)),
            0.0
        ) * (1.0 - smoothstep(0.80, 0.88, abs(uv.y)));
        let plate = mix(vec3f(0.58, 0.60, 0.62), vec3f(0.035, 0.105, 0.255), border);
        albedo = mix(vec3f(0.16, 0.17, 0.18), plate, face);
        roughness = 0.42;
        f0 = vec3f(0.05);
        lying = uniforms.snowCover * 0.35 * clamp(N.y, 0.0, 1.0);
    }

    // ---- snow lying on top -------------------------------------------------
    // Blended into the surface properties rather than drawn as a second layer:
    // one shading evaluation, and the transition is a material property rather
    // than an alpha edge that would crawl under TAA.
    albedo = mix(albedo, SNOW_ALBEDO, lying);
    roughness = mix(roughness, 0.86, lying);
    f0 = mix(f0, vec3f(0.028), lying);
    emissive *= (1.0 - lying);

    // ------------------------------------------------------------- lighting
    let NdotL = dot(N, L);
    let NdotV = clamp(dot(N, V), 1e-4, 1.0);
    const INV_PI: f32 = 0.31830988618;

    let noiseRot = ign(input.position.xy) * 6.28318530718;
    var shadow = 1.0;
    if (NdotL > -0.2) {
        shadow = sunShadow(world, N, viewDist, noiseRot);
    }

    let sunRadiance = uniforms.sunRadiance;

    // Snow on the road wraps its terminator the way the snow field does; bare
    // asphalt does not. One lerp keeps the two consistent as the cover changes.
    let diff = wrapDiffuse(NdotL, mix(0.08, 0.55, lying));
    var color = albedo * INV_PI * sunRadiance * diff * shadow;

    if (NdotL > 0.0) {
        let H = normalize(V + L);
        let NdotH = clamp(dot(N, H), 0.0, 1.0);
        let VdotH = clamp(dot(V, H), 0.0, 1.0);
        let D = distributionGGX(NdotH, roughness);
        let Vis = visSmithGGXCorrelated(NdotV, clamp(NdotL, 0.0, 1.0), roughness);
        let F = fresnelSchlick(VdotH, f0);
        color += sunRadiance * D * Vis * F * NdotL * shadow;
    }

    // Ambient: the same SH sky the snow reads, plus a bounce off the field.
    // The bounce matters more here than anywhere — a dark surface surrounded by
    // a huge bright one gets most of its light this way, and without it the
    // asphalt goes to a dead black hole in the middle of the frame.
    var irradiance = shIrradiance(N, uniforms.shR) * uniforms.ambientIntensity;
    irradiance += shIrradiance(vec3f(0.0, 1.0, 0.0), uniforms.shR)
                * uniforms.ambientIntensity * 0.22 * clamp(N.y * 0.5 + 0.5, 0.0, 1.0)
                * SNOW_ALBEDO;
    color += albedo * INV_PI * irradiance;

    let R = reflect(-V, N);
    let mip = sqrt(roughness) * 6.0;
    let skyRefl = textureSampleLevel(skyLUT, skyLUTSampler, dirToLatLong(R), mip).rgb;
    let Fr = fresnelSchlickRough(NdotV, f0, roughness);

    // Grazing specular occlusion.
    //
    // A road seen almost edge-on returns the horizon sky at nearly full
    // Fresnel. That is correct, and on this scene it is ruinous: the camera sits
    // 1.5 m above a carriageway that runs to its own vanishing point, so most of
    // the road is at extreme grazing incidence, and the horizon it reflects is
    // exactly where the 13-degree sun is. The result was a white band a hundred
    // metres long with no markings left on it.
    //
    // What the analytic Fresnel omits is that a rough surface's microfacets
    // shadow each other at grazing angles, so the real reflectance falls well
    // short of the smooth-surface limit. This stands in for that, scaled by
    // roughness so a wet road still gets its sheen.
    let specOcc = clamp(mix(1.0, NdotV * 1.5, roughness), 0.10, 1.0);
    color += skyRefl * Fr * uniforms.ambientIntensity * specOcc;

    color += emissive * sunRadiance * 0.05;

    // ------------------------------------------------------- aerial perspective
    color = applyAerial(
        color, uniforms.cameraPos, world, -V, L,
        skyLUT, skyLUTSampler, sunRadiance,
        uniforms.fogDensity, uniforms.fogHeightFalloff, uniforms.fogStart,
        uniforms.aerialStrength
    );

    fragmentOutputs.color = vec4f(color, 1.0);
}
