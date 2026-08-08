// Bakes the macro landform (broad dunes + medium drifts + rock outcrops) into a
// single-channel float texture covering the whole playable field.
//
// Baked rather than evaluated live for one reason: the CPU needs the same
// heights for character grounding, footfall placement and spell hit points, and
// reading back a GPU bake is the only way to guarantee the two never disagree.
// Re-implementing the noise in JS would drift the moment f32 and f64 rounding
// diverged, and the character would float or sink by centimetres.
//
// The highway corridor is carved here for exactly that reason: the road mesh is
// built on the CPU against the mirror of this texture, so it can only sit
// correctly on the ground if the ground is decided here.

#include<snowNoise>
#include<snowTerrain>

varying vUV: vec2f;

uniform worldOrigin: vec2f;
uniform worldSize: f32;
uniform windAngle: f32;
uniform heightAmp: f32;

// The highway. See `road/roadLayout.js`, which is where these come from.
uniform roadOrigin: vec2f;
uniform roadDir: vec2f;
uniform roadHalfWidth: f32;
uniform roadShoulder: f32;
uniform roadBerm: f32;

@fragment
fn main(input: FragmentInputs) -> FragmentOutputs {
    let p = uniforms.worldOrigin + input.vUV * uniforms.worldSize;

    var h = terrainMacro(p, uniforms.windAngle, uniforms.heightAmp);

    // Rock displaces snow upward; snow then re-accumulates on the flatter faces,
    // which the snow material resolves from the mask in the aux bake.
    let rock = rockField(p, uniforms.windAngle);
    h += rock.x;

    // Grade the corridor, after the rock so an outcrop cannot survive inside it.
    let road = roadCorridor(
        p, h, uniforms.roadOrigin, uniforms.roadDir,
        uniforms.roadHalfWidth, uniforms.roadShoulder, uniforms.roadBerm,
        uniforms.windAngle, uniforms.heightAmp
    );

    fragmentOutputs.color = vec4f(road.x, rock.y * (1.0 - road.z), 0.0, 1.0);
}
