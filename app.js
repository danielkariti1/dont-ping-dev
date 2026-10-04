(function () {
  "use strict";

  const rawConfig = window.DPD_CONFIG || {};
  const eventFromUrl = new URLSearchParams(window.location.search).get("event");
  const normalizedEvent = String(eventFromUrl || "").trim().toLowerCase();
  const safeEvent = /^[a-z0-9][a-z0-9-]{1,39}$/.test(normalizedEvent) ? normalizedEvent : null;
  const config = {
    eventId: safeEvent || rawConfig.eventId || "tech-market-2026-live",
    eventName: rawConfig.eventName || "Tech Market",
    roundSeconds: Number(rawConfig.roundSeconds) || 7,
    questionCount: 7,
    feedbackDelayMs: Number(rawConfig.feedbackDelayMs) || 1450,
    edgeFunctionUrl: String(rawConfig.edgeFunctionUrl || "").replace(/\/$/, ""),
    supabaseAnonKey: String(rawConfig.supabaseAnonKey || "")
  };
  const isDemo = !config.edgeFunctionUrl;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const screens = $$(".screen");
  const choiceButtons = $$("[data-choice]");

  const elements = {
    startScreen: $("#startScreen"),
    gameScreen: $("#gameScreen"),
    resultsScreen: $("#resultsScreen"),
    errorScreen: $("#errorScreen"),
    playerForm: $("#playerForm"),
    playerName: $("#playerName"),
    teamName: $("#teamName"),
    nameError: $("#nameError"),
    startButton: $("#startButton"),
    modeBadge: $("#modeBadge"),
    soundToggle: $("#soundToggle"),
    soundIcon: $("#soundIcon"),
    questionNumber: $("#questionNumber"),
    questionTotal: $("#questionTotal"),
    questionCategory: $("#questionCategory"),
    questionText: $("#questionText"),
    progressDots: $("#progressDots"),
    timer: $("#timer"),
    timerNumber: $("#timerNumber"),
    feedbackPanel: $("#feedbackPanel"),
    feedbackIcon: $("#feedbackIcon"),
    feedbackKicker: $("#feedbackKicker"),
    feedbackTitle: $("#feedbackTitle"),
    feedbackMessage: $("#feedbackMessage"),
    scoreValue: $("#scoreValue"),
    scoreTotal: $("#scoreTotal"),
    rankEmoji: $("#rankEmoji"),
    rankTitle: $("#rankTitle"),
    rankMessage: $("#rankMessage"),
    interruptionsMetric: $("#interruptionsMetric"),
    timeMetric: $("#timeMetric"),
    contextMetric: $("#contextMetric"),
    resultDetail: $("#resultDetail"),
    leaderboardLink: $("#leaderboardLink"),
    startLeaderboardLink: $("#startLeaderboardLink"),
    playAgainButton: $("#playAgainButton"),
    retryButton: $("#retryButton"),
    errorMessage: $("#errorMessage"),
    ruleQuestionCount: $("#ruleQuestionCount"),
    ruleSeconds: $("#ruleSeconds")
  };

  const state = {
    phase: "idle",
    sessionId: null,
    playerName: "",
    teamName: "",
    currentQuestion: null,
    currentIndex: 0,
    questionCount: config.questionCount,
    questionStartedAt: 0,
    timerDeadline: 0,
    timerFrame: 0,
    lastTickSecond: null,
    demoQuestions: [],
    demoAnswers: [],
    answerDurationMs: 0
  };

  class Soundboard {
    constructor() {
      this.enabled = readStorage("dpd:sound") !== "off";
      this.context = null;
    }

    unlock() {
      if (!this.enabled) return;
      try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        this.context = this.context || new AudioContext();
        if (this.context.state === "suspended") this.context.resume();
      } catch (_) {
        this.context = null;
      }
    }

    tone(frequency, duration, offset, type, volume) {
      if (!this.enabled || !this.context) return;
      const start = this.context.currentTime + (offset || 0);
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type || "sine";
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume || 0.055, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    }

    start() {
      this.tone(392, 0.1, 0, "square", 0.035);
      this.tone(523, 0.11, 0.1, "square", 0.035);
    }

    tick() {
      this.tone(620, 0.045, 0, "sine", 0.025);
    }

    correct() {
      this.tone(523, 0.12, 0, "triangle", 0.05);
      this.tone(659, 0.13, 0.09, "triangle", 0.05);
      this.tone(784, 0.17, 0.18, "triangle", 0.05);
    }

    wrong() {
      this.tone(220, 0.16, 0, "sawtooth", 0.035);
      this.tone(165, 0.25, 0.12, "sawtooth", 0.035);
    }

    finish() {
      [392, 523, 659, 784].forEach((frequency, index) => {
        this.tone(frequency, 0.17, index * 0.085, "triangle", 0.045);
      });
    }

    toggle() {
      this.enabled = !this.enabled;
      writeStorage("dpd:sound", this.enabled ? "on" : "off");
      if (this.enabled) {
        this.unlock();
        this.tone(660, 0.1, 0, "sine", 0.04);
      }
      return this.enabled;
    }
  }

  const sound = new Soundboard();

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (_) {
      // Private browsing can disable storage. The game still works.
    }
  }

  function showScreen(screen) {
    screens.forEach((item) => item.classList.toggle("is-active", item === screen));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cleanInput(value, maxLength) {
    return String(value || "")
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxLength);
  }

  function setStartBusy(isBusy) {
    elements.startButton.disabled = isBusy;
    elements.startButton.firstElementChild.textContent = isBusy ? "CALLING THE AGENT…" : "START CHALLENGE";
  }

  function shuffled(values) {
    const result = values.slice();
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
  }

  function selectDemoQuestions() {
    const selection = shuffled(window.DPD_QUESTIONS || []).slice(0, config.questionCount);
    if (selection.length !== config.questionCount) {
      throw new Error("Demo question bank must contain seven categories.");
    }
    return selection;
  }

  function demoStart() {
    state.demoQuestions = selectDemoQuestions();
    state.demoAnswers = [];
    state.answerDurationMs = 0;
    state.sessionId = window.crypto && crypto.randomUUID ? crypto.randomUUID() : `demo-${Date.now()}`;
    return Promise.resolve({
      sessionId: state.sessionId,
      questionCount: config.questionCount,
      question: publicQuestion(state.demoQuestions[0])
    });
  }

  function publicQuestion(question) {
    return {
      id: question.id,
      category: question.category,
      prompt: question.prompt,
      timeLimitSeconds: config.roundSeconds
    };
  }

  function rankForScore(score, total) {
    const normalizedScore = Number(score) || 0;
    const normalizedTotal = Number(total) || 7;
    if (normalizedScore >= normalizedTotal) {
      return { title: "Legendary Developer Bodyguard", emoji: "🛡️", message: "Not a single unnecessary ping made it past you." };
    }
    if (normalizedScore >= 6) {
      return { title: "Developer Protector", emoji: "🏆", message: "Your developers can finally finish a sentence." };
    }
    if (normalizedScore >= 4) {
      return { title: "Context-Switch Defender", emoji: "💪", message: "Solid instincts. A few pings still slipped through." };
    }
    if (normalizedScore >= 2) {
      return { title: "Recovering Pinger", emoji: "😅", message: "Progress! Pause, breathe, then ask the Agent first." };
    }
    return { title: "Serial Developer Pinger", emoji: "🚨", message: "Your developers would like a word with you." };
  }

  function demoAnswer(choice, responseMs) {
    const source = state.demoQuestions[state.currentIndex];
    const isCorrect = choice === source.correct;
    state.answerDurationMs += responseMs;
    state.demoAnswers.push({
      questionId: source.id,
      choice,
      isCorrect,
      responseMs
    });

    const completed = state.demoAnswers.length === state.questionCount;
    const answer = {
      isCorrect,
      feedback: isCorrect ? source.correctFeedback : source.wrongFeedback,
      completed
    };
    if (!completed) {
      answer.nextQuestion = publicQuestion(state.demoQuestions[state.currentIndex + 1]);
      return Promise.resolve(answer);
    }

    const correctAnswers = state.demoAnswers.filter((item) => item.isCorrect).length;
    const protectedAnswers = state.demoAnswers.filter((item, index) => item.isCorrect && state.demoQuestions[index].correct === "agent");
    const interruptionsAvoided = protectedAnswers.length;
    const timeSavedMinutes = protectedAnswers.reduce((total, item) => {
      const question = state.demoQuestions.find((candidate) => candidate.id === item.questionId);
      return total + Number(question ? question.timeSavedMinutes : 0);
    }, 0);
    const rank = rankForScore(correctAnswers, state.questionCount);
    const result = {
      playerName: state.playerName,
      teamName: state.teamName,
      correctAnswers,
      questionCount: state.questionCount,
      durationMs: Math.round(state.answerDurationMs),
      interruptionsAvoided,
      timeSavedMinutes,
      rankTitle: rank.title,
      completedAt: new Date().toISOString()
    };
    saveDemoResult(result);
    answer.result = result;
    return Promise.resolve(answer);
  }

  function demoLeaderboardKey() {
    return `dpd:leaderboard:${config.eventId}`;
  }

  function saveDemoResult(result) {
    let entries = [];
    try {
      entries = JSON.parse(readStorage(demoLeaderboardKey()) || "[]");
      if (!Array.isArray(entries)) entries = [];
    } catch (_) {
      entries = [];
    }

    const identity = `${result.playerName}|${result.teamName}`.toLocaleLowerCase();
    const existingIndex = entries.findIndex((entry) => `${entry.playerName}|${entry.teamName}`.toLocaleLowerCase() === identity);
    if (existingIndex < 0) {
      entries.push(result);
    } else {
      const existing = entries[existingIndex];
      const isBetter = result.correctAnswers > existing.correctAnswers ||
        (result.correctAnswers === existing.correctAnswers && result.durationMs < existing.durationMs);
      if (isBetter) entries[existingIndex] = result;
    }
    entries.sort(compareResults);
    writeStorage(demoLeaderboardKey(), JSON.stringify(entries.slice(0, 100)));
  }

  function compareResults(a, b) {
    return Number(b.correctAnswers) - Number(a.correctAnswers) ||
      Number(a.durationMs) - Number(b.durationMs) ||
      String(a.completedAt).localeCompare(String(b.completedAt));
  }

  async function apiRequest(payload) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12000);
    const headers = { "Content-Type": "application/json" };
    if (config.supabaseAnonKey) {
      headers.apikey = config.supabaseAnonKey;
      headers.Authorization = `Bearer ${config.supabaseAnonKey}`;
    }
    try {
      const response = await fetch(config.edgeFunctionUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.error || body.message || `Request failed (${response.status})`);
        error.status = response.status;
        throw error;
      }
      return body;
    } catch (error) {
      if (error.name === "AbortError") throw new Error("The Agent took too long to answer. Check the connection and try again.");
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function startRequest() {
    if (isDemo) return demoStart();
    // Production contract: POST { action:'start', eventId, playerName, teamName }
    return apiRequest({
      action: "start",
      eventId: config.eventId,
      playerName: state.playerName,
      teamName: state.teamName
    });
  }

  function answerRequest(choice, responseMs) {
    if (isDemo) return demoAnswer(choice, responseMs);
    // Production contract: POST { action:'answer', sessionId, questionId, choice }
    // `choice` is one of agent, dev, or timeout. The server owns scoring.
    return apiRequest({
      action: "answer",
      sessionId: state.sessionId,
      questionId: state.currentQuestion.id,
      choice
    });
  }

  async function handleStart(event) {
    event.preventDefault();
    if (state.phase === "starting") return;
    sound.unlock();
    const playerName = cleanInput(elements.playerName.value, 24);
    const teamName = cleanInput(elements.teamName.value, 24);
    if (playerName.length < 2) {
      elements.nameError.textContent = "Please use at least 2 characters.";
      elements.playerName.focus();
      return;
    }
    elements.nameError.textContent = "";
    state.playerName = playerName;
    state.teamName = teamName;
    state.phase = "starting";
    setStartBusy(true);
    writeStorage("dpd:last-name", playerName);
    writeStorage("dpd:last-team", teamName);

    try {
      const response = await startRequest();
      state.sessionId = response.sessionId;
      state.questionCount = Number(response.questionCount) || config.questionCount;
      state.currentIndex = Math.max(0, Number(response.answeredCount ?? response.question?.index ?? 0));
      if (response.completed && response.result) {
        sound.finish();
        renderResults(response.result);
        return;
      }
      if (!state.sessionId || !response.question) throw new Error("The game server returned an incomplete session.");
      sound.start();
      renderQuestion(response.question);
    } catch (error) {
      renderError(error.message || "Could not start the challenge.");
    } finally {
      setStartBusy(false);
    }
  }

  function renderProgress() {
    elements.progressDots.replaceChildren();
    for (let index = 0; index < state.questionCount; index += 1) {
      const dot = document.createElement("span");
      if (index < state.currentIndex) dot.className = "is-done";
      if (index === state.currentIndex) dot.className = "is-current";
      elements.progressDots.appendChild(dot);
    }
  }

  function renderQuestion(question) {
    state.phase = "question";
    state.currentQuestion = question;
    elements.questionNumber.textContent = String(state.currentIndex + 1);
    elements.questionTotal.textContent = String(state.questionCount);
    elements.questionCategory.textContent = question.category || "MAKE THE CALL";
    elements.questionText.textContent = question.prompt;
    choiceButtons.forEach((button) => { button.disabled = false; });
    renderProgress();
    showScreen(elements.gameScreen);
    startTimer(Number(question.timeLimitSeconds) || config.roundSeconds);
  }

  function startTimer(seconds) {
    cancelTimer();
    const safeSeconds = Math.max(1, seconds);
    state.questionStartedAt = performance.now();
    state.timerDeadline = state.questionStartedAt + safeSeconds * 1000;
    state.lastTickSecond = null;
    elements.timer.classList.remove("is-urgent");

    const frame = (now) => {
      if (state.phase !== "question") return;
      const remainingMs = Math.max(0, state.timerDeadline - now);
      const remainingSeconds = Math.ceil(remainingMs / 1000);
      const progress = Math.max(0, Math.min(1, remainingMs / (safeSeconds * 1000)));
      elements.timer.style.setProperty("--timer-progress", progress.toFixed(4));
      elements.timerNumber.textContent = String(remainingSeconds);
      elements.timer.setAttribute("aria-label", `${remainingSeconds} seconds remaining`);
      elements.timer.classList.toggle("is-urgent", remainingSeconds <= 3);
      if (remainingSeconds <= 3 && remainingSeconds > 0 && remainingSeconds !== state.lastTickSecond) sound.tick();
      state.lastTickSecond = remainingSeconds;
      if (remainingMs <= 0) {
        choose("timeout");
        return;
      }
      state.timerFrame = requestAnimationFrame(frame);
    };
    state.timerFrame = requestAnimationFrame(frame);
  }

  function cancelTimer() {
    if (state.timerFrame) cancelAnimationFrame(state.timerFrame);
    state.timerFrame = 0;
  }

  async function choose(choice) {
    if (state.phase !== "question") return;
    const responseMs = Math.max(0, performance.now() - state.questionStartedAt);
    state.phase = "submitting";
    cancelTimer();
    choiceButtons.forEach((button) => { button.disabled = true; });
    try {
      const response = await answerRequest(choice, responseMs);
      showFeedback(response, response.timedOut ? "timeout" : choice);
      window.setTimeout(() => {
        elements.feedbackPanel.hidden = true;
        if (response.completed && response.result) {
          sound.finish();
          renderResults(response.result);
          return;
        }
        const nextQuestion = response.nextQuestion || response.question;
        if (!nextQuestion) {
          renderError("The Agent lost the next question. Please restart the round.");
          return;
        }
        state.currentIndex += 1;
        renderQuestion(nextQuestion);
      }, config.feedbackDelayMs);
    } catch (error) {
      renderError(error.message || "Could not submit that answer.");
    }
  }

  function showFeedback(response, choice) {
    const isCorrect = Boolean(response.isCorrect);
    elements.feedbackPanel.classList.toggle("is-wrong", !isCorrect);
    elements.feedbackIcon.textContent = isCorrect ? "✓" : choice === "timeout" ? "⏱" : "✕";
    elements.feedbackKicker.textContent = isCorrect ? "CORRECT" : choice === "timeout" ? "TIME'S UP" : "NOT QUITE";
    if (isCorrect) {
      elements.feedbackTitle.textContent = choice === "agent" ? "No developer harmed." : "Human correctly summoned.";
      sound.correct();
    } else {
      elements.feedbackTitle.textContent = choice === "timeout"
        ? "A developer felt a disturbance."
        : choice === "dev" ? "Unnecessary ping!" : "The Agent needs backup!";
      sound.wrong();
    }
    elements.feedbackMessage.textContent = response.feedback || (isCorrect ? "Good call." : "Choose based on whether this is investigation or engineering work.");
    elements.feedbackPanel.hidden = false;
  }

  function normalizeResult(raw) {
    return {
      playerName: raw.playerName || state.playerName,
      teamName: raw.teamName || state.teamName,
      correctAnswers: Number(raw.correctAnswers ?? raw.totalCorrect ?? raw.score ?? 0),
      questionCount: Number(raw.questionCount ?? state.questionCount),
      durationMs: Number(raw.durationMs ?? raw.totalDurationMs ?? 0),
      interruptionsAvoided: Number(raw.interruptionsAvoided ?? 0),
      timeSavedMinutes: Number(raw.timeSavedMinutes ?? 0),
      rankTitle: raw.rankTitle || ""
    };
  }

  function renderResults(rawResult) {
    cancelTimer();
    elements.feedbackPanel.hidden = true;
    state.phase = "results";
    const result = normalizeResult(rawResult || {});
    const rank = rankForScore(result.correctAnswers, result.questionCount);
    elements.scoreValue.textContent = String(result.correctAnswers);
    elements.scoreTotal.textContent = String(result.questionCount);
    elements.rankEmoji.textContent = rank.emoji;
    elements.rankTitle.textContent = result.rankTitle || rank.title;
    elements.rankMessage.textContent = rank.message;
    elements.interruptionsMetric.textContent = String(result.interruptionsAvoided);
    elements.timeMetric.textContent = `~${Math.round(result.timeSavedMinutes)}`;
    elements.contextMetric.textContent = String(result.interruptionsAvoided);
    const seconds = result.durationMs ? (result.durationMs / 1000).toFixed(1) : "—";
    elements.resultDetail.textContent = isDemo
      ? `Finished in ${seconds}s · Saved to this device's demo leaderboard`
      : `Finished in ${seconds}s · Official result saved`;
    showScreen(elements.resultsScreen);
  }

  function renderError(message) {
    cancelTimer();
    elements.feedbackPanel.hidden = true;
    state.phase = "error";
    elements.errorMessage.textContent = message;
    showScreen(elements.errorScreen);
  }

  function resetGame() {
    cancelTimer();
    elements.feedbackPanel.hidden = true;
    state.phase = "idle";
    state.sessionId = null;
    state.currentQuestion = null;
    state.currentIndex = 0;
    state.demoQuestions = [];
    state.demoAnswers = [];
    state.answerDurationMs = 0;
    if (!isDemo) {
      elements.playerName.value = "";
      elements.teamName.value = "";
    }
    showScreen(elements.startScreen);
    elements.playerName.focus();
  }

  function updateSoundButton() {
    elements.soundIcon.textContent = sound.enabled ? "🔊" : "🔇";
    elements.soundToggle.setAttribute("aria-label", sound.enabled ? "Turn sound off" : "Turn sound on");
    elements.soundToggle.setAttribute("aria-pressed", String(sound.enabled));
  }

  function init() {
    elements.modeBadge.hidden = !isDemo;
    elements.ruleQuestionCount.textContent = String(config.questionCount);
    elements.ruleSeconds.textContent = String(config.roundSeconds);
    elements.questionTotal.textContent = String(config.questionCount);
    const leaderboardUrl = `leaderboard.html?event=${encodeURIComponent(config.eventId)}`;
    elements.leaderboardLink.href = leaderboardUrl;
    elements.startLeaderboardLink.href = leaderboardUrl;
    elements.playerName.value = readStorage("dpd:last-name") || "";
    elements.teamName.value = readStorage("dpd:last-team") || "";
    elements.playAgainButton.textContent = isDemo ? "PLAY AGAIN" : "NEW PLAYER";
    updateSoundButton();

    elements.playerForm.addEventListener("submit", handleStart);
    choiceButtons.forEach((button) => button.addEventListener("click", () => choose(button.dataset.choice)));
    elements.playAgainButton.addEventListener("click", resetGame);
    elements.retryButton.addEventListener("click", resetGame);
    elements.soundToggle.addEventListener("click", () => {
      sound.toggle();
      updateSoundButton();
    });
    elements.playerName.addEventListener("input", () => { elements.nameError.textContent = ""; });
    document.addEventListener("keydown", (event) => {
      if (state.phase !== "question" || event.repeat) return;
      if (event.key.toLowerCase() === "a") choose("agent");
      if (event.key.toLowerCase() === "d") choose("dev");
    });
  }

  init();
})();
