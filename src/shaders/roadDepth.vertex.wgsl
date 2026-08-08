// The road corridor's shadow pass.
//
// Static world-space geometry, so unlike the terrain there is no displacement to
// reproduce here — the position the beauty pass draws is the position in the
// buffer. Paired with `terrainDepth`'s fragment stage, which writes NDC depth as
// R32F for the PCSS blocker search.

attribute position: vec3f;

uniform lightViewProjection: mat4x4f;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    vertexOutputs.position = uniforms.lightViewProjection * vec4f(input.position, 1.0);
}
