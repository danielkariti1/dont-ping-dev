import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type Choice = "agent" | "dev" | "timeout";

type Question = {
  id: string;
  category: string;
  prompt: string;
  answer: Exclude<Choice, "timeout">;
  correctFeedback: string;
  wrongFeedback: string;
  timeSavedMinutes: number;
};

type SessionRow = {
  id: string;
  event_id: string;
  player_name: string;
  team_name: string | null;
  question_order: string[];
  current_index: number;
  correct_answers: number;
  interruptions_avoided: number;
  time_saved_minutes: number;
  status: "active" | "completed";
  rank_title: string | null;
  duration_ms: number | null;
  completed_at: string | null;
};

type RecordedAnswer = {
  out_was_duplicate: boolean;
  out_answer_correct: boolean;
  out_response_ms: number;
  out_session_status: "active" | "completed";
  out_current_index: number;
  out_correct_answers: number;
  out_interruptions_avoided: number;
  out_time_saved_minutes: number;
  out_duration_ms: number | null;
  out_rank_title: string | null;
  out_completed_at: string | null;
};

// This is the complete official set. Every participant receives these same seven
// questions; only their order changes. Correct choices never go to the browser
// until that specific answer has been recorded.
export const QUESTIONS: readonly Question[] = Object.freeze([
  {
    id: "eligibility-location",
    category: "Find existing logic",
    prompt: "Where is the eligibility logic for this feature implemented?",
    answer: "agent",
    correctFeedback: "Correct. No developer harmed.",
    wrongFeedback: "That was searchable. One developer has been needlessly summoned.",
    timeSavedMinutes: 8,
  },
  {
    id: "transaction-rejected",
    category: "Investigate behavior",
    prompt: "Why did transaction 473829 move from Pending to Rejected?",
    answer: "agent",
    correctFeedback: "Correct. The Agent can trace the flow, code, configuration, and relevant data.",
    wrongFeedback: "The Agent should investigate first. Save the developer for the fix.",
    timeSavedMinutes: 12,
  },
  {
    id: "spain-limit-change",
    category: "Change behavior",
    prompt: "Customers from Spain need a different limit. Who should change the business logic?",
    answer: "dev",
    correctFeedback: "Correct. That's engineering work.",
    wrongFeedback: "The Agent can explain today's rule, but a developer must change it.",
    timeSavedMinutes: 0,
  },
  {
    id: "status-values",
    category: "Explain the system",
    prompt: "What values can this status field have, and what does each one mean?",
    answer: "agent",
    correctFeedback: "Correct. Let the Agent turn code and documentation into a clear answer.",
    wrongFeedback: "A developer is not a human enum dictionary. Ask the Agent.",
    timeSavedMinutes: 7,
  },
  {
    id: "production-down",
    category: "Production incident",
    prompt: "Production is down.",
    answer: "dev",
    correctFeedback: "PLEASE ping a developer. Immediately. 😂",
    wrongFeedback: "Nice try, but this is an incident. Wake the humans.",
    timeSavedMinutes: 0,
  },
  {
    id: "bank-error-retry",
    category: "Understand configuration",
    prompt: "Is this bank error retried, ignored, or routed for investigation today?",
    answer: "agent",
    correctFeedback: "Correct. The Agent can inspect the current mapping and explain the behavior.",
    wrongFeedback: "Existing configuration is Agent territory. No interruption required.",
    timeSavedMinutes: 10,
  },
  {
    id: "callback-owner",
    category: "Trace ownership",
    prompt: "Which service currently validates the callback, and where does it route failures?",
    answer: "agent",
    correctFeedback: "Correct. The Agent can trace ownership and the existing flow.",
    wrongFeedback: "Let the Agent map the flow before pulling a developer out of focus time.",
    timeSavedMinutes: 10,
  },
]);

const QUESTION_COUNT = QUESTIONS.length;
const QUESTION_BY_ID = new Map(QUESTIONS.map((question) => [question.id, question]));
const TIME_LIMIT_SECONDS = 10;
const SERVER_DEADLINE_MS = 13_000;
const SESSION_SELECT = [
  "id",
  "event_id",
  "player_name",
  "team_name",
  "question_order",
  "current_index",
  "correct_answers",
  "interruptions_avoided",
  "time_saved_minutes",
  "status",
  "rank_title",
  "duration_ms",
  "completed_at",
].join(",");

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let serviceClient: SupabaseClient | undefined;

function serverKeyFromEnvironment(): string | undefined {
  const secretKeysJson = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysJson) {
    try {
      const secretKeys = JSON.parse(secretKeysJson) as unknown;
      if (secretKeys && typeof secretKeys === "object" && !Array.isArray(secretKeys)) {
        const values = secretKeys as Record<string, unknown>;
        const defaultKey = values.default;
        if (typeof defaultKey === "string" && defaultKey.trim()) return defaultKey.trim();

        const firstKey = Object.values(values).find(
          (value): value is string => typeof value === "string" && Boolean(value.trim()),
        );
        if (firstKey) return firstKey.trim();
      }
    } catch {
      // Do not log the malformed value: it contains secrets. Continue through
      // the compatibility fallbacks and emit only a generic setup error below.
    }
  }

  return Deno.env.get("SUPABASE_SECRET_KEY")?.trim()
    || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
    || undefined;
}

function getServiceClient(): SupabaseClient {
  if (serviceClient) return serviceClient;

  const url = Deno.env.get("SUPABASE_URL");
  // Hosted functions expose SUPABASE_SECRET_KEYS as a JSON dictionary. The
  // singular current key and legacy service-role JWT support other runtimes and
  // existing/local projects.
  const serverKey = serverKeyFromEnvironment();
  if (!url || !serverKey) {
    throw new Error("SUPABASE_URL and a Supabase server secret are required");
  }

  serviceClient = createClient(url, serverKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}

function configuredOrigins(): string[] {
  const raw = Deno.env.get("ALLOWED_ORIGINS")?.trim();
  return raw ? raw.split(",").map((origin) => origin.trim()).filter(Boolean) : ["*"];
}

function requestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const allowed = configuredOrigins();
  return allowed.includes("*") || allowed.includes(origin);
}

function responseHeaders(request: Request): HeadersInit {
  const origin = request.headers.get("origin");
  const allowed = configuredOrigins();
  const allowOrigin = allowed.includes("*") ? "*" : (origin && allowed.includes(origin) ? origin : "");

  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(request),
  });
}

function cleanLabel(value: unknown, field: string, required: boolean, maxLength = 24): string | null {
  if (value === undefined || value === null) {
    if (required) throw new ApiError(400, `INVALID_${field.toUpperCase()}`, `${field} is required.`);
    return null;
  }
  if (typeof value !== "string") {
    throw new ApiError(400, `INVALID_${field.toUpperCase()}`, `${field} must be text.`);
  }

  const cleaned = value
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\p{M} ._'’()-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned && !required) return null;
  const length = Array.from(cleaned).length;
  const minimum = required ? 2 : 1;
  if (length < minimum || length > maxLength) {
    throw new ApiError(
      400,
      `INVALID_${field.toUpperCase()}`,
      `${field} must be between ${minimum} and ${maxLength} characters after sanitizing.`,
    );
  }
  return cleaned;
}

function cleanEventId(value: unknown): string {
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_EVENT", "eventId is required.");
  }
  const eventId = value.normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(eventId)) {
    throw new ApiError(400, "INVALID_EVENT", "eventId must be 2-40 lowercase letters, numbers, or hyphens.");
  }
  return eventId;
}

function cleanUuid(value: unknown, field: string): string {
  if (typeof value !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ApiError(400, `INVALID_${field.toUpperCase()}`, `${field} is not a valid UUID.`);
  }
  return value.toLowerCase();
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function shuffleQuestionIds(): string[] {
  const ids = QUESTIONS.map((question) => question.id);
  for (let index = ids.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    const swapIndex = random[0] % (index + 1);
    [ids[index], ids[swapIndex]] = [ids[swapIndex], ids[index]];
  }
  return ids;
}

function publicQuestion(questionId: string | undefined) {
  const question = questionId ? QUESTION_BY_ID.get(questionId) : undefined;
  if (!question) throw new Error(`Unknown question in stored session: ${questionId ?? "missing"}`);
  return {
    id: question.id,
    category: question.category,
    prompt: question.prompt,
    timeLimitSeconds: TIME_LIMIT_SECONDS,
  };
}

function sessionResult(session: SessionRow) {
  return {
    correctAnswers: session.correct_answers,
    questionCount: QUESTION_COUNT,
    durationMs: session.duration_ms,
    interruptionsAvoided: session.interruptions_avoided,
    timeSavedMinutes: session.time_saved_minutes,
    rankTitle: session.rank_title,
    completedAt: session.completed_at,
  };
}

async function findSessionByIdentity(
  client: SupabaseClient,
  eventId: string,
  playerKey: string,
): Promise<SessionRow | null> {
  const { data, error } = await client
    .from("game_sessions")
    .select(SESSION_SELECT)
    .eq("event_id", eventId)
    .eq("player_key", playerKey)
    .maybeSingle();

  if (error) throw error;
  return data as SessionRow | null;
}

async function startGame(body: Record<string, unknown>) {
  const client = getServiceClient();
  const eventId = cleanEventId(body.eventId);
  const playerName = cleanLabel(body.playerName, "playerName", true)!;
  const teamName = cleanLabel(body.teamName, "teamName", false, 32);
  const playerKey = await sha256(`${playerName.toLocaleLowerCase()}\u0000${(teamName ?? "").toLocaleLowerCase()}`);

  let session = await findSessionByIdentity(client, eventId, playerKey);
  let resumed = Boolean(session);

  if (!session) {
    const { data, error } = await client
      .from("game_sessions")
      .insert({
        event_id: eventId,
        player_name: playerName,
        team_name: teamName,
        player_key: playerKey,
        question_order: shuffleQuestionIds(),
      })
      .select(SESSION_SELECT)
      .single();

    if (error?.code === "23505") {
      session = await findSessionByIdentity(client, eventId, playerKey);
      resumed = true;
    } else if (error) {
      throw error;
    } else {
      session = data as SessionRow;
    }
  }

  if (!session) throw new Error("Could not create or recover the game session");

  if (session.status === "completed") {
    return {
      sessionId: session.id,
      questionCount: QUESTION_COUNT,
      question: null,
      answeredCount: QUESTION_COUNT,
      resumed: true,
      completed: true,
      result: sessionResult(session),
    };
  }

  return {
    sessionId: session.id,
    questionCount: QUESTION_COUNT,
    question: publicQuestion(session.question_order[session.current_index]),
    answeredCount: session.current_index,
    questionNumber: session.current_index + 1,
    resumed,
    completed: false,
  };
}

function feedbackFor(question: Question, choice: Choice, isCorrect: boolean, timedOut: boolean): string {
  if (choice === "timeout" || timedOut) {
    return "Time's up. Somewhere, a developer felt a disturbance in the Force.";
  }
  return isCorrect ? question.correctFeedback : question.wrongFeedback;
}

function mapRpcError(error: { message?: string }): never {
  const message = error.message ?? "";
  if (message.includes("SESSION_NOT_FOUND")) {
    throw new ApiError(404, "SESSION_NOT_FOUND", "This game session no longer exists.");
  }
  if (message.includes("ANSWER_CONFLICT")) {
    throw new ApiError(409, "ANSWER_CONFLICT", "That question was already answered differently.");
  }
  if (message.includes("SESSION_ALREADY_COMPLETED")) {
    throw new ApiError(409, "SESSION_COMPLETED", "This attempt is already complete.");
  }
  if (message.includes("QUESTION_OUT_OF_SEQUENCE")) {
    throw new ApiError(409, "QUESTION_OUT_OF_SEQUENCE", "Please answer the current question first.");
  }
  throw error;
}

async function answerQuestion(body: Record<string, unknown>) {
  const client = getServiceClient();
  const sessionId = cleanUuid(body.sessionId, "sessionId");
  if (typeof body.questionId !== "string" || !QUESTION_BY_ID.has(body.questionId)) {
    throw new ApiError(400, "INVALID_QUESTION", "questionId is not part of this game.");
  }
  if (body.choice !== "agent" && body.choice !== "dev" && body.choice !== "timeout") {
    throw new ApiError(400, "INVALID_CHOICE", "choice must be agent, dev, or timeout.");
  }

  const questionId = body.questionId;
  const choice = body.choice as Choice;
  const question = QUESTION_BY_ID.get(questionId)!;
  const isCorrect = choice !== "timeout" && choice === question.answer;
  const interruptionAvoided = isCorrect && question.answer === "agent" ? 1 : 0;
  const timeSavedMinutes = interruptionAvoided ? question.timeSavedMinutes : 0;

  const { data: sessionData, error: sessionError } = await client
    .from("game_sessions")
    .select(SESSION_SELECT)
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!sessionData) throw new ApiError(404, "SESSION_NOT_FOUND", "This game session no longer exists.");
  const session = sessionData as SessionRow;

  const { data, error } = await client.rpc("record_game_answer", {
    p_session_id: sessionId,
    p_question_id: questionId,
    p_choice: choice,
    p_is_correct: isCorrect,
    p_interruption_avoided: interruptionAvoided,
    p_time_saved_minutes: timeSavedMinutes,
  }).single();
  if (error) mapRpcError(error);

  const recorded = data as RecordedAnswer;
  const effectiveIsCorrect = recorded.out_answer_correct;
  const serverTimedOut = choice !== "timeout" && recorded.out_response_ms > SERVER_DEADLINE_MS;
  const completed = recorded.out_session_status === "completed";
  const result = completed
    ? {
      correctAnswers: recorded.out_correct_answers,
      questionCount: QUESTION_COUNT,
      durationMs: recorded.out_duration_ms,
      interruptionsAvoided: recorded.out_interruptions_avoided,
      timeSavedMinutes: recorded.out_time_saved_minutes,
      rankTitle: recorded.out_rank_title,
      completedAt: recorded.out_completed_at,
    }
    : undefined;
  const nextQuestionId = completed ? undefined : session.question_order[recorded.out_current_index];

  return {
    isCorrect: effectiveIsCorrect,
    timedOut: choice === "timeout" || serverTimedOut,
    correctChoice: question.answer,
    feedback: feedbackFor(question, choice, effectiveIsCorrect, serverTimedOut),
    completed,
    duplicate: recorded.out_was_duplicate,
    answeredCount: recorded.out_current_index,
    questionNumber: completed ? QUESTION_COUNT : recorded.out_current_index + 1,
    ...(nextQuestionId ? { nextQuestion: publicQuestion(nextQuestionId) } : {}),
    ...(result ? { result } : {}),
  };
}

async function leaderboard(body: Record<string, unknown>) {
  const client = getServiceClient();
  const eventId = cleanEventId(body.eventId);
  const requestedLimit = typeof body.limit === "number" && Number.isFinite(body.limit)
    ? Math.trunc(body.limit)
    : 20;
  const limit = Math.max(1, Math.min(100, requestedLimit));

  const { data, error } = await client
    .from("game_sessions")
    .select(
      "player_name,team_name,correct_answers,duration_ms,interruptions_avoided,time_saved_minutes,rank_title,completed_at",
    )
    .eq("event_id", eventId)
    .eq("status", "completed")
    .order("correct_answers", { ascending: false })
    .order("duration_ms", { ascending: true })
    .order("completed_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  const entries = (data ?? []).map((row, index) => ({
    rank: index + 1,
    playerName: row.player_name,
    teamName: row.team_name,
    correctAnswers: row.correct_answers,
    questionCount: QUESTION_COUNT,
    durationMs: row.duration_ms,
    interruptionsAvoided: row.interruptions_avoided,
    timeSavedMinutes: row.time_saved_minutes,
    rankTitle: row.rank_title,
    completedAt: row.completed_at,
  }));

  return { eventId, entries, updatedAt: new Date().toISOString() };
}

function clientAddress(request: Request): string {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "unknown";
}

async function enforceRateLimit(request: Request, action: string, eventId: unknown): Promise<void> {
  const limits: Record<string, number> = {
    start: 240,
    answer: 3000,
    leaderboard: 600,
  };
  const limit = limits[action] ?? 120;
  const eventPart = typeof eventId === "string" ? eventId.slice(0, 40).toLowerCase() : "unknown";
  const bucketKey = await sha256(`${clientAddress(request)}\u0000${eventPart}\u0000${action}`);
  const { data, error } = await getServiceClient().rpc("consume_game_rate_limit", {
    p_bucket_key: bucketKey,
    p_limit: limit,
    p_window_seconds: 60,
  });
  if (error) throw error;
  if (data !== true) {
    throw new ApiError(429, "RATE_LIMITED", "Too many requests. Please wait a moment and try again.");
  }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const maximumBytes = 8192;
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > maximumBytes) {
    throw new ApiError(413, "BODY_TOO_LARGE", "Request body is too large.");
  }

  try {
    if (!request.body) throw new Error("missing body");
    const reader = request.body.getReader();
    const decoder = new TextDecoder();
    let bytesRead = 0;
    let source = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maximumBytes) {
        await reader.cancel();
        throw new ApiError(413, "BODY_TOO_LARGE", "Request body is too large.");
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();

    const body = JSON.parse(source);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "INVALID_JSON", "A JSON request body is required.");
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    if (!requestOriginAllowed(request)) return json(request, { error: "Origin not allowed", code: "ORIGIN_DENIED" }, 403);
    return new Response(null, { status: 204, headers: responseHeaders(request) });
  }

  if (!requestOriginAllowed(request)) {
    return json(request, { error: "Origin not allowed", code: "ORIGIN_DENIED" }, 403);
  }

  try {
    if (request.method === "GET") {
      const url = new URL(request.url);
      const action = url.searchParams.get("action") ?? "health";
      if (action === "health") {
        return json(request, { ok: true, service: "dont-ping-dev-game-api", questionCount: QUESTION_COUNT });
      }
      if (action !== "leaderboard") {
        throw new ApiError(400, "UNKNOWN_ACTION", "Unknown action.");
      }
      const body = {
        eventId: url.searchParams.get("eventId"),
        limit: Number(url.searchParams.get("limit") ?? "20"),
      };
      await enforceRateLimit(request, action, body.eventId);
      return json(request, await leaderboard(body));
    }

    if (request.method !== "POST") {
      throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET, POST, or OPTIONS.");
    }

    const body = await readJsonBody(request);
    const action = body.action;
    if (action !== "start" && action !== "answer" && action !== "leaderboard") {
      throw new ApiError(400, "UNKNOWN_ACTION", "action must be start, answer, or leaderboard.");
    }

    await enforceRateLimit(request, action, body.eventId);
    if (action === "start") return json(request, await startGame(body), 201);
    if (action === "answer") return json(request, await answerQuestion(body));
    return json(request, await leaderboard(body));
  } catch (error) {
    if (error instanceof ApiError) {
      return json(request, { error: error.message, code: error.code }, error.status);
    }
    console.error("game-api failure", error);
    return json(request, { error: "The game server had a problem. Please try again.", code: "SERVER_ERROR" }, 500);
  }
});
