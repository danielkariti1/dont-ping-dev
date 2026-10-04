(function () {
  "use strict";

  const rawConfig = window.DPD_CONFIG || {};
  const eventFromUrl = new URLSearchParams(window.location.search).get("event");
  const normalizedEvent = String(eventFromUrl || "").trim().toLowerCase();
  const safeEvent = /^[a-z0-9][a-z0-9-]{1,39}$/.test(normalizedEvent) ? normalizedEvent : null;
  const config = {
    eventId: safeEvent || rawConfig.eventId || "tech-market-2026-live",
    edgeFunctionUrl: String(rawConfig.edgeFunctionUrl || "").replace(/\/$/, ""),
    supabaseAnonKey: String(rawConfig.supabaseAnonKey || ""),
    pollMs: Math.max(2000, Number(rawConfig.leaderboardPollMs) || 5000),
    limit: Math.min(100, Math.max(3, Number(rawConfig.leaderboardSize) || 20)),
    gameUrl: String(rawConfig.gameUrl || "")
  };
  const isDemo = !config.edgeFunctionUrl;
  let refreshTimer = 0;
  let requestInFlight = false;
  let previousSignature = "";

  const elements = {
    podium: document.querySelector("#podium"),
    leaderList: document.querySelector("#leaderList"),
    emptyState: document.querySelector("#emptyState"),
    error: document.querySelector("#leaderboardError"),
    lastUpdated: document.querySelector("#lastUpdated"),
    modeBadge: document.querySelector("#leaderModeBadge"),
    qrCode: document.querySelector("#qrCode"),
    gameUrl: document.querySelector("#gameUrl")
  };

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function demoEntries() {
    try {
      const entries = JSON.parse(readStorage(`dpd:leaderboard:${config.eventId}`) || "[]");
      return Array.isArray(entries) ? entries.slice(0, config.limit) : [];
    } catch (_) {
      return [];
    }
  }

  async function fetchEntries() {
    if (isDemo) return { entries: demoEntries(), updatedAt: new Date().toISOString() };
    const headers = { "Content-Type": "application/json" };
    if (config.supabaseAnonKey) {
      headers.apikey = config.supabaseAnonKey;
      headers.Authorization = `Bearer ${config.supabaseAnonKey}`;
    }
    // Production contract: POST { action:'leaderboard', eventId, limit }.
    // The Edge Function also supports the equivalent GET query for diagnostics.
    const response = await fetch(config.edgeFunctionUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: "leaderboard", eventId: config.eventId, limit: config.limit }),
      cache: "no-store"
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Leaderboard request failed (${response.status})`);
    return body;
  }

  function normalize(entry, index) {
    return {
      rank: Number(entry.rank) || index + 1,
      playerName: String(entry.playerName || "Anonymous").slice(0, 24),
      teamName: String(entry.teamName || "").slice(0, 24),
      correctAnswers: Number(entry.correctAnswers ?? entry.totalCorrect ?? 0),
      questionCount: Number(entry.questionCount || 7),
      durationMs: Number(entry.durationMs || 0),
      interruptionsAvoided: Number(entry.interruptionsAvoided || 0)
    };
  }

  function createText(tagName, className, text) {
    const node = document.createElement(tagName);
    node.className = className;
    node.textContent = text;
    return node;
  }

  function createPodiumPlace(entry, place) {
    const node = document.createElement("article");
    node.className = "podium-place";
    node.dataset.place = String(place);
    node.appendChild(createText("span", "podium-medal", ["🥇", "🥈", "🥉"][place - 1]));
    node.appendChild(createText("strong", "podium-name", entry.playerName));
    node.appendChild(createText("span", "podium-team", entry.teamName || "Independent protector"));
    const time = entry.durationMs ? ` · ${(entry.durationMs / 1000).toFixed(1)}s` : "";
    node.appendChild(createText("span", "podium-score", `${entry.correctAnswers}/${entry.questionCount}${time}`));
    return node;
  }

  function createLeaderRow(entry, rank) {
    const row = document.createElement("article");
    row.className = "leader-row";
    row.appendChild(createText("span", "leader-rank", `#${rank}`));

    const identity = document.createElement("div");
    identity.className = "leader-identity";
    identity.appendChild(createText("strong", "", entry.playerName));
    identity.appendChild(createText("small", "", entry.teamName || "No team"));
    row.appendChild(identity);

    const score = document.createElement("span");
    score.className = "leader-stat";
    const scoreValue = createText("b", "", `${entry.correctAnswers}/${entry.questionCount}`);
    score.append(scoreValue, document.createElement("br"), document.createTextNode("correct"));
    row.appendChild(score);

    const time = document.createElement("span");
    time.className = "leader-stat leader-time";
    const timeValue = createText("b", "", entry.durationMs ? `${(entry.durationMs / 1000).toFixed(1)}s` : "—");
    time.append(timeValue, document.createElement("br"), document.createTextNode("round time"));
    row.appendChild(time);
    return row;
  }

  function render(entries) {
    const normalized = entries.map(normalize);
    const signature = JSON.stringify(normalized);
    elements.emptyState.hidden = normalized.length > 0;
    elements.error.hidden = true;
    if (signature === previousSignature) return;
    previousSignature = signature;
    elements.podium.replaceChildren();
    elements.leaderList.replaceChildren();

    const podiumEntries = normalized.slice(0, 3);
    podiumEntries.forEach((entry, index) => elements.podium.appendChild(createPodiumPlace(entry, index + 1)));
    elements.podium.hidden = podiumEntries.length === 0;
    normalized.slice(3).forEach((entry, index) => elements.leaderList.appendChild(createLeaderRow(entry, index + 4)));
  }

  function setUpdated(updatedAt) {
    const time = updatedAt ? new Date(updatedAt) : new Date();
    elements.lastUpdated.textContent = Number.isNaN(time.getTime())
      ? "Live"
      : `Updated ${time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
  }

  async function refresh() {
    if (requestInFlight || document.hidden) return;
    requestInFlight = true;
    try {
      const response = await fetchEntries();
      render(Array.isArray(response.entries) ? response.entries : []);
      setUpdated(response.updatedAt);
    } catch (error) {
      elements.error.textContent = `Leaderboard temporarily unavailable: ${error.message}`;
      elements.error.hidden = false;
      elements.lastUpdated.textContent = "Reconnecting…";
    } finally {
      requestInFlight = false;
    }
  }

  function deriveGameUrl() {
    if (config.gameUrl) {
      try {
        const url = new URL(config.gameUrl, window.location.href);
        // The fixed booth URL stays clean for the configured default event.
        // Preserve an explicit leaderboard ?event= override for alternate rounds.
        if (safeEvent && safeEvent !== rawConfig.eventId) {
          url.searchParams.set("event", config.eventId);
        }
        return url.href;
      } catch (_) {
        // Fall through to the current GitHub Pages location.
      }
    }
    const url = new URL("index.html", window.location.href);
    url.searchParams.set("event", config.eventId);
    return url.href;
  }

  function renderQr(gameUrl) {
    elements.qrCode.replaceChildren();
    if (typeof window.QRCode === "function") {
      new window.QRCode(elements.qrCode, {
        text: gameUrl,
        width: 260,
        height: 260,
        colorDark: "#090c16",
        colorLight: "#ffffff",
        correctLevel: window.QRCode.CorrectLevel.M
      });
      return;
    }
    const fallback = createText("span", "", "QR unavailable");
    fallback.style.color = "#090c16";
    fallback.style.fontWeight = "800";
    elements.qrCode.appendChild(fallback);
  }

  function init() {
    elements.modeBadge.hidden = !isDemo;
    const gameUrl = deriveGameUrl();
    elements.gameUrl.href = gameUrl;
    elements.gameUrl.textContent = gameUrl.replace(/^https?:\/\//, "");
    renderQr(gameUrl);
    window.addEventListener("qrcode-library-error", () => renderQr(gameUrl), { once: true });
    refresh();
    refreshTimer = window.setInterval(refresh, config.pollMs);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });
    window.addEventListener("beforeunload", () => window.clearInterval(refreshTimer));
  }

  init();
})();
