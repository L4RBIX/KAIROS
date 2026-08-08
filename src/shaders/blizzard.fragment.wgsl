// GPU blizzard grains / wind streaks.
//
// Intentionally not soft circular bokeh. Near particles are elongated in the
// vertex stage; this stage adds an irregular flake edge and ties the grain into
// the scene fog so it completes the existing whiteout stack rather than sitting
// on top as screen-space glitter.

#include<snowNoise>
#include<snowAtmosphere>

varying vCorner: vec2f;
varying vAlpha: f32;
varying vViewDist: f32;
varying vNear: f32;
varying vSeed: f32;

var skyLUT: texture_2d<f32>;
var skyLUTSampler: sampler;

uniform sunDir: vec3f;
uniform sunRadiance: vec3f;
uniform fogDensity: f32;
uniform fogHeightFalloff: f32;
uniform fogStart: f32;
uniform aerialStrength: f32;
uniform ambientIntensity: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let a0 = input.vAlpha;
    if (a0 < 0.004) { discard; }

    let c = input.vCorner;
    // Streak-aware radius: along-axis (x) is already stretched in the VS, so a
    // slightly diamond/flake profile reads as a grain rather than a disc.
    let flake = abs(c.x) * abs(c.x) + abs(c.y) * abs(c.y) * 1.15;
    let wob = 0.78 + 0.28 * hash11(input.vSeed * 41.0 + c.x * 3.0 + c.y * 7.0);
    let r = flake / wob;
    if (r > 1.0) { discard; }

    // Harder core for near streaks; softer falloff for distant mass.
    let edge = select(
        smoothstep(1.0, 0.22, r),
        smoothstep(1.0, 0.40, r) * smoothstep(1.0, 0.12, abs(c.y)),
        input.vNear >= 0.5
    );
    var alpha = a0 * edge;
    if (alpha < 0.004) { discard; }

    // Bright ice, not dark grey. ALPHA_COMBINE darkens the plate if rgb is dim;
    // grains must sit near scene-referred snow white.
    let warm = clamp(uniforms.sunDir.y * 0.5 + 0.55, 0.0, 1.0);
    var rgb = vec3f(0.96, 0.98, 1.0);
    rgb = mix(rgb, vec3f(1.0, 0.96, 0.90), warm * 0.18);
    rgb *= 0.85 + 0.25 * uniforms.ambientIntensity;
    // Tiny sun lift — keep well below bloom thresholds.
    rgb += uniforms.sunRadiance * 0.004;

    // Fog cooperation: dissolve with distance into the aerial stack.
    let fogAmt = 1.0 - exp(-uniforms.fogDensity * max(0.0, input.vViewDist - uniforms.fogStart));
    let fogAmt2 = clamp(fogAmt * uniforms.aerialStrength, 0.0, 1.0);
    let fogCol = vec3f(0.90, 0.93, 0.97);
    rgb = mix(rgb, fogCol, fogAmt2 * 0.55);
    alpha *= mix(1.0, 0.45, fogAmt2 * 0.75);

    fragmentOutputs.color = vec4f(rgb, alpha);
}
