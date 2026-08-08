/**
 * Stage 10 acceptance: visual captures at risk bands + paired perf vs calm.
 * Temporary harness — not part of the product runtime.
 */
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, ".snapshots");
const url = process.argv[2] || "http://localhost:5173/";
const CHROME = {
    darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    linux: "/usr/bin/google-chrome",
    win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
};
const executablePath = process.env.CHROME_PATH || CHROME[process.platform];
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
    executablePath,
    headless: false,
    args: ["--enable-unsafe-webgpu", "--window-size=1600,900"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const logs = [];
page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") logs.push(`[${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: "load", timeout: 60000 });
await page.waitForFunction(() => !!globalThis.BORAN?.blizzard, null, { timeout: 120000 });

async function sample() {
    return page.evaluate(() => {
        const a = globalThis.BORAN;
        const p = a.perfStats;
        return {
            medianMs: +p.median.toFixed(3),
            p95Ms: +p.p95.toFixed(3),
            p99Ms: +p.p99.toFixed(3),
            fps: +p.fps.toFixed(2),
            drawCalls: p.drawCalls,
            triangles: p.triangles,
            risk: +a.weather.current.risk.toFixed(3),
            dens: +a.S.blizzardDensity.toFixed(3),
            opac: +a.S.blizzardOpacity.toFixed(3),
            near: +a.S.nearSnowIntensity.toFixed(3),
            gust: +a.S.gustStrength.toFixed(3),
            windX: +a.S.runtimeWindX.toFixed(3),
            windZ: +a.S.runtimeWindZ.toFixed(3),
            blizzardTris: a.blizzard.triangleCount,
        };
    });
}

async function setRisk(r) {
    await page.evaluate((risk) => {
        globalThis.BORAN.setRisk(risk);
        globalThis.BORAN.weather.snap();
    }, r);
    await page.waitForTimeout(2800);
}

async function shot(name) {
    const buf = await page.evaluate(async () => {
        const c = document.getElementById("view");
        return c ? c.toDataURL("image/png") : null;
    });
    if (buf?.startsWith("data:image/png")) {
        fs.writeFileSync(path.join(OUT, name), Buffer.from(buf.split(",")[1], "base64"));
    }
}

const risks = [0.2, 0.5, 0.85, 0.95];
const visuals = {};
for (const r of risks) {
    console.log("visual risk", r);
    await setRisk(r);
    visuals[`r${r}`] = await sample();
    await shot(`shot-stage10-r${String(r).replace(".", "")}.png`);
}

// Paired perf: calm (0.12) vs storm (0.85), 3 pairs
const pairs = [];
for (let i = 0; i < 3; i++) {
    console.log("pair", i + 1, "calm");
    await setRisk(0.12);
    await page.waitForTimeout(2000);
    const base = await sample();
    console.log("pair", i + 1, "storm");
    await setRisk(0.85);
    await page.waitForTimeout(2000);
    const storm = await sample();
    pairs.push({
        pair: i + 1,
        baseMedian: base.medianMs,
        stormMedian: storm.medianMs,
        deltaMs: +(storm.medianMs - base.medianMs).toFixed(3),
        deltaPct: +(((storm.medianMs - base.medianMs) / base.medianMs) * 100).toFixed(2),
        baseDraws: base.drawCalls,
        stormDraws: storm.drawCalls,
        baseTris: base.triangles,
        stormTris: storm.triangles,
        stormDens: storm.dens,
    });
}

const meanDeltaPct = pairs.reduce((a, p) => a + p.deltaPct, 0) / pairs.length;
const report = {
    generatedAt: new Date().toISOString(),
    visuals,
    pairs,
    meanPairedDeltaPct: +meanDeltaPct.toFixed(2),
    perfPassPreferred: meanDeltaPct <= 10,
    perfPassMax: meanDeltaPct <= 15,
    logs: logs.slice(-30),
};
fs.writeFileSync(path.join(OUT, "stage10-blizzard-accept.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
    meanPairedDeltaPct: report.meanPairedDeltaPct,
    perfPassPreferred: report.perfPassPreferred,
    perfPassMax: report.perfPassMax,
    visuals: Object.fromEntries(Object.entries(visuals).map(([k, v]) => [k, {
        dens: v.dens, opac: v.opac, near: v.near, draws: v.drawCalls, medianMs: v.medianMs,
    }])),
    pairs,
}, null, 2));
await browser.close();
process.exit(report.perfPassMax ? 0 : 1);
