/**
 * The product without the renderer.
 *
 * BORAN's 3D environment needs WebGPU, and on a machine that has not got it the
 * honest thing is not a dead end. A driver asking whether the road to Karaganda
 * is about to close has a real question, and the answer does not depend on
 * whether their browser can rasterise snow. So the same interface, the same
 * prediction service and the same replay data run here with the environment
 * replaced by a static gradient.
 *
 * It reuses `Shell`, `RouteFlow` and `Replay` unmodified. Those three take a
 * weather director and a camera; here they are given inert stand-ins that
 * accept every call and do nothing. That is deliberately cheaper and safer than
 * threading optional-dependency checks through code that already works — the
 * null objects are eight lines and cannot regress the WebGPU path.
 */

import { Shell } from "./shell.js";
import { RouteFlow } from "./routeFlow.js";
import { Replay } from "./replay.js";

/** Accepts everything the flow and the replay ask of a weather director. */
const NO_WEATHER = {
    current: {},
    target: {},
    setTarget() {},
    snap() {},
    update() {},
};

/** Accepts everything they ask of a camera. */
const NO_CAMERA = {
    pose: "",
    cut() {},
    update() {},
};

const CSS = `
#boran.b-flat {
    background:
        radial-gradient(120% 90% at 18% 12%, #1b2735 0%, #101823 46%, #070b12 100%);
}
#boran.b-flat::before {
    content: "";
    position: absolute;
    inset: 0;
    /* A horizon, at the same place the rendered one sits, so the layout is not
       obviously a different page. Nothing here pretends to be the 3D scene. */
    background: linear-gradient(180deg,
        rgba(143, 196, 232, 0.10) 0%,
        rgba(143, 196, 232, 0.04) 44%,
        rgba(232, 240, 248, 0.06) 52%,
        rgba(7, 11, 18, 0) 100%);
    pointer-events: none;
}
.b-nogpu {
    margin-top: 18px;
    padding: 14px 0 0;
    border-top: 1px solid var(--b-line);
    max-width: 34em;
    font-size: 12px;
    line-height: 1.7;
    color: var(--b-faint);
}
.b-nogpu b { color: var(--b-dim); font-weight: 500; }
`;

/**
 * Boot the interface with no renderer behind it.
 * @param {string} [reason] shown to the user; already user-facing wording
 */
export function startFallback(reason) {
    const style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);

    // The boot screen belongs to the WebGPU path; there is nothing to load here.
    document.getElementById("boot")?.remove();
    document.getElementById("nogpu")?.remove();

    const shell = new Shell();
    shell.root.classList.add("b-flat");

    const flow = new RouteFlow({
        shell, weather: NO_WEATHER, camera: NO_CAMERA,
    });
    const replay = new Replay({
        shell, weather: NO_WEATHER, camera: NO_CAMERA,
    });

    // The replay drives itself off the render loop, which does not exist here.
    // A plain interval is the right substitute: nothing is being synchronised
    // to a frame, so there is nothing for it to drift against.
    let timer = 0;
    const originalStart = replay.start.bind(replay);
    replay.start = () => {
        originalStart();
        clearInterval(timer);
        timer = setInterval(() => {
            replay.update(1 / 30);
            if (replay.hour >= replay.endHour) clearInterval(timer);
        }, 1000 / 30);
    };
    const originalStop = replay.stop.bind(replay);
    replay.stop = () => {
        clearInterval(timer);
        originalStop();
    };

    // Say plainly what is missing, under the form rather than instead of it.
    const note = document.createElement("p");
    note.className = "b-nogpu";
    note.innerHTML =
        `<b>Live road visualisation unavailable.</b> ` +
        (reason || "This browser does not support WebGPU.") +
        ` Forecasts, departure advice and historical replay all work below; ` +
        `open BORAN in Chrome 113+ on a desktop GPU for the 3D route view.`;
    shell.el.form.appendChild(note);

    shell.reveal();

    globalThis.BORAN = { shell, flow, replay, mode: "fallback" };
    return { shell, flow, replay };
}
