/**
 * Boot smoke test and visual-regression capture.
 *
 * Drives the dev server in a real Chrome with WebGPU, waits for the app to
 * publish its global, samples the app's own perf counters, records every
 * console message, and writes a screenshot. Every migration stage is verified
 * with this so the numbers and the frames are comparable across stages rather
 * than being re-eyeballed each time.
 *
 * Headed, not headless: WebGPU on macOS/Metal needs a real surface, and a
 * headless run silently falls back to no adapter — which would make this
 * report "no WebGPU" for every stage regardless of the code.
 *
 *   npm run dev                       # in another shell
 *   npm run smoke -- <label> [url]
 *
 * Screenshots and JSON land in .snapshots/, which is git-ignored: the repo is
 * source only. Keep the stage-1 capture around locally to diff later stages
 * against.
 *
 * CHROME_PATH overrides the browser binary.
 */

import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".snapshots");

const label = process.argv[2] || "run";
const url = process.argv[3] || "http://localhost:5173/";

/** Where Chrome lives, per platform. `CHROME_PATH` wins if set. */
const CHROME = {
    darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    linux: "/usr/bin/google-chrome",
    win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
};

/** Seconds of running before the perf counters are sampled. */
const SETTLE_MS = 6000;
/** The warm-up compiles every pipeline before the global appears. */
const BOOT_TIMEOUT_MS = 120000;

const executablePath = process.env.CHROME_PATH || CHROME[process.platform];
if (!executablePath || !fs.existsSync(executablePath)) {
    console.error(
        `Chrome not found at ${executablePath || "(unknown platform)"}.\n` +
        "Set CHROME_PATH to the browser binary."
    );
    process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
    executablePath,
    headless: false,
    args: ["--enable-unsafe-webgpu", "--window-size=1600,900"],
});

const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

/** @type {string[]} */
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) =>
    logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`)
);

await page.goto(url, { waitUntil: "load", timeout: 60000 });

// Adapter presence, asked directly rather than inferred from the app — so a
// boot failure can be told apart from a machine with no WebGPU at all.
const gpu = await page.evaluate(async () => {
    if (!navigator.gpu) return { ok: false, reason: "navigator.gpu missing" };
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { ok: false, reason: "requestAdapter() returned null" };
    return { ok: true, info: adapter.info ? { ...adapter.info } : null };
});

// `boot()` publishes the global on its last line, so this is the honest
// "finished loading" signal rather than a timer.
let booted = true;
try {
    await page.waitForFunction(
        () => !!globalThis.SNOWFLOW, null, { timeout: BOOT_TIMEOUT_MS }
    );
} catch {
    booted = false;
}

let perf = null;
if (booted) {
    await page.waitForTimeout(SETTLE_MS);
    perf = await page.evaluate(() => {
        const app = globalThis.SNOWFLOW;
        const p = app.perfStats;
        return {
            fps: +p.fps.toFixed(1),
            fpsLow: +p.fpsLow.toFixed(1),
            medianMs: +p.median.toFixed(2),
            p99Ms: +p.p99.toFixed(2),
            gpuMs: +p.gpuMs.toFixed(3),
            triangles: p.triangles,
            drawCalls: p.drawCalls,
            preset: app.S.preset,
            resolutionScale: app.S.resolutionScale,
            // Framing, so "the picture changed" can be told apart from "the
            // camera moved" without anyone squinting at two screenshots.
            camPos: app.rig.camera.position.asArray().map((v) => +v.toFixed(4)),
            camYaw: +app.rig.yaw.toFixed(4),
            camPitch: +app.rig.pitch.toFixed(4),
            camDist: +app.rig.distance.toFixed(4),
            camFov: +app.rig.camera.fov.toFixed(4),
        };
    });
}

await page.screenshot({ path: path.join(OUT, `shot-${label}.png`) });

const report = { label, url, booted, gpu, perf, logs };
fs.writeFileSync(
    path.join(OUT, `smoke-${label}.json`), JSON.stringify(report, null, 2)
);
console.log(JSON.stringify(report, null, 2));

await browser.close();
process.exit(booted && gpu.ok ? 0 : 1);
