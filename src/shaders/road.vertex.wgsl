// The highway and everything standing beside it.
//
// One pipeline draws the carriageway, the delineator posts, the power poles,
// their wires and the signs. They are one mesh and one material because they
// are one thing — a maintained road corridor — and because five nearly
// identical pipelines would each need their own shadow material, their own
// prepass material and their own warm-up for no visual gain.
//
// Geometry is static and pre-placed in world space, so this stage only
// projects. `uv` carries the road's own parameterisation — x across in metres
// (signed, zero on the centreline), y along in metres — which is what lets the
// fragment stage draw the markings, the wheel tracks and the drifting snow
// without a single texture.

attribute position: vec3f;
attribute normal: vec3f;
attribute uv: vec2f;
/// (kind, p0, p1, p2). See `KIND_*` in the fragment stage.
attribute aux: vec4f;

uniform viewProjection: mat4x4f;
uniform cameraPos: vec3f;

varying vWorld: vec3f;
varying vNormal: vec3f;
varying vUV: vec2f;
varying vAux: vec4f;
varying vViewDist: f32;

@vertex
fn main(input: VertexInputs) -> FragmentInputs {
    let world = input.position;

    vertexOutputs.vWorld = world;
    vertexOutputs.vNormal = input.normal;
    vertexOutputs.vUV = input.uv;
    vertexOutputs.vAux = input.aux;
    vertexOutputs.vViewDist = distance(world, uniforms.cameraPos);
    vertexOutputs.position = uniforms.viewProjection * vec4f(world, 1.0);
}
