/**
 * BORAN — entry point and frame orchestration.
 *
 * WebGPU only, by design. No WebGL path, no feature-detect branches: if the
 * adapter isn't there we say so once and stop.
 *
 * ## What was removed, and what that leaves
 *
 * This started as SNOWFLOW, a snow-surf demo. The rendering is kept intact; the
 * game is not. The player character, its cloth and fur, the snow-surf wake, the
 * five spells and every input binding are no longer constructed here — those
 * modules still exist on disk, and are simply no longer reachable from the entry
 * point, so the bundler drops them.
 *
 * Three systems were built to be about the player: the camera rig chased it, the
 * clipmap centred its LOD rings on it, and the deformation window followed it.
 * `ProductSubject` stands in for it — five numbers, no gameplay — so none of the
 * three had to be modified to lose the character.
 *
 * The deformation buffer is kept and runs with no writers. It costs one
 * full-screen pass and it is what blowing snow will accumulate into later;
 * removing it now would mean rebuilding it then.
 */

import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
// Side-effect import: installs `captureGPUFrameTime` / `getGPUFrameTimeCounter`
// onto the engine prototype, which is what makes the overlay's GPU row a real
// GPU number rather than the presentation cadence.
import "@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery";
import { Scene } from "@babylonjs/core/scene";
import { Color3, Color4 } from "@babylonjs/core/Maths/math";

import { registerShaders } from "./shaders/registry.js";
import { S, onChange } from "./core/settings.js";
import {
    sample, checkSpike, stats, mark, installDrawCounter, endFrameDraws,
} from "./core/perf.js";
import { initInput, pollInput, endFrame, input } from "./core/input.js";
import { CinematicCamera, installRoadPoses } from "./app/cinematicCamera.js";
import { ProductSubject } from "./app/productSubject.js";
import { RoadScene } from "./road/roadScene.js";
import { WeatherDirector } from "./app/weatherDirector.js";
import { weatherFromRisk } from "./app/weatherState.js";
import { Shell } from "./product/shell.js";
import { RouteFlow } from "./product/routeFlow.js";
import { Replay } from "./product/replay.js";
import { loadSegments } from "./services/predictionService.js";
import { SprayField } from "./vfx/particles.js";
import { BlizzardField } from "./vfx/blizzard.js";
import { SpellLights } from "./spells/spellLights.js";
import { Overlay } from "./ui/overlay.js";
import { Sky } from "./render/sky.js";
import { ShadowSystem } from "./render/shadows.js";
import { Terrain } from "./terrain/terrain.js";
import { DepthPass } from "./render/depthPass.js";
import { PostChain } from "./post/postChain.js";
import { whenReady } from "./core/gpuUtil.js";
import * as loading from "./core/loading.js";

/** `?dev` unlocks the tuning overlay. Off in the product build. */
const DEV = new URLSearchParams(location.search).has("dev");

async function boot() {
    const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById("view"));

    // No WebGPU is not a dead end. The forecast, the departure advice and the
    // replay do not depend on being able to rasterise snow, so the product runs
    // without the environment rather than refusing to run at all.
    if (!navigator.gpu) {
        const { startFallback } = await import("./product/fallback.js");
        startFallback("This browser does not support WebGPU.");
        return;
    }

    await loading.phase("creating device", 0.05);

    const engine = new WebGPUEngine(canvas, {
        antialias: false, // TAA handles edges; MSAA here would just cost bandwidth
        stencil: false,
        powerPreference: "high-performance",
        enableAllFeatures: true,
        setMaximumLimits: true,
    });

    try {
        await engine.initAsync();
    } catch (err) {
        console.error(err);
        const { startFallback } = await import("./product/fallback.js");
        startFallback("This device could not start a WebGPU renderer.");
        return;
    }

    // The heightfield is R32F and is filtered in the vertex shader, which needs
    // this feature. Every desktop GPU that can run this demo has it.
    const filterable = engine.getCaps().textureFloatLinearFiltering;
    if (!filterable) {
        console.warn("[snowflow] float32-filterable unavailable; height will step");
    }

    const applyScale = () => engine.setHardwareScalingLevel(1 / S.resolutionScale);
    applyScale();
    onChange("resolutionScale", applyScale);
    window.addEventListener("resize", () => engine.resize());

    installDrawCounter(engine);
    // WebGPU timestamp queries. The engine is created with `enableAllFeatures`,
    // so `timestamp-query` is on wherever the adapter has it; if it does not,
    // the counter simply stays at zero and the overlay shows a dash.
    engine.captureGPUFrameTime(true);
    registerShaders();

    await loading.phase("building scene", 0.12);

    const scene = new Scene(engine);
    scene.clearColor = new Color4(0.02, 0.03, 0.05, 1);
    scene.autoClear = true;
    // Do NOT clear depth between rendering groups. Babylon clears depth before
    // every group by default; here group 1 is the opaque scene and group 2 is
    // the alpha-blended water and spray, which must depth-test against it.
    scene.setRenderingAutoClearDepthStencil(1, false);
    scene.setRenderingAutoClearDepthStencil(2, false);
    // No stock lights: every material here computes its own lighting.
    scene.ambientColor = new Color3(0, 0, 0);

    const rig = new CinematicCamera(scene, canvas);
    scene.activeCamera = rig.camera;

    // ------------------------------------------------------------------ sky
    await loading.phase("integrating atmosphere", 0.2);
    const sky = new Sky(scene);
    sky.mesh.renderingGroupId = 0;
    await sky.solve();

    // -------------------------------------------------------------- shadows
    const shadows = new ShadowSystem(scene);

    // The camera-space depth prepass. It is a custom render target, and the
    // scene renders those in registration order — so creating it here, after
    // the cascades and before anything that draws, is the whole of the
    // scheduling.
    const depthPass = new DepthPass(scene);

    // -------------------------------------------------------------- terrain
    await loading.phase("baking heightfield", 0.34);
    const terrain = new Terrain(scene, sky, shadows);
    terrain.mesh.renderingGroupId = 1;
    await terrain.build();
    onChange("showTerrain", (v) => (terrain.mesh.isVisible = v));
    depthPass.registerCaster(terrain.mesh, terrain.makePrepassMaterial());

    await loading.phase("grading the highway", 0.55);

    // The corridor itself is already graded into the heightfield — the bake did
    // it, so `terrain.heightAt` describes ground the asphalt can sit on. This
    // lays the carriageway, the delineators, the power line and the signs on it.
    const road = new RoadScene(scene, sky, shadows, terrain);
    road.registerPrepass(depthPass);

    await loading.phase("placing subject", 0.62);

    // What the scene is composed around. Replaces the player character as the
    // point the clipmap and deformation window centre on. Sat on the
    // centreline, so the finest terrain rings are always under the road.
    const subject = new ProductSubject();
    subject.position.set(0, 0, 0);
    subject.position.y = terrain.heightAt(0, 0);

    // The camera frames the road, so it needs the graded heights to place its
    // poses and to keep the eye out of the snow.
    rig.groundAt = (x, z) => terrain.heightAt(x, z);
    installRoadPoses(rig, (x, z) => terrain.heightAt(x, z));

    // Heritage spray pool — idle (no emitters). Kept wired so existing materials
    // and the light pool stay consistent; the product storm is BlizzardField.
    const spray = new SprayField(scene, terrain, sky, shadows);
    const blizzard = new BlizzardField(scene, sky);

    // ------------------------------------------------------- spell lighting
    // The spells are gone; the light pool they fed is not.
    //
    // Six fragment shaders — snow, spray, char, wake, water, crystal — declare
    // `spellLightPos/Col/Count` and gate on `spellLightCount > 0.5`. Those
    // uniforms were only ever written by `SpellLights.apply()`, so with the
    // spell system removed nothing would write them and the gate would rest on
    // the uniform buffer happening to be zero-initialised. That is not a
    // guarantee worth depending on across drivers.
    //
    // So the pool stays, explicitly zeroed once into every consumer that
    // survives. `begin()` sets the count to zero and the arrays are already
    // zero; ShaderMaterial retains uniform values, so one call is enough for
    // every subsequent frame and it costs nothing per frame.
    const spellLights = new SpellLights();
    spellLights.begin();
    spellLights.apply(terrain.material);
    spellLights.apply(spray.material);

    const post = new PostChain(scene, rig.camera, depthPass, sky);
    // A pose snap reprojects last frame's frustum through this one; without
    // this the whole image smears for a few frames after a cut.
    rig.onCut = () => post.resetHistory();

    // The only thing that turns weather data into pixels. Everything the storm
    // does to the picture is decided here; nothing else reads a risk value.
    const weather = new WeatherDirector({ road });
    weather.setTarget(weatherFromRisk(0.12));
    weather.snap();

    // ------------------------------------------------------------- interface
    // Plain DOM over the canvas. It is created here but stays invisible until
    // `reveal()` at the end of boot.
    const shell = new Shell();
    // Prefer the live catalog when the ML API is configured; keep the baked
    // seven segments otherwise so Analyse never depends on a network round-trip
    // just to populate the dropdown.
    loadSegments().then((segments) => {
        if (segments?.length) shell.setSegments(segments);
    });
    // Choreographs the camera, the storm and the interface together. It is the
    // only place the timing of the analyse sequence is written down.
    const flow = new RouteFlow({ shell, weather, camera: rig });
    // Plays an illustrative recorded closure through the same weather director
    // the live prediction drives — not a LightGBM score for Astana–Karaganda.
    const replay = new Replay({ shell, weather, camera: rig });

    // No character to report on; the overlay already renders a dash for it.
    const overlay = new Overlay({ rig });
    // Only in development: the tuning panel is not part of the product.
    initInput(canvas, DEV ? { onToggleOverlay: () => overlay.toggle() } : undefined);

    // ------------------------------------------------------------- warm-up
    // Everything that can compile, compiles here — behind the loading screen.
    await loading.phase("compiling pipelines", 0.78);
    rig.update(0);
    shadows.update(rig.camera, sky.sunDir);
    sky.render(rig, 0);
    await terrain.warmUp();
    terrain.update(rig.camera.position, subject.position, 0);
    road.update(rig.camera.position);
    await road.warmUp();
    spray.update(0, rig.camera.position);
    await spray.warmUp();
    blizzard.update(0, rig.camera);
    await blizzard.warmUp();
    await whenReady(sky.material, "sky material", [sky.mesh, false]);
    await depthPass.warmUp();
    post.update(0, 0, rig.distance);
    const passes = post.passes;
    for (let i = 0; i < passes.length; i++) {
        await whenReady(passes[i], "post:" + passes[i].name);
    }

    await loading.phase("warming render targets", 0.92);
    // A few real frames so every render target is allocated and every pipeline
    // has actually been bound at least once.
    for (let i = 0; i < 3; i++) {
        scene.render();
        await loading.nextFrame();
    }

    // ------------------------------------------------------------- run loop
    let prev = performance.now();
    let time = 0;

    engine.runRenderLoop(() => {
        const now = performance.now();
        let dtMs = now - prev;
        prev = now;
        if (dtMs > 100) dtMs = 100;
        const dt = S.freezeTime ? 0 : dtMs / 1000;
        time += dt;

        pollInput();

        // Per-system CPU timing. Babylon's WebGPU timestamp queries are
        // whole-frame, so the GPU row is a total and these are not subdivisions
        // of it — the overlay labels them `cpu` for that reason.
        const tFrame = performance.now();

        subject.update(dt);
        // Advances on the render loop's clock rather than a timer, so it cannot
        // drift from what is on screen. A no-op unless a replay is running.
        replay.update(dt);
        // Before the camera and before anything reads a render parameter: this
        // is the frame's weather, and every system below samples what it writes.
        weather.update(dt);
        rig.update(dt);

        // Jitters the projection and republishes everything the screen-space
        // passes derive from the camera. Must be after the camera has moved and
        // before anything reads `scene.getTransformMatrix()` — which the depth
        // prepass and the beauty pass both do.
        post.update(dt, subject.streak01, rig.focusDistance);
        sky.update();
        sky.render(rig, time);
        shadows.update(rig.camera, sky.sunDir);
        // The deformation window and the clipmap LOD rings both centre on the
        // subject rather than on the camera — see the note in `Terrain.update`.
        terrain.update(rig.camera.position, subject.position, dt);
        const tTerrain = performance.now();
        road.update(rig.camera.position);
        spray.update(dt, rig.camera.position);
        blizzard.update(time, rig.camera);
        const tVfx = performance.now();

        scene.render();
        post.endFrame();
        const tRender = performance.now();

        mark("cpu terrain", tTerrain - tFrame);
        mark("cpu vfx", tVfx - tTerrain);
        mark("cpu submit", tRender - tVfx);
        mark("cpu total", tRender - tFrame);
        stats.gpuMs = engine.getGPUFrameTimeCounter().lastSecAverage / 1e6;

        endFrameDraws();
        stats.triangles =
            (terrain.mesh.metadata ? terrain.mesh.metadata.triangles : 0) +
            road.triangles +
            spray.liveCount * 2 +
            blizzard.triangleCount;

        sample(dtMs);
        checkSpike(dtMs);
        overlay.update(dtMs, engine);

        endFrame();
    });

    // The interface goes up only once real frames are on screen, so it never
    // appears over a half-built scene.
    shell.reveal();

    await loading.done();
    setTimeout(() => overlay.resetSpikes(), 800);

    globalThis.BORAN = {
        engine, scene, rig, subject, road, weather, shell, flow, replay,
        spray, blizzard, spellLights,
        overlay, terrain, sky, shadows, post, depthPass,
        S, input, perfStats: stats,
        /** The rendering-facing entry point. Product data in, pixels out. */
        setWeather: (ws) => weather.setTarget(ws),
        /** Convenience for the demo and the console: drive everything off risk. */
        setRisk: (r) => weather.setTarget(weatherFromRisk(r)),
    };
    // The smoke harness and the overlay's pose dump both reach for this name.
    // Renamed properly when the product shell lands.
    globalThis.SNOWFLOW = globalThis.BORAN;
}

boot().catch((err) => {
    console.error(err);
    loading.fail("Startup failed — see console.");
});
