/**
 * The product interface's stylesheet.
 *
 * Kept as a module rather than a `.css` file to match `ui/overlay.js`, which
 * already injects its own styles this way — one convention for "UI that owns
 * its own appearance" rather than two.
 *
 * ## Direction
 *
 * The 3D is the product. Everything here is a caption on it, so the interface
 * gets type, spacing and one hairline, and almost nothing else: no cards, no
 * panels, no fills, no shadows behind boxes. What separates the text from the
 * snow is a very slight scrim and the type's own weight, because an opaque panel
 * over this environment would be the moment it stopped looking expensive.
 *
 * The palette is the boot screen's, extended. Cold, desaturated, and only one
 * accent — which is spent on risk and nothing else, so that when it appears it
 * means something.
 */

export const CSS = `
:root {
    --b-ink:      #070b12;
    --b-frost:    #e8f0f8;
    --b-dim:      #8fa1b5;
    --b-faint:    rgba(232, 240, 248, 0.42);
    --b-line:     rgba(232, 240, 248, 0.20);
    --b-accent:   #8fc4e8;
    --b-warn:     #e8b04f;
    --b-danger:   #e8734f;
    --b-ease:     cubic-bezier(0.16, 1, 0.3, 1);
}

#boran {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding:
        max(clamp(16px, 3.4vw, 54px), env(safe-area-inset-top, 0px))
        max(clamp(16px, 3.4vw, 54px), env(safe-area-inset-right, 0px))
        max(clamp(16px, 3.4vw, 54px), env(safe-area-inset-bottom, 0px))
        max(clamp(16px, 3.4vw, 54px), env(safe-area-inset-left, 0px));
    pointer-events: none;
    color: var(--b-frost);
    font-family: ui-sans-serif, "Inter", "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
    /* A scrim weighted to the lower left, where the type sits. Radial rather
       than linear so it never draws an edge across the sky.
       Sunlit snow exposes near white, and the type sits directly on it — at a
       weaker scrim the muted second line of the headline fell below readable
       contrast. Two stacked gradients: a broad one that lifts the whole left
       third, and a tighter one under the form itself. */
    background:
        radial-gradient(85% 70% at 2% 78%, rgba(5, 9, 15, 0.90) 0%,
                        rgba(5, 9, 15, 0.55) 42%, rgba(5, 9, 15, 0) 76%),
        linear-gradient(105deg, rgba(5, 9, 15, 0.60) 0%,
                        rgba(5, 9, 15, 0.22) 34%, rgba(5, 9, 15, 0) 62%);
    opacity: 0;
    transition: opacity 1200ms var(--b-ease);
}
#boran.ready { opacity: 1; }

#boran a, #boran button, #boran input, #boran select { pointer-events: auto; }

/* ------------------------------------------------------------------ header */

.b-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 2rem;
}

.b-mark {
    font-size: 13px;
    font-weight: 500;
    letter-spacing: 0.52em;
    text-indent: 0.52em;
    color: var(--b-frost);
}

.b-loc {
    font-size: 10px;
    font-weight: 400;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: var(--b-faint);
    font-variant-numeric: tabular-nums;
    min-width: 0;
    text-align: right;
}

/* ------------------------------------------------------------------- panel */

.b-panel {
    max-width: min(680px, 92vw);
    /* The form and the result share one cell, so the panel is always as tall as
       whichever is showing and the flex column can still lay the page out
       around it. Absolutely positioning the result instead took it out of flow,
       and it ran off the bottom of the viewport the moment it was taller than
       the form it replaced. */
    display: grid;
    align-items: start;
}
#b-form, .b-result, #b-copilot, #b-replay { grid-area: 1 / 1; }

/* Only the active panel paints. Opacity alone still left form/result
   stacked under Copilot in WebKit when native <select> opened. */
.b-panel > #b-form,
.b-panel > .b-result,
.b-panel > #b-copilot,
.b-panel > #b-replay {
    visibility: hidden;
    pointer-events: none;
}
.b-panel[data-view="form"] > #b-form,
.b-panel[data-view="result"] > .b-result,
.b-panel[data-view="copilot"] > #b-copilot,
.b-panel[data-view="replay"] > #b-replay {
    visibility: visible;
    pointer-events: auto;
}

.b-lede {
    font-size: clamp(30px, 4.6vw, 62px);
    font-weight: 200;
    line-height: 1.02;
    letter-spacing: -0.022em;
    margin-bottom: clamp(24px, 3vw, 44px);
    text-wrap: balance;
}
.b-lede em {
    font-style: normal;
    /* Lighter than --b-dim. The hierarchy still reads, and this line has to
       hold against sunlit snow, which --b-dim does not. */
    color: #b6c6d8;
    display: block;
}

/* --------------------------------------------------------------- the form */

.b-fields {
    display: flex;
    flex-wrap: wrap;
    gap: clamp(20px, 3vw, 44px);
    margin-bottom: clamp(26px, 3vw, 40px);
}

.b-field { min-width: 0; }
.b-field-wide { flex: 1 1 280px; min-width: min(100%, 280px); }

.b-field label {
    display: block;
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--b-faint);
    margin-bottom: 9px;
}

.b-field select,
.b-field input {
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--b-line);
    border-radius: 0;
    padding: 0 0 8px;
    width: 100%;
    min-width: 148px;
    color: var(--b-frost);
    font: inherit;
    font-size: clamp(17px, 1.6vw, 22px);
    font-weight: 300;
    letter-spacing: 0.01em;
    outline: none;
    cursor: pointer;
    transition: border-color 260ms var(--b-ease), color 260ms var(--b-ease);
}
.b-field input { cursor: text; font-variant-numeric: tabular-nums; }
/* Chrome draws a clock glyph inside time inputs. It is the one piece of
   browser chrome in the interface and it is the wrong century. */
.b-field input[type="time"]::-webkit-calendar-picker-indicator { display: none; }
.b-field input[type="time"] { min-width: 108px; }

.b-field select:hover,
.b-field input:hover { border-bottom-color: rgba(232, 240, 248, 0.42); }
.b-field select:focus-visible,
.b-field input:focus-visible { border-bottom-color: var(--b-accent); }

/* The native dropdown list is the one thing here that cannot be styled to
   match, so it is at least made legible against a dark chrome. */
.b-field select option { background: #0d141f; color: var(--b-frost); }

/* -------------------------------------------------------------- the button */

.b-go {
    position: relative;
    background: transparent;
    color: var(--b-frost);
    border: 1px solid var(--b-line);
    border-radius: 0;
    padding: 17px 34px;
    font: inherit;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.30em;
    text-indent: 0.30em;
    text-transform: uppercase;
    cursor: pointer;
    overflow: hidden;
    transition: border-color 400ms var(--b-ease), color 400ms var(--b-ease);
}
/* A wipe rather than a fill-on-hover: it reads as deliberate at this scale,
   where an instant background change reads as a default. */
.b-go::after {
    content: "";
    position: absolute;
    inset: 0;
    background: var(--b-frost);
    transform: scaleX(0);
    transform-origin: left;
    transition: transform 520ms var(--b-ease);
    z-index: -1;
}
.b-go:hover { border-color: var(--b-frost); }
.b-go:hover::after { transform: scaleX(1); }
.b-go:hover { color: var(--b-ink); }
.b-go:focus-visible { border-color: var(--b-accent); outline: none; }
.b-go[disabled] { opacity: 0.4; cursor: default; }
.b-go[disabled]:hover::after { transform: scaleX(0); }
.b-go[disabled]:hover { color: var(--b-frost); border-color: var(--b-line); }

.b-text-link {
    background: none;
    border: 0;
    padding: 0;
    margin: 18px 0 0;
    color: var(--b-faint);
    font: inherit;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    cursor: pointer;
    transition: color 280ms var(--b-ease);
}
.b-text-link:hover { color: var(--b-frost); }

.b-live-fields {
    margin-top: clamp(22px, 2.8vw, 36px);
    padding-top: clamp(18px, 2vw, 28px);
    border-top: 1px solid rgba(232, 240, 248, 0.1);
}
.b-live-fields[hidden] { display: none !important; }
.b-live-fields .b-go { margin-top: 4px; }

/* ------------------------------------------------------------------ result */

/* The form and the result occupy the same corner. Neither is ever laid out
   beside the other, so they cross-fade in place — which is what makes the
   analyse sequence read as one view changing rather than two screens. */
#b-form {
    opacity: 1;
    transform: none;
    transition: opacity 620ms var(--b-ease), transform 620ms var(--b-ease);
}
.b-panel:not([data-view="form"]) > #b-form {
    opacity: 0;
    transform: translate3d(0, -14px, 0);
}

.b-result {
    opacity: 0;
    transform: translate3d(0, 18px, 0);
    transition: opacity 900ms var(--b-ease), transform 900ms var(--b-ease);
}
.b-panel[data-view="result"] > .b-result {
    opacity: 1;
    transform: none;
}

.b-route {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: var(--b-faint);
    margin-bottom: clamp(10px, 1.4vw, 20px);
}

/* The number is the product. Everything else on screen is subordinate to it,
   and at this size it carries from across a room — which is the actual test. */
.b-pct {
    /* Bounded by viewport *height* as well as width. The figure is the largest
       thing on screen and on a short window it is what pushes the advisory off
       the bottom — which is the one line that must never be lost. */
    font-size: clamp(64px, min(11vw, 17vh), 152px);
    font-weight: 200;
    line-height: 0.86;
    letter-spacing: -0.045em;
    font-variant-numeric: tabular-nums;
    color: var(--b-frost);
    transition: color 700ms var(--b-ease);
}

.b-band {
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.30em;
    text-indent: 0.30em;
    text-transform: uppercase;
    margin-top: clamp(12px, 1.6vw, 22px);
    color: var(--b-accent);
    transition: color 700ms var(--b-ease);
}

/* The single accent in the interface, and it only ever means risk. */
.b-result[data-band="moderate"] .b-band { color: #c9b07a; }
.b-result[data-band="high"]    .b-band { color: var(--b-warn); }
.b-result[data-band="severe"]  .b-band,
.b-result[data-band="extreme"] .b-band { color: var(--b-danger); }
.b-result[data-band="high"]    .b-pct { color: #f0e2c4; }
.b-result[data-band="severe"]  .b-pct,
.b-result[data-band="extreme"] .b-pct { color: #f6dcd2; }

.b-mode {
    margin-top: 14px;
    font-size: 12px;
    font-weight: 300;
    letter-spacing: 0.02em;
    color: var(--b-dim);
    max-width: 36em;
}
.b-mode[data-mode="fallback"] { color: var(--b-warn); }
.b-mode[data-mode="live"] { color: var(--b-accent); }

.b-headline {
    font-size: clamp(19px, 2.1vw, 27px);
    font-weight: 300;
    line-height: 1.24;
    letter-spacing: -0.012em;
    margin-top: clamp(20px, 2.4vw, 34px);
    max-width: 22em;
    text-wrap: balance;
}

.b-detail {
    font-size: 13px;
    font-weight: 300;
    line-height: 1.62;
    color: var(--b-dim);
    margin-top: 12px;
    max-width: 34em;
}

.b-advice {
    margin-top: clamp(18px, 2vw, 28px);
    padding-top: 16px;
    border-top: 1px solid var(--b-line);
    font-size: 12px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--b-dim);
    max-width: 34em;
}
.b-advice b {
    color: var(--b-frost);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
}

/* ------------------------------------------------------- departure scrubber */

.b-scrub {
    margin-top: clamp(20px, 2.4vw, 32px);
    max-width: 34em;
}

.b-scrub-label {
    display: block;
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--b-faint);
    margin-bottom: 12px;
}
.b-scrub-label b {
    color: var(--b-frost);
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.12em;
}

.b-slider {
    -webkit-appearance: none;
    appearance: none;
    display: block;
    width: 100%;
    height: 22px;
    background: transparent;
    cursor: grab;
    outline: none;
}
.b-slider:active { cursor: grabbing; }

/* A hairline, not a groove. The track is a ruler the handle travels along, and
   any fill or bevel on it competes with the figure above. */
.b-slider::-webkit-slider-runnable-track {
    height: 1px;
    background: var(--b-line);
}
.b-slider::-moz-range-track {
    height: 1px;
    background: var(--b-line);
}

.b-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 13px;
    height: 13px;
    margin-top: -6px;
    border-radius: 50%;
    background: var(--b-frost);
    box-shadow: 0 0 0 6px rgba(232, 240, 248, 0.10);
    transition: box-shadow 260ms var(--b-ease), background 400ms var(--b-ease);
}
.b-slider::-moz-range-thumb {
    width: 13px;
    height: 13px;
    border: 0;
    border-radius: 50%;
    background: var(--b-frost);
    box-shadow: 0 0 0 6px rgba(232, 240, 248, 0.10);
}
.b-slider:hover::-webkit-slider-thumb,
.b-slider:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 9px rgba(232, 240, 248, 0.16);
}

/* The handle takes the risk colour, so the control itself carries the reading
   even when the eye is on the road rather than on the number. */
.b-result[data-band="moderate"] .b-slider::-webkit-slider-thumb { background: #c9b07a; }
.b-result[data-band="high"]    .b-slider::-webkit-slider-thumb { background: var(--b-warn); }
.b-result[data-band="severe"]  .b-slider::-webkit-slider-thumb,
.b-result[data-band="extreme"] .b-slider::-webkit-slider-thumb { background: var(--b-danger); }
.b-result[data-band="moderate"] .b-slider::-moz-range-thumb { background: #c9b07a; }
.b-result[data-band="high"]    .b-slider::-moz-range-thumb { background: var(--b-warn); }
.b-result[data-band="severe"]  .b-slider::-moz-range-thumb,
.b-result[data-band="extreme"] .b-slider::-moz-range-thumb { background: var(--b-danger); }

.b-scrub-ends {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    font-size: 9px;
    letter-spacing: 0.20em;
    color: var(--b-faint);
    font-variant-numeric: tabular-nums;
}

.b-back {
    margin-top: clamp(20px, 2.4vw, 32px);
    background: none;
    border: 0;
    border-bottom: 1px solid var(--b-line);
    border-radius: 0;
    padding: 0 0 6px;
    color: var(--b-faint);
    font: inherit;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    cursor: pointer;
    transition: color 300ms var(--b-ease), border-color 300ms var(--b-ease);
}
.b-back:hover { color: var(--b-frost); border-bottom-color: var(--b-frost); }

.b-actions { display: flex; gap: clamp(18px, 2.4vw, 34px); flex-wrap: wrap; }

/* ------------------------------------------------------------------ replay */

.b-replay {
    opacity: 0;
    transform: translate3d(0, 18px, 0);
    transition: opacity 800ms var(--b-ease), transform 800ms var(--b-ease);
}
.b-panel[data-view="replay"] > #b-replay {
    opacity: 1;
    transform: none;
}

.b-rp-controls {
    display: grid;
    gap: clamp(14px, 1.8vw, 20px);
    max-width: 34em;
    margin: 0 0 clamp(18px, 2.2vw, 28px);
}
.b-rp-field {
    display: grid;
    gap: 8px;
    font-size: 10px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--b-faint);
}
.b-rp-field b {
    font-weight: 400;
    letter-spacing: 0.04em;
    text-transform: none;
    color: var(--b-accent);
    font-variant-numeric: tabular-nums;
}
.b-rp-datetime {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: clamp(12px, 2vw, 20px);
    max-width: 34em;
}
.b-rp-field select,
.b-rp-field input[type="date"],
.b-rp-field input[type="time"] {
    appearance: none;
    -webkit-appearance: none;
    width: 100%;
    max-width: 34em;
    padding: 10px 12px;
    border: 0;
    border-bottom: 1px solid var(--b-line);
    border-radius: 0;
    background: transparent;
    color: var(--b-text);
    font: inherit;
    font-size: 14px;
    font-weight: 300;
    letter-spacing: 0.01em;
    text-transform: none;
    cursor: pointer;
    color-scheme: dark;
}
.b-rp-field select:focus,
.b-rp-field input[type="date"]:focus,
.b-rp-field input[type="time"]:focus {
    outline: none;
    border-bottom-color: var(--b-frost);
}
.b-rp-time-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
}
.b-rp-play {
    border: 0;
    background: none;
    padding: 0;
    color: var(--b-dim);
    font: inherit;
    font-size: 11px;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    cursor: pointer;
}
.b-rp-play:hover { color: var(--b-accent); }
#b-rp-scrub {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 18px;
    margin: 4px 0 0;
    background: transparent;
    cursor: pointer;
}
#b-rp-scrub::-webkit-slider-runnable-track {
    height: 1px;
    background: var(--b-line);
}
#b-rp-scrub::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 11px;
    height: 11px;
    margin-top: -5px;
    border-radius: 50%;
    border: 1px solid var(--b-frost);
    background: var(--b-ink);
}
#b-rp-scrub::-moz-range-track {
    height: 1px;
    background: var(--b-line);
    border: 0;
}
#b-rp-scrub::-moz-range-thumb {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 1px solid var(--b-frost);
    background: var(--b-ink);
}
.b-rp-scrub-ends {
    display: flex;
    justify-content: space-between;
    margin-top: 4px;
    font-size: 10px;
    letter-spacing: 0.12em;
    color: var(--b-faint);
    font-variant-numeric: tabular-nums;
}

.b-rp-head {
    display: flex;
    align-items: baseline;
    gap: clamp(18px, 2.4vw, 34px);
    margin-bottom: clamp(16px, 2vw, 26px);
}

.b-rp-clock {
    font-size: clamp(46px, min(7vw, 11vh), 92px);
    font-weight: 200;
    line-height: 0.9;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
}

.b-rp-risk {
    font-size: clamp(20px, 2.4vw, 32px);
    font-weight: 300;
    font-variant-numeric: tabular-nums;
    color: var(--b-accent);
    transition: color 600ms var(--b-ease);
}
.b-replay[data-band="moderate"] .b-rp-risk { color: #c9b07a; }
.b-replay[data-band="high"]    .b-rp-risk { color: var(--b-warn); }
.b-replay[data-band="severe"]  .b-rp-risk,
.b-replay[data-band="extreme"] .b-rp-risk { color: var(--b-danger); }

/* The timeline. A hairline that fills, with one tick on it — the moment BORAN
   would have said stop. That single mark is the entire argument of the replay,
   so nothing else on the track competes with it. */
.b-rp-track {
    position: relative;
    height: 1px;
    background: var(--b-line);
    max-width: 34em;
}
.b-rp-fill {
    position: absolute;
    inset: 0;
    background: var(--b-frost);
    transform-origin: left;
    transform: scaleX(0);
}
.b-rp-mark {
    position: absolute;
    /* The left offset is set from the data by Shell.enterReplay: it is the
       advisory crossing's position within the recorded window, so it moves
       whenever the dataset or the threshold does. Hardcoding it here was
       already wrong by a percent within minutes of the dataset being written.
       (No backticks in this file -- the whole stylesheet is one template
       literal, and a stray one silently truncates it.) */
    left: 0;
    top: -5px;
    width: 1px;
    height: 11px;
    background: var(--b-faint);
    transition: background 500ms var(--b-ease);
}
.b-rp-mark span {
    position: absolute;
    left: 0;
    top: 15px;
    white-space: nowrap;
    font-size: 8px;
    letter-spacing: 0.20em;
    text-transform: uppercase;
    color: var(--b-faint);
    transition: color 500ms var(--b-ease);
}
.b-rp-mark span::after { content: "advisory"; }
.b-rp-mark[data-on="1"] { background: var(--b-warn); }
.b-rp-mark[data-on="1"] span { color: var(--b-warn); }

.b-rp-note {
    margin-top: 30px;
    min-height: 1.6em;
    font-size: 13px;
    font-weight: 300;
    color: var(--b-dim);
    max-width: 34em;
}

.b-rp-verdict {
    margin-top: clamp(16px, 2vw, 24px);
    padding-top: 16px;
    border-top: 1px solid var(--b-line);
    max-width: 34em;
    opacity: 0;
    transform: translate3d(0, 10px, 0);
    transition: opacity 900ms var(--b-ease), transform 900ms var(--b-ease);
}
.b-rp-verdict.b-shown { opacity: 1; transform: none; }
.b-rp-verdict strong {
    display: block;
    font-size: clamp(19px, 2.1vw, 26px);
    font-weight: 300;
    letter-spacing: -0.01em;
    color: var(--b-danger);
    margin-bottom: 10px;
}
.b-rp-verdict span {
    display: block;
    font-size: 13px;
    font-weight: 300;
    line-height: 1.6;
    color: var(--b-dim);
}
.b-rp-verdict b { color: var(--b-frost); font-weight: 500; }

#b-replay .b-back { margin-top: clamp(20px, 2.4vw, 30px); }

/* ------------------------------------------------------------------ footer */

.b-foot {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 2rem;
    font-size: 9px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--b-faint);
}

/* -------------------------------------------------- entrance choreography */

.b-rise { opacity: 0; transform: translate3d(0, 16px, 0); }
#boran.ready .b-rise {
    opacity: 1;
    transform: none;
    transition: opacity 1000ms var(--b-ease), transform 1000ms var(--b-ease);
}
#boran.ready .b-d1 { transition-delay: 120ms; }
#boran.ready .b-d2 { transition-delay: 260ms; }
#boran.ready .b-d3 { transition-delay: 400ms; }
#boran.ready .b-d4 { transition-delay: 520ms; }
#boran.ready .b-d5 { transition-delay: 640ms; }

/* Anything that moves here is decoration on a decision. */
@media (prefers-reduced-motion: reduce) {
    #boran, #boran * {
        transition-duration: 1ms !important;
        transition-delay: 0ms !important;
    }
    .b-rise { opacity: 1; transform: none; }
}

/* ---------------------------------------------------------- live / seasonal */

.b-live {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--b-accent);
    margin-bottom: 10px;
}

.b-pct-soft {
    font-size: clamp(40px, min(7vw, 11vh), 88px);
    opacity: 0.78;
}

.b-result[data-band="calm"] .b-band { color: var(--b-accent); }
.b-result[data-band="calm"] .b-pct { color: var(--b-frost); }

.b-score-note {
    margin-top: 10px;
    font-size: 12px;
    font-weight: 300;
    line-height: 1.5;
    color: var(--b-dim);
    max-width: 36em;
}

.b-mets {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px 18px;
    margin-top: clamp(18px, 2.2vw, 28px);
    max-width: 28em;
}
.b-mets span {
    display: block;
    font-size: 9px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--b-faint);
    margin-bottom: 4px;
}
.b-mets b {
    font-size: 14px;
    font-weight: 300;
    font-variant-numeric: tabular-nums;
    color: var(--b-frost);
}

.b-winter-cta {
    display: block;
    margin-top: 18px;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--b-line);
    border-radius: 0;
    padding: 0 0 8px;
    color: var(--b-frost);
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    cursor: pointer;
    pointer-events: auto;
    transition: border-color 260ms var(--b-ease), color 260ms var(--b-ease);
}
.b-winter-cta:hover { border-bottom-color: var(--b-frost); color: var(--b-accent); }

.b-actions { display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: center; }

/* ----------------------------------------------------------------- copilot */
/* Shares the panel cell with form/result/replay — never overlays them. */

.b-copilot {
    opacity: 0;
    transform: translate3d(0, 18px, 0);
    transition: opacity 700ms var(--b-ease), transform 700ms var(--b-ease);
    max-width: min(560px, 92vw);
    max-height: min(78vh, 720px);
    overflow-y: auto;
    padding-right: 4px;
}
.b-panel[data-view="copilot"] > #b-copilot {
    opacity: 1;
    transform: none;
}

.b-cp-head {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    align-items: flex-start;
    margin-bottom: 12px;
}
.b-cp-kicker {
    font-size: 9px;
    letter-spacing: 0.28em;
    text-transform: uppercase;
    color: var(--b-faint);
    margin-bottom: 6px;
}
.b-cp-title {
    font-size: clamp(18px, 2vw, 24px);
    font-weight: 300;
    letter-spacing: -0.015em;
    max-width: 16em;
}
.b-cp-x {
    flex-shrink: 0;
    background: transparent;
    border: 1px solid var(--b-line);
    border-radius: 0;
    color: var(--b-frost);
    font: inherit;
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    cursor: pointer;
    padding: 10px 12px;
    transition: border-color 240ms var(--b-ease), color 240ms var(--b-ease);
}
.b-cp-x:hover { border-color: var(--b-frost); color: var(--b-accent); }

.b-cp-back {
    margin-top: 18px;
    display: inline-block;
}

.b-cp-summary,
.b-cp-best,
.b-cp-concerns {
    font-size: 13px;
    font-weight: 300;
    line-height: 1.55;
    color: var(--b-dim);
    margin: 0 0 8px;
    max-width: 34em;
}
.b-cp-best { color: var(--b-frost); }
.b-cp-concerns {
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--b-faint);
}

.b-cp-prompts {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 14px 0 16px;
}
.b-cp-chip {
    background: transparent;
    border: 1px solid var(--b-line);
    border-radius: 0;
    color: var(--b-frost);
    font: inherit;
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    padding: 8px 10px;
    cursor: pointer;
    transition: border-color 240ms var(--b-ease), color 240ms var(--b-ease);
}
.b-cp-chip:hover { border-color: var(--b-frost); color: var(--b-accent); }

.b-cp-tools {
    display: flex;
    gap: 18px;
    margin-bottom: 12px;
}
.b-cp-tools label span {
    display: block;
    font-size: 9px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--b-faint);
    margin-bottom: 4px;
}
.b-cp-tools select {
    appearance: none;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--b-line);
    border-radius: 0;
    color: var(--b-frost);
    font: inherit;
    font-size: 13px;
    font-weight: 300;
    padding: 0 0 4px;
    min-width: 110px;
    cursor: pointer;
}
.b-cp-tools select option { background: #0d141f; color: var(--b-frost); }

.b-cp-status {
    min-height: 1.2em;
    font-size: 11px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--b-accent);
    margin: 0 0 8px;
}
.b-cp-status[data-busy="1"] {
    animation: b-cp-pulse 1.4s var(--b-ease) infinite;
}
@keyframes b-cp-pulse {
    0%, 100% { opacity: 0.45; }
    50% { opacity: 1; }
}

.b-cp-thread {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-height: min(38vh, 320px);
    overflow-y: auto;
    margin: 4px 0 12px;
    padding-right: 6px;
    max-width: 36em;
    scrollbar-width: thin;
    scrollbar-color: var(--b-line) transparent;
}

.b-cp-msg-who {
    font-size: 9px;
    font-weight: 500;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--b-faint);
    margin-bottom: 6px;
}

.b-cp-msg-body {
    font-size: 14px;
    font-weight: 300;
    line-height: 1.6;
    color: var(--b-frost);
    white-space: pre-wrap;
}

.b-cp-msg-user .b-cp-msg-body {
    color: var(--b-dim);
    border-left: 1px solid var(--b-line);
    padding-left: 12px;
}

.b-cp-msg-assistant .b-cp-msg-body {
    color: var(--b-frost);
}

.b-cp-msg-assistant[data-available="0"] .b-cp-msg-body {
    color: var(--b-warn);
}

.b-cp-msg-body strong {
    font-weight: 500;
    color: var(--b-frost);
}

.b-cp-input-row {
    display: flex;
    gap: 12px;
    align-items: center;
}
.b-cp-input-row input {
    flex: 1;
    background: transparent;
    border: 0;
    border-bottom: 1px solid var(--b-line);
    border-radius: 0;
    color: var(--b-frost);
    font: inherit;
    font-size: 14px;
    font-weight: 300;
    padding: 8px 0;
    outline: none;
}
.b-cp-input-row input:focus-visible { border-bottom-color: var(--b-accent); }
.b-cp-send { padding: 12px 18px; }

/* Mobile last — overrides desktop rules above. */
@media (max-width: 620px) {
    .b-rp-datetime { grid-template-columns: 1fr; }

    #boran {
        justify-content: flex-start;
        gap: 18px;
        overflow: hidden;
        background:
            radial-gradient(120% 80% at 0% 100%, rgba(5, 9, 15, 0.94) 0%,
                            rgba(5, 9, 15, 0.72) 38%, rgba(5, 9, 15, 0.18) 72%,
                            rgba(5, 9, 15, 0) 100%),
            linear-gradient(180deg, rgba(5, 9, 15, 0.55) 0%,
                            rgba(5, 9, 15, 0.18) 28%, rgba(5, 9, 15, 0) 48%);
    }

    .b-top, .b-panel, .b-foot { pointer-events: auto; }

    .b-top {
        flex-wrap: wrap;
        align-items: flex-start;
        gap: 8px 12px;
        flex: 0 0 auto;
    }
    .b-mark {
        letter-spacing: 0.36em;
        text-indent: 0.36em;
    }
    .b-loc {
        flex: 1 1 100%;
        text-align: left;
        font-size: 9px;
        letter-spacing: 0.12em;
        line-height: 1.45;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .b-panel {
        max-width: 100%;
        width: 100%;
        flex: 1 1 auto;
        min-height: 0;
        overflow-x: hidden;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior: contain;
        padding-bottom: 8px;
    }

    .b-lede {
        font-size: clamp(26px, 7.2vw, 34px);
        margin-bottom: 22px;
    }
    .b-go {
        width: 100%;
        text-align: center;
        padding: 16px 18px;
    }
    .b-text-link { margin-top: 14px; }
    .b-fields { gap: 16px; margin-bottom: 22px; }
    .b-field select, .b-field input { min-width: 0; width: 100%; font-size: 17px; }
    .b-field-wide { flex: 1 1 100%; min-width: 0; }

    .b-route {
        letter-spacing: 0.14em;
        line-height: 1.4;
        margin-bottom: 12px;
    }
    .b-live {
        letter-spacing: 0.14em;
        line-height: 1.4;
    }
    .b-pct, .b-pct-soft {
        font-size: clamp(52px, 15vw, 72px);
        line-height: 0.9;
    }
    .b-band {
        letter-spacing: 0.14em;
        text-indent: 0;
        line-height: 1.45;
        margin-top: 10px;
    }
    .b-headline { font-size: 18px; margin-top: 16px; color: var(--b-frost); }
    .b-detail { font-size: 13px; line-height: 1.5; margin-top: 10px; color: #c5d4e4; }
    .b-score-note { font-size: 12px; line-height: 1.45; color: #c5d4e4; }
    .b-mets {
        grid-template-columns: 1fr 1fr !important;
        gap: 14px 16px;
        max-width: none;
    }
    .b-scrub { margin-top: 18px; max-width: none; }
    .b-actions {
        flex-direction: column;
        align-items: stretch;
        gap: 4px;
        margin-top: 8px;
    }
    .b-back, .b-winter-cta {
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        letter-spacing: 0.16em;
    }

    .b-copilot {
        max-width: 100%;
        max-height: none;
        padding-right: 0;
    }
    .b-cp-head {
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
    }
    .b-cp-x { display: none; }
    .b-cp-title {
        font-size: 22px;
        max-width: none;
    }
    .b-cp-summary, .b-cp-concerns, .b-cp-best {
        color: #c5d4e4;
        max-width: none;
    }
    .b-cp-best { color: var(--b-frost); }
    .b-cp-tools { flex-direction: column; }
    .b-cp-input-row { flex-direction: column; align-items: stretch; }
    .b-cp-prompts { gap: 8px; }
    .b-cp-prompts .b-cp-chip,
    .b-cp-prompts button {
        width: 100%;
        text-align: left;
        min-height: 44px;
    }

    .b-foot {
        flex-direction: column;
        align-items: flex-start;
        gap: 6px;
        letter-spacing: 0.12em;
        line-height: 1.5;
        margin-top: auto;
        padding-top: 8px;
        flex: 0 0 auto;
    }
    .b-panel:not([data-view="form"]) ~ .b-foot { display: none; }
}
`;
