(function () {
  "use strict";

  // Exact mirror of the official seven-question set for local demo mode.
  // Production scoring always uses the private answer key in the Edge Function.
  const questions = [
    {
      id: "eligibility-location",
      category: "Find existing logic",
      prompt: "Where is the eligibility logic for this feature implemented?",
      correct: "agent",
      correctFeedback: "Correct. No developer harmed.",
      wrongFeedback: "That was searchable. One developer has been needlessly summoned.",
      timeSavedMinutes: 8
    },
    {
      id: "transaction-rejected",
      category: "Investigate behavior",
      prompt: "Why did transaction 473829 move from Pending to Rejected?",
      correct: "agent",
      correctFeedback: "Correct. The Agent can trace the flow, code, configuration, and relevant data.",
      wrongFeedback: "The Agent should investigate first. Save the developer for the fix.",
      timeSavedMinutes: 12
    },
    {
      id: "spain-limit-change",
      category: "Change behavior",
      prompt: "Customers from Spain need a different limit. Who should change the business logic?",
      correct: "dev",
      correctFeedback: "Correct. That's engineering work.",
      wrongFeedback: "The Agent can explain today's rule, but a developer must change it.",
      timeSavedMinutes: 0
    },
    {
      id: "status-values",
      category: "Explain the system",
      prompt: "What values can this status field have, and what does each one mean?",
      correct: "agent",
      correctFeedback: "Correct. Let the Agent turn code and documentation into a clear answer.",
      wrongFeedback: "A developer is not a human enum dictionary. Ask the Agent.",
      timeSavedMinutes: 7
    },
    {
      id: "production-down",
      category: "Production incident",
      prompt: "Production is down.",
      correct: "dev",
      correctFeedback: "PLEASE ping a developer. Immediately. 😂",
      wrongFeedback: "Nice try, but this is an incident. Wake the humans.",
      timeSavedMinutes: 0
    },
    {
      id: "bank-error-retry",
      category: "Understand configuration",
      prompt: "Is this bank error retried, ignored, or routed for investigation today?",
      correct: "agent",
      correctFeedback: "Correct. The Agent can inspect the current mapping and explain the behavior.",
      wrongFeedback: "Existing configuration is Agent territory. No interruption required.",
      timeSavedMinutes: 10
    },
    {
      id: "callback-owner",
      category: "Trace ownership",
      prompt: "Which service currently validates the callback, and where does it route failures?",
      correct: "agent",
      correctFeedback: "Correct. The Agent can trace ownership and the existing flow.",
      wrongFeedback: "Let the Agent map the flow before pulling a developer out of focus time.",
      timeSavedMinutes: 10
    }
  ];

  window.DPD_QUESTIONS = Object.freeze(questions.map((question) => Object.freeze(question)));
})();
