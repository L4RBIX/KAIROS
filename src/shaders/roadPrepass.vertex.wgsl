// The road corridor's camera-space depth prepass.
//
// `viewProjection` is bound from the active camera, which during this target's
// render carries the frame's temporal jitter — so the depth and the colour line
// up to the subpixel, which the reflection and depth-of-field passes both need.
//
// The specular mask is zero: asphalt under snow is not a mirror, and the screen
// space reflection pass only marches where the mask is non-zero.

attribute position: vec3f;

uniform viewProjection: mat4x4f;

varying vViewZ: f32;
varying vMask: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let clip = uniforms.viewProjection * vec4f(input.position, 1.0);
    vertexOutputs.vViewZ = clip.w;
    vertexOutputs.vMask = 0.0;
    vertexOutputs.position = clip;
}
