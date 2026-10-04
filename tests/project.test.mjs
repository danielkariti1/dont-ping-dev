import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function loadBrowserGlobal(relativePath, globalName) {
  const context = vm.createContext({ window: {} });
  vm.runInContext(read(relativePath), context, { filename: relativePath });
  return context.window[globalName];
}

function loadBackendQuestions() {
  const source = read("supabase/functions/game-api/index.ts");
  const match = source.match(
    /export const QUESTIONS[^=]*=\s*Object\.freeze\((\[[\s\S]*?\])\s*\);/,
  );
  assert.ok(match, "Could not find the exported backend QUESTIONS array");
  return vm.runInNewContext(`(${match[1]})`, {}, { filename: "game-api/index.ts#QUESTIONS" });
}

test("the public app has all required entry points", () => {
  for (const relativePath of [
    "index.html",
    "leaderboard.html",
    "favicon.svg",
    "styles.css",
    "config.js",
    "questions.js",
    "app.js",
    "leaderboard.js",
  ]) {
    assert.ok(existsSync(path.join(projectRoot, relativePath)), `Missing ${relativePath}`);
  }
});

test("all local HTML references resolve", () => {
  const htmlFiles = ["index.html", "leaderboard.html"];
  const attributePattern = /\b(?:href|src)=["']([^"']+)["']/gi;

  for (const htmlFile of htmlFiles) {
    const html = read(htmlFile);
    for (const match of html.matchAll(attributePattern)) {
      const reference = match[1];
      if (
        reference.startsWith("#") ||
        reference.startsWith("data:") ||
        reference.startsWith("mailto:") ||
        reference.startsWith("tel:") ||
        /^[a-z][a-z\d+.-]*:\/\//i.test(reference)
      ) {
        continue;
      }

      const cleanReference = reference.split(/[?#]/, 1)[0];
      if (!cleanReference) continue;
      const target = path.resolve(projectRoot, path.dirname(htmlFile), cleanReference);
      assert.ok(existsSync(target), `${htmlFile} references missing file ${reference}`);
    }
  }
});

test("the global hidden attribute always removes inactive UI", () => {
  const css = read("styles.css");
  assert.match(
    css,
    /(?:^|})\s*\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important\s*;?[^}]*}/m,
    "styles.css needs a global [hidden] rule that cannot be overridden by component display styles",
  );
});

test("the demo question bank contains one question in each of seven categories", () => {
  const questions = loadBrowserGlobal("questions.js", "DPD_QUESTIONS");
  assert.ok(Array.isArray(questions), "questions.js must expose window.DPD_QUESTIONS");
  assert.equal(questions.length, 7, "Expected one question in each of seven categories");

  const ids = new Set();
  const categoryCounts = new Map();
  const categoryAnswers = new Map();

  for (const question of questions) {
    assert.match(question.id, /^[a-z0-9][a-z0-9-]+$/);
    assert.ok(!ids.has(question.id), `Duplicate question id: ${question.id}`);
    ids.add(question.id);
    assert.ok(question.prompt.length >= 15, `${question.id} needs a useful prompt`);
    assert.ok(question.correctFeedback.length >= 15, `${question.id} needs useful correct feedback`);
    assert.ok(question.wrongFeedback.length >= 15, `${question.id} needs useful wrong feedback`);
    assert.ok(["agent", "dev"].includes(question.correct), `${question.id} has an invalid answer`);
    assert.ok(Number.isInteger(question.timeSavedMinutes));
    assert.ok(question.timeSavedMinutes >= 0 && question.timeSavedMinutes <= 60);

    categoryCounts.set(question.category, (categoryCounts.get(question.category) ?? 0) + 1);
    categoryAnswers.set(question.category, (categoryAnswers.get(question.category) ?? new Set()).add(question.correct));
  }

  assert.equal(categoryCounts.size, 7, "The official round must draw from seven categories");
  for (const [category, count] of categoryCounts) {
    assert.equal(count, 1, `${category} should appear exactly once`);
    assert.equal(categoryAnswers.get(category).size, 1, `${category} variants must agree on the answer`);
  }

  assert.equal(questions.filter((question) => question.correct === "agent").length, 5);
  assert.equal(questions.filter((question) => question.correct === "dev").length, 2);
});

test("browser configuration matches a seven-question round", () => {
  const config = loadBrowserGlobal("config.js", "DPD_CONFIG");
  assert.equal(config.questionCount, 7);
  assert.equal(config.roundSeconds, 7);
  assert.match(config.eventId, /^[a-z0-9][a-z0-9-]{1,39}$/);
  assert.ok(Number.isInteger(config.leaderboardPollMs) && config.leaderboardPollMs >= 1000);
});

test("the authoritative backend has seven balanced questions", () => {
  const questions = loadBackendQuestions();
  assert.equal(questions.length, 7, "Every official session should contain seven questions");
  assert.equal(new Set(questions.map((question) => question.id)).size, 7);
  assert.equal(new Set(questions.map((question) => question.category)).size, 7);
  assert.equal(questions.filter((question) => question.answer === "agent").length, 5);
  assert.equal(questions.filter((question) => question.answer === "dev").length, 2);
});

test("demo and backend answer keys agree for every official question", () => {
  const demoById = new Map(
    loadBrowserGlobal("questions.js", "DPD_QUESTIONS").map((question) => [question.id, question]),
  );

  for (const official of loadBackendQuestions()) {
    const demo = demoById.get(official.id);
    assert.ok(demo, `Demo bank is missing official question ${official.id}`);
    assert.equal(demo.correct, official.answer, `Answer key drift for ${official.id}`);
    assert.equal(demo.prompt, official.prompt, `Prompt drift for ${official.id}`);
    assert.equal(demo.timeSavedMinutes, official.timeSavedMinutes, `Time-saved drift for ${official.id}`);
  }
});

test("database migration blocks direct browser writes", () => {
  const migrationPath = "supabase/migrations/202610040001_create_game_tables.sql";
  assert.ok(existsSync(path.join(projectRoot, migrationPath)), `Missing ${migrationPath}`);
  const originalSql = read(migrationPath);
  const sql = originalSql.toLowerCase();

  assert.match(sql, /create table if not exists public\.game_sessions/);
  assert.match(sql, /create table if not exists public\.game_answers/);
  assert.match(sql, /create table if not exists public\.game_rate_limits/);
  assert.match(sql, /alter table public\.game_sessions enable row level security/);
  assert.match(sql, /alter table public\.game_answers enable row level security/);
  assert.match(sql, /revoke all on table public\.game_sessions from anon, authenticated/);
  assert.match(sql, /revoke all on table public\.game_answers from anon, authenticated/);
  assert.match(sql, /unique \(event_id, player_key\)/);
  assert.match(sql, /create or replace function public\.consume_game_rate_limit/);
  assert.match(sql, /out_rank_title text/);
  assert.match(sql, /v_effective_correct\s*:=\s*p_is_correct\s+and\s+v_response_ms\s*<=\s*10000/);
  for (const title of [
    "Legendary Developer Bodyguard",
    "Developer Protector",
    "Context-Switch Defender",
    "Recovering Pinger",
    "Serial Developer Pinger",
  ]) {
    assert.ok(sql.includes(title.toLowerCase()), `Missing rank title: ${title}`);
  }
  assert.match(
    originalSql,
    /'Authoritative sessions and final scores for the DON''T PING DEV booth game\.'/,
    "The apostrophe in DON'T must be escaped as two SQL quotes",
  );
});

test("the public Edge Function has the expected deployment contract", () => {
  const config = read("supabase/config.toml");
  const source = read("supabase/functions/game-api/index.ts");

  assert.match(config, /\[functions\.game-api\][\s\S]*?verify_jwt\s*=\s*false/);
  assert.match(source, /Deno\.env\.get\("ALLOWED_ORIGINS"\)/);
  assert.match(source, /SUPABASE_SECRET_KEY/);
  assert.match(source, /consume_game_rate_limit/);
  assert.match(source, /action !== "start" && action !== "answer" && action !== "leaderboard"/);
});
