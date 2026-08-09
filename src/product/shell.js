/**
 * The KAIROS interface.
 *
 * Plain DOM over the WebGPU canvas. Owns markup and text only.
 */

import { CSS } from "./shell.css.js";
import { DEFAULT_SEGMENTS } from "../services/realPredictionService.js";

export class Shell {
    constructor() {
        const style = document.createElement("style");
        style.textContent = CSS;
        document.head.appendChild(style);

        const root = document.createElement("div");
        root.id = "boran";
        root.innerHTML = MARKUP;
        document.body.appendChild(root);
        this.root = root;

        this.el = {
            segment: root.querySelector("#b-segment"),
            depart: root.querySelector("#b-depart"),
            go: root.querySelector("#b-go"),
            plan: root.querySelector("#b-plan"),
            liveToggle: root.querySelector("#b-live-toggle"),
            liveFields: root.querySelector("#b-live-fields"),
            loc: root.querySelector("#b-loc"),
            form: root.querySelector("#b-form"),
            result: root.querySelector("#b-result"),
            route: root.querySelector("#b-route"),
            pct: root.querySelector("#b-pct"),
            band: root.querySelector("#b-band"),
            headline: root.querySelector("#b-headline"),
            detail: root.querySelector("#b-detail"),
            advice: root.querySelector("#b-advice"),
            adviceTime: root.querySelector("#b-advice-time"),
            back: root.querySelector("#b-back"),
            why: root.querySelector("#b-why"),
            time: root.querySelector("#b-time"),
            timeRead: root.querySelector("#b-time-read"),
            mode: root.querySelector("#b-mode"),
            liveBadge: root.querySelector("#b-live"),
            metWind: root.querySelector("#b-met-wind"),
            metSnow: root.querySelector("#b-met-snow"),
            metVis: root.querySelector("#b-met-vis"),
            metTemp: root.querySelector("#b-met-temp"),
            winterCta: root.querySelector("#b-winter-cta"),
            scoreNote: root.querySelector("#b-score-note"),
            copilot: root.querySelector("#b-copilot"),
            copilotToggle: root.querySelector("#b-ask"),
            copilotClose: root.querySelector("#b-cp-close"),
            copilotTitle: root.querySelector("#b-cp-title"),
            copilotSummary: root.querySelector("#b-cp-summary"),
            copilotBest: root.querySelector("#b-cp-best"),
            copilotConcerns: root.querySelector("#b-cp-concerns"),
            copilotPrompts: root.querySelector("#b-cp-prompts"),
            copilotAnswer: root.querySelector("#b-cp-answer"),
            copilotInput: root.querySelector("#b-cp-input"),
            copilotSend: root.querySelector("#b-cp-send"),
            copilotStatus: root.querySelector("#b-cp-status"),
            copilotLocale: root.querySelector("#b-cp-locale"),
            copilotProfile: root.querySelector("#b-cp-profile"),
            copilotThread: root.querySelector("#b-cp-thread"),
            copilotBack: root.querySelector("#b-cp-back"),
        };

        this.replayEl = {
            panel: root.querySelector("#b-replay"),
            date: root.querySelector("#b-rp-date"),
            clock: root.querySelector("#b-rp-clock"),
            risk: root.querySelector("#b-rp-risk"),
            fill: root.querySelector("#b-rp-fill"),
            mark: root.querySelector("#b-rp-mark"),
            note: root.querySelector("#b-rp-note"),
            verdict: root.querySelector("#b-rp-verdict"),
            start: root.querySelector("#b-replay-start"),
            exit: root.querySelector("#b-replay-exit"),
        };

        this.setSegments(DEFAULT_SEGMENTS);

        this.panel = root.querySelector(".b-panel");
        /** @type {"form"|"result"|"copilot"|"replay"|"hold"} */
        this._view = "form";
        /** @type {import("../services/predictionService.js").Prediction|null} */
        this._lastPrediction = null;
        /** @type {Array<{role:string,text:string,available?:boolean}>} */
        this._chat = [];
        this.setView("form");

        /** @type {((r: {segmentId:string, label:string, departure:string}) => void)|null} */
        this.onAnalyze = null;
        /** @type {(() => void)|null} */
        this.onPlanJourney = null;
        /** @type {((message: string, extras?: object) => void)|null} */
        this.onCopilotAsk = null;
        /** @type {(() => void)|null} */
        this.onWinterReplay = null;
        /** @type {(() => void)|null} */
        this.onBackToMap = null;

        this.el.plan?.addEventListener("click", () => this.onPlanJourney?.());
        this.el.go?.addEventListener("click", () => this.onAnalyze?.(this.route()));
        this.el.liveToggle?.addEventListener("click", () => {
            const open = this.el.liveFields?.hasAttribute("hidden");
            if (open) this.el.liveFields?.removeAttribute("hidden");
            else this.el.liveFields?.setAttribute("hidden", "");
        });
        this.el.winterCta?.addEventListener("click", () => this.onWinterReplay?.());
        this.el.back?.addEventListener("click", () => this.onBackToMap?.());
        this.el.why?.addEventListener("click", () => {
            this.openCopilot();
            this.onCopilotAsk?.("Why is this risk?", {});
        });
        this.replayEl.start?.addEventListener("click", () => {
            // also used by RouteFlow.onWinterReplay via click()
        });

        this.el.copilotToggle?.addEventListener("click", () => this.openCopilot());
        this.el.copilotClose?.addEventListener("click", () => this.closeCopilot());
        this.el.copilotBack?.addEventListener("click", () => this.closeCopilot());
        this.el.copilotSend?.addEventListener("click", () => this._submitCopilot());
        this.el.copilotInput?.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this._submitCopilot();
            }
        });
        this.el.copilotPrompts?.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-prompt]");
            if (!btn) return;
            const prompt = btn.getAttribute("data-prompt") || "";
            this.onCopilotAsk?.(prompt, this._promptExtras(prompt));
        });
        // Changing language/profile must never reveal the landing form underneath.
        this.el.copilotLocale?.addEventListener("change", () => {
            if (this._view === "copilot" && this._lastPrediction) {
                this.setView("copilot");
                this._fillCopilotCard(this._lastPrediction);
            }
        });
        this.el.copilotProfile?.addEventListener("change", () => {
            if (this._view === "copilot") this.setView("copilot");
        });
    }

    /**
     * Exclusive panel mode — only one of form/result/copilot/replay is visible.
     * @param {"form"|"result"|"copilot"|"replay"|"hold"} view
     */
    setView(view) {
        this._view = view;
        if (this.panel) this.panel.dataset.view = view;
        this.el.form.classList.toggle("b-gone", view !== "form");
        this.el.result.classList.toggle("b-shown", view === "result");
        this.el.copilot.classList.toggle("b-shown", view === "copilot");
        this.replayEl.panel.classList.toggle("b-shown", view === "replay");
    }

    _promptExtras(prompt) {
        if (/compare|сравн|салыстыр/i.test(prompt)) {
            return { compareTimes: ["14:00", "16:00"] };
        }
        return {};
    }

    _submitCopilot() {
        const msg = (this.el.copilotInput?.value || "").trim();
        if (!msg) return;
        this.el.copilotInput.value = "";
        this.onCopilotAsk?.(msg);
    }

    /**
     * @param {Array<{segment_id:string,label:string}>} segments
     */
    setSegments(segments) {
        const sel = this.el.segment;
        const prev = sel.value;
        sel.replaceChildren();
        for (const s of segments) {
            const o = document.createElement("option");
            o.value = s.segment_id;
            o.textContent = s.label;
            sel.appendChild(o);
        }
        if (prev && [...sel.options].some((o) => o.value === prev)) {
            sel.value = prev;
        } else if (sel.options.length) {
            sel.selectedIndex = 0;
        }
    }

    route() {
        const opt = this.el.segment.selectedOptions[0];
        return {
            segmentId: this.el.segment.value,
            label: opt?.textContent || this.el.segment.value,
            departure: this.el.depart.value,
        };
    }

    reveal() {
        requestAnimationFrame(() => requestAnimationFrame(() => {
            this.root.classList.add("ready");
        }));
    }

    /** @param {string} text */
    setStatus(text) {
        this.el.loc.textContent = text;
    }

    /**
     * @param {"live"|"fallback"|"unknown"|string} mode
     * @param {string} [detail]
     */
    setPredictionMode(mode, detail) {
        if (!this.el.mode) return;
        if (mode === "live") {
            this.el.mode.textContent = detail || "Live LightGBM";
            this.el.mode.dataset.mode = "live";
            this.el.mode.hidden = false;
        } else if (mode === "fallback") {
            this.el.mode.textContent =
                detail || "Live ML temporarily unavailable · demo fallback";
            this.el.mode.dataset.mode = "fallback";
            this.el.mode.hidden = false;
        } else {
            this.el.mode.hidden = true;
            this.el.mode.textContent = "";
            this.el.mode.dataset.mode = "";
        }
    }

    setBusy(busy) {
        if (this.el.go) {
            this.el.go.disabled = busy;
            this.el.go.textContent = busy ? "Analyzing" : "Analyze corridor";
        }
        if (this.el.plan) this.el.plan.disabled = busy;
    }

    hideForm() {
        this.setView("hold");
    }

    showForm() {
        this._lastPrediction = null;
        this.clearCopilotChat();
        this.setView("form");
        this.setBusy(false);
    }

    /**
     * @param {import("../services/predictionService.js").Prediction} p
     * @param {{segmentId?:string, label?:string, from?:string, to?:string}} route
     */
    showResult(p, route) {
        this._lastPrediction = p;
        this.clearCopilotChat();
        this.el.route.textContent = routeLabel(route);
        this._paintPrediction(p);
        this._fillCopilotCard(p);
        this.setView("result");
    }

    /**
     * @param {import("../services/predictionService.js").Prediction} p
     * @param {string} clock
     */
    updateScrub(p, clock) {
        this.el.timeRead.textContent = clock;
        this._paintPrediction(p);
    }

    /**
     * @param {import("../services/predictionService.js").Prediction} p
     */
    _paintPrediction(p) {
        const e = this.el;
        const calm = p.winterHazardActive === false;

        e.pct.textContent = Math.round(p.risk * 100) + "%";
        e.band.textContent = calm
            ? "model score · winter hazard inactive"
            : `${p.riskLabel} closure risk`;
        e.headline.textContent = p.headline;
        // Keep the result view short; long explanations live in Copilot.
        e.detail.textContent = calm
            ? (p.seasonalReason || "No snow or freezing conditions in the current forecast.")
            : p.detail;
        e.result.dataset.band = calm ? "calm" : p.riskLabel;
        e.result.dataset.season = calm ? "live-calm" : "winter";

        if (e.liveBadge) {
            e.liveBadge.hidden = !calm;
            e.liveBadge.textContent = "Live conditions · winter hazard inactive";
        }

        if (e.metWind) {
            e.metWind.textContent = `${p.windSpeed.toFixed(0)} m/s`;
            e.metSnow.textContent = `${p.snowfall.toFixed(1)} mm/h`;
            e.metVis.textContent = formatVis(p.visibility);
            e.metTemp.textContent = `${Math.round(p.temperature)}°C`;
        }

        if (e.winterCta) {
            e.winterCta.hidden = !calm;
        }
        // One winter entry point when live is calm — avoid duplicate CTAs.
        if (this.replayEl.start) {
            this.replayEl.start.hidden = !!calm;
        }

        if (e.scoreNote) {
            if (calm && p.oodCaution && p.risk >= 0.28) {
                e.scoreNote.hidden = false;
                e.scoreNote.textContent =
                    "Elevated model scores in non-winter weather may be out-of-distribution — not a calibrated probability.";
            } else {
                e.scoreNote.hidden = true;
            }
        }

        // De-emphasize giant % when calm live.
        e.pct.classList.toggle("b-pct-soft", calm);

        if (p.recommendedDeparture && !calm) {
            e.adviceTime.textContent = p.recommendedDeparture;
            e.advice.hidden = false;
        } else {
            e.advice.hidden = true;
        }
    }

    setScrubTime(clock) {
        const m = /^(\d{1,2}):(\d{2})$/.exec(clock || "");
        if (!m) return;
        this.el.time.value = String(+m[1] * 60 + +m[2]);
        this.el.timeRead.textContent = clock;
    }

    /** @param {import("../services/predictionService.js").Prediction} p */
    _fillCopilotCard(p) {
        const locale = this.getCopilotLocale();
        const a = p.assessment;
        this.el.copilotTitle.textContent = a?.title || "KAIROS Copilot";
        this.el.copilotSummary.textContent = a?.summary || p.headline || "";
        if (a?.bestWindow) {
            this.el.copilotBest.hidden = false;
            this.el.copilotBest.textContent = `Best window · ${a.bestWindow}`;
        } else {
            this.el.copilotBest.hidden = true;
        }
        const concerns = a?.primaryConcerns || [];
        this.el.copilotConcerns.textContent = concerns.length
            ? concerns.join(" · ")
            : "";
        // Explicit false = live calm/summer. Undefined (mock) keeps winter prompts.
        const prompts = quickPromptsFor(
            p.riskLabel || "low",
            p.winterHazardActive !== false,
            locale,
        );
        this.el.copilotPrompts.replaceChildren();
        for (const q of prompts) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "b-cp-chip";
            b.dataset.prompt = q;
            b.textContent = q;
            this.el.copilotPrompts.appendChild(b);
        }
    }

    openCopilot() {
        if (this._lastPrediction) this._fillCopilotCard(this._lastPrediction);
        this.el.copilotStatus.textContent = "";
        this.setView("copilot");
        this._scrollCopilotThread();
        this.el.copilotInput?.focus();
    }

    closeCopilot() {
        this.setCopilotBusy(false);
        if (this._lastPrediction) this.setView("result");
        else this.setView("form");
    }

    clearCopilotChat() {
        this._chat = [];
        if (this.el.copilotThread) this.el.copilotThread.replaceChildren();
        if (this.el.copilotStatus) this.el.copilotStatus.textContent = "";
    }

    /**
     * @param {"user"|"assistant"} role
     * @param {string} text
     * @param {{ available?: boolean }} [opts]
     */
    appendCopilotMessage(role, text, opts = {}) {
        if (!this.el.copilotThread) return;
        this.setView("copilot");
        const available = opts.available !== false;
        this._chat.push({ role, text, available });

        const row = document.createElement("div");
        row.className = `b-cp-msg b-cp-msg-${role}`;
        if (role === "assistant" && !available) {
            row.dataset.available = "0";
        }

        const who = document.createElement("div");
        who.className = "b-cp-msg-who";
        who.textContent = role === "user" ? "You" : "KAIROS";

        const body = document.createElement("div");
        body.className = "b-cp-msg-body";
        if (role === "assistant") {
            body.innerHTML = formatCopilotHtml(text || "");
        } else {
            body.textContent = text || "";
        }

        row.appendChild(who);
        row.appendChild(body);
        this.el.copilotThread.appendChild(row);
        this._scrollCopilotThread();

        if (role === "assistant") {
            this.el.copilotStatus.textContent = available
                ? ""
                : "AI explanation temporarily unavailable";
        }
    }

    showCopilotAnswer(text, available = true) {
        this.appendCopilotMessage("assistant", text, { available });
    }

    _scrollCopilotThread() {
        const t = this.el.copilotThread;
        if (!t) return;
        requestAnimationFrame(() => {
            t.scrollTop = t.scrollHeight;
        });
    }

    setCopilotBusy(busy) {
        if (this.el.copilotSend) this.el.copilotSend.disabled = busy;
        if (this.el.copilotInput) this.el.copilotInput.disabled = busy;
        if (this.el.copilotPrompts) {
            this.el.copilotPrompts.style.pointerEvents = busy ? "none" : "";
            this.el.copilotPrompts.style.opacity = busy ? "0.45" : "";
        }
        if (this.el.copilotStatus) {
            this.el.copilotStatus.textContent = busy
                ? "Analyzing road conditions"
                : "";
            this.el.copilotStatus.dataset.busy = busy ? "1" : "0";
        }
        if (this._view === "copilot") this.setView("copilot");
    }

    getCopilotLocale() {
        return this.el.copilotLocale?.value || "en";
    }

    getCopilotProfile() {
        return this.el.copilotProfile?.value || "car";
    }
}

Shell.prototype.enterReplay = function (rec, markFraction) {
    this.setCopilotBusy(false);
    this.setView("replay");
    this.replayEl.date.textContent =
        `Illustrative winter scenario · ${rec.route.from} → ${rec.route.to} · ${rec.label}`;
    this.replayEl.verdict.classList.remove("b-shown");
    this.replayEl.panel.dataset.band = "low";
    this.replayEl.mark.dataset.on = "0";
    this.replayEl.mark.style.left = (markFraction * 100).toFixed(2) + "%";
    this.setStatus(`Illustrative winter scenario · ${rec.label}`);
};

Shell.prototype.exitReplay = function () {
    this.setView("form");
    this.setBusy(false);
    this.setStatus("Kazakhstan · winter road network");
};

Shell.prototype.updateReplay = function (s) {
    const e = this.replayEl;
    const pct = Math.round(s.risk * 100) + "%";
    if (e.clock.textContent !== s.clock) e.clock.textContent = s.clock;
    if (e.risk.textContent !== pct) e.risk.textContent = pct;
    if (e.note.textContent !== s.note) e.note.textContent = s.note;

    e.fill.style.transform = `scaleX(${s.progress.toFixed(4)})`;

    const band = s.risk < 0.25 ? "low"
        : s.risk < 0.5 ? "moderate"
        : s.risk < 0.75 ? "high"
        : s.risk < 0.9 ? "severe" : "extreme";
    if (e.panel.dataset.band !== band) e.panel.dataset.band = band;

    const crossed = s.crossed ? "1" : "0";
    if (e.mark.dataset.on !== crossed) e.mark.dataset.on = crossed;

    if (s.closed && !e.verdict.classList.contains("b-shown")) {
        e.verdict.innerHTML =
            `<strong>Road closed &middot; ${s.closedAt}</strong>` +
            `<span>Illustrative threshold ${Math.round(s.threshold * 100)}% at ` +
            `${s.crossingClock} &mdash; <b>${s.lead} earlier</b></span>`;
        e.verdict.classList.add("b-shown");
    }
};

export function minutesToClock(mins) {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function routeLabel(route) {
    if (route?.journeyLabel) return route.journeyLabel;
    if (route?.from && route?.to) return `${route.from} → ${route.to}`;
    if (route?.label) return route.label;
    return route?.segmentId || "";
}

function formatVis(m) {
    if (m >= 1000) return `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`;
    return `${Math.round(m)} m`;
}

/** Escape HTML, then turn `**bold**` into <strong>. */
function formatCopilotHtml(text) {
    const esc = String(text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    return esc
        .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
        .replace(/\n/g, "<br>");
}

function quickPromptsFor(riskLabel, winterActive, locale) {
    if (!winterActive) {
        const table = {
            en: [
                "Summarize current conditions",
                "Why is there no winter hazard?",
                "What does the model score mean in summer?",
                "When should I use winter replay?",
            ],
            ru: [
                "Кратко опиши текущие условия",
                "Почему зимняя угроза неактивна?",
                "Что значит оценка модели летом?",
                "Когда смотреть зимной сценарий?",
            ],
            kk: [
                "Қазіргі жағдайды қысқаша айт",
                "Неге қысқы қауіп белсенді емес?",
                "Жазда модель бағасы нені білдіреді?",
                "Қысқы сценарийді қашан көру керек?",
            ],
        };
        return table[locale] || table.en;
    }
    if (riskLabel === "high") {
        const table = {
            en: [
                "Should I postpone?",
                "Why is risk high?",
                "Safest departure today",
                "What should I prepare?",
            ],
            ru: [
                "Стоит ли отложить поездку?",
                "Почему риск высокий?",
                "Самое безопасное время выезда",
                "Что взять с собой?",
            ],
            kk: [
                "Сапарды кейінге қалдыру керек пе?",
                "Неге қауіп жоғары?",
                "Ең қауіпсіз шығу уақыты",
                "Не дайындау керек?",
            ],
        };
        return table[locale] || table.en;
    }
    if (riskLabel === "moderate") {
        const table = {
            en: [
                "What is changing?",
                "Compare safer times",
                "Should I leave earlier?",
                "Summarize weather",
            ],
            ru: [
                "Что меняется?",
                "Сравни более безопасные времена",
                "Выехать раньше?",
                "Кратко о погоде",
            ],
            kk: [
                "Не өзгеруде?",
                "Қауіпсіз уақыттарды салыстыр",
                "Ертерек шығу керек пе?",
                "Ауа райын қысқаша айт",
            ],
        };
        return table[locale] || table.en;
    }
    const table = {
        en: [
            "Why is this route safer now?",
            "Best departure today",
            "Summarize weather",
        ],
        ru: [
            "Почему маршрут сейчас безопаснее?",
            "Лучшее время выезда сегодня",
            "Кратко о погоде",
        ],
        kk: [
            "Неге маршрут қазір қауіпсіздеу?",
            "Бүгінгі ең жақсы шығу уақыты",
            "Ауа райын қысқаша айт",
        ],
    };
    return table[locale] || table.en;
}

const MARKUP = `
<header class="b-top">
    <div class="b-mark b-rise b-d1">KAIROS</div>
    <div class="b-loc b-rise b-d1" id="b-loc">Kazakhstan &middot; winter road network</div>
</header>

<section class="b-panel">
    <div id="b-form">
        <h1 class="b-lede b-rise b-d2">
            Know the road<em>before it closes.</em>
        </h1>

        <div class="b-rise b-d3">
            <button class="b-go" id="b-plan" type="button">Plan journey</button>
        </div>
        <p class="b-rise b-d4">
            <button class="b-text-link" id="b-live-toggle" type="button">Live conditions</button>
        </p>

        <div id="b-live-fields" class="b-live-fields b-rise b-d4" hidden>
            <div class="b-fields">
                <div class="b-field b-field-wide">
                    <label for="b-segment">Trained corridor</label>
                    <select id="b-segment"></select>
                </div>
                <div class="b-field">
                    <label for="b-depart">Departure</label>
                    <input id="b-depart" type="time" value="16:00" step="900" />
                </div>
            </div>
            <button class="b-go" id="b-go" type="button">Analyze corridor</button>
        </div>
        <p class="b-mode b-rise b-d4" id="b-mode" hidden></p>
    </div>

    <div id="b-result" class="b-result" aria-live="polite">
        <div class="b-route" id="b-route"></div>
        <div class="b-live" id="b-live" hidden>Live conditions · winter hazard inactive</div>
        <div class="b-pct" id="b-pct"></div>
        <div class="b-band" id="b-band"></div>
        <p class="b-score-note" id="b-score-note" hidden></p>
        <p class="b-headline" id="b-headline"></p>
        <p class="b-detail" id="b-detail"></p>

        <div class="b-mets" aria-label="Live weather">
            <div><span>Wind</span><b id="b-met-wind">—</b></div>
            <div><span>Snowfall</span><b id="b-met-snow">—</b></div>
            <div><span>Visibility</span><b id="b-met-vis">—</b></div>
            <div><span>Temp</span><b id="b-met-temp">—</b></div>
        </div>

        <p class="b-advice" id="b-advice" hidden>
            Recommended departure <b>before <span id="b-advice-time"></span></b>
        </p>

        <div class="b-scrub">
            <label class="b-scrub-label" for="b-time">
                Departure <b id="b-time-read">16:00</b>
            </label>
            <input class="b-slider" id="b-time" type="range"
                   min="600" max="1200" step="5" value="960"
                   aria-label="Departure time" />
            <div class="b-scrub-ends"><span>10:00</span><span>20:00</span></div>
        </div>

        <div class="b-actions">
            <button class="b-back" id="b-why" type="button">Why this risk?</button>
            <button class="b-back" id="b-ask" type="button">Ask KAIROS</button>
            <button class="b-back" id="b-back" type="button">Change route</button>
            <button class="b-back" id="b-replay-start" type="button">Illustrative winter scenario</button>
        </div>
        <button class="b-winter-cta" id="b-winter-cta" type="button" hidden>
            See KAIROS in winter conditions
        </button>
    </div>

    <div id="b-copilot" class="b-copilot" aria-live="polite">
        <div class="b-cp-head">
            <div>
                <div class="b-cp-kicker">KAIROS Copilot</div>
                <div class="b-cp-title" id="b-cp-title"></div>
            </div>
            <button class="b-cp-x" id="b-cp-close" type="button">Back to forecast</button>
        </div>
        <p class="b-cp-summary" id="b-cp-summary"></p>
        <p class="b-cp-best" id="b-cp-best" hidden></p>
        <p class="b-cp-concerns" id="b-cp-concerns"></p>
        <div class="b-cp-prompts" id="b-cp-prompts"></div>
        <div class="b-cp-tools">
            <label>
                <span>Language</span>
                <select id="b-cp-locale">
                    <option value="en">English</option>
                    <option value="ru">Русский</option>
                    <option value="kk">Қазақша</option>
                </select>
            </label>
            <label>
                <span>Profile</span>
                <select id="b-cp-profile">
                    <option value="car">Car</option>
                    <option value="truck">Truck</option>
                    <option value="family">Family</option>
                </select>
            </label>
        </div>
        <div class="b-cp-thread" id="b-cp-thread" role="log" aria-relevant="additions"></div>
        <p class="b-cp-status" id="b-cp-status" data-busy="0"></p>
        <div class="b-cp-input-row">
            <input id="b-cp-input" type="text" maxlength="600"
                   placeholder="Ask KAIROS…" autocomplete="off" />
            <button class="b-go b-cp-send" id="b-cp-send" type="button">Ask</button>
        </div>
        <button class="b-back b-cp-back" id="b-cp-back" type="button">Back to forecast</button>
    </div>

    <div id="b-replay" class="b-replay" aria-live="polite">
        <div class="b-route" id="b-rp-date"></div>
        <div class="b-rp-head">
            <span class="b-rp-clock" id="b-rp-clock">06:00</span>
            <span class="b-rp-risk" id="b-rp-risk">11%</span>
        </div>
        <div class="b-rp-track">
            <div class="b-rp-fill" id="b-rp-fill"></div>
            <div class="b-rp-mark" id="b-rp-mark"><span></span></div>
        </div>
        <div class="b-rp-note" id="b-rp-note"></div>
        <div class="b-rp-verdict" id="b-rp-verdict"></div>
        <button class="b-back" id="b-replay-exit">Exit scenario</button>
    </div>
</section>

<footer class="b-foot b-rise b-d5">
    <span>Live weather &middot; LightGBM risk &middot; Copilot</span>
    <span>Decision support, not a probability</span>
</footer>
`;
