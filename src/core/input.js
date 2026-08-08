/**
 * Input state.
 *
 * BORAN is not driven by the keyboard or the mouse. There is no pointer lock, no
 * free look, no movement and no gameplay binding; the camera is choreographed by
 * the product, not steered by the viewer.
 *
 * What remains is a neutral state object and a single development keybinding.
 *
 * The object keeps the field names the camera rig reads — `lookX`, `lookY`,
 * `zoomDelta` — rather than the rig being changed to stop reading them. They are
 * now permanently zero, so the rig holds whatever framing it is given and adds
 * nothing of its own. That is the smallest possible seam: `core/camera.js` is
 * untouched, and when the cinematic camera lands it can replace the rig outright
 * instead of unpicking an input coupling first.
 *
 * The remaining fields exist because the gameplay modules that read them are
 * disabled rather than deleted, and are still importable. Held at their
 * rest values, they describe a character standing still.
 */

export const input = {
    // Movement axes. Permanently neutral — nothing writes these.
    moveX: 0,
    moveZ: 0,
    moving: false,

    // Look delta, in radians, consumed and cleared by the camera rig each frame.
    // Permanently zero: the viewer does not aim the camera.
    lookX: 0,
    lookY: 0,

    // Zoom, consumed by the camera rig. Permanently zero.
    zoomDelta: 0,

    surf: false,
    sprint: false,

    /** @type {number} 0 = none, else 1..5. Never set. */
    spellPressed: 0,
    /** @type {boolean} Never set. */
    spellHeld2: false,

    /** No pointer lock in BORAN. Kept false so readers behave as if unfocused. */
    locked: false,
};

/**
 * Install the development keybinding.
 *
 * `onToggleOverlay` is optional and is only wired by the entry point when the
 * app is started in development mode, so the tuning overlay cannot be summoned
 * in the product build. Passing no hooks installs no listeners at all.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ onToggleOverlay?: () => void }} [hooks]
 */
export function initInput(canvas, hooks) {
    const onToggleOverlay = hooks?.onToggleOverlay;
    if (!onToggleOverlay) return;

    window.addEventListener("keydown", (e) => {
        if (e.code === "F1" || e.code === "Backquote") {
            e.preventDefault();
            onToggleOverlay();
        }
    });
}

/**
 * Resolve held keys into movement axes.
 *
 * Nothing to resolve — kept so the render loop's frame structure is unchanged
 * and the call site stays where a future product input (a scrubber, a slider)
 * would be sampled.
 */
export function pollInput() {}

/** Clear per-frame accumulators. Nothing accumulates. */
export function endFrame() {}

/** No key state is tracked. */
export function isDown() {
    return false;
}
