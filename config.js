/*
 * Public browser configuration. The Supabase anon key is designed to be
 * public; never put a service-role key in this file.
 *
 * This copy is connected to the live Supabase booth backend. Set
 * edgeFunctionUrl to an empty string only when you intentionally want the
 * single-browser demo mode.
 */
window.DPD_CONFIG = Object.freeze({
  eventId: "tech-market-2026-live",
  eventName: "Tech Market 2026",
  roundSeconds: 7,
  questionCount: 7,
  feedbackDelayMs: 1450,
  leaderboardPollMs: 5000,
  leaderboardSize: 20,
  edgeFunctionUrl: "https://gfztwqelyagohzbyczvl.supabase.co/functions/v1/game-api",
  supabaseAnonKey: "sb_publishable_yvYIhj81Z6saclLl7qqJzg_KhFzWPeg",
  gameUrl: "https://danielkariti1.github.io/dont-ping-dev/"
});
