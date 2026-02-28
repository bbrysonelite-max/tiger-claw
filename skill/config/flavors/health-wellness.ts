// Tiger Claw — Health & Wellness / Personal Services Flavor
// Single-oar: client/patient — TIGERCLAW-MASTER-SPEC-v2.md Block 2.4

import type { FlavorConfig } from "../types.js";

export const HEALTH_WELLNESS_FLAVOR: FlavorConfig = {
  key: "health-wellness",
  displayName: "Health & Wellness",
  description: "Single-oar prospecting engine for health, wellness, and personal service professionals. Finds prospects, nurtures to a booked appointment or service purchase.",

  conversion: {
    oars: ["single"],
    singleConversionGoal: "book an appointment or purchase a service",
  },

  objectionBuckets: [
    {
      key: "effectiveness",
      label: "Does It Actually Work",
      keywords: ["work", "effective", "results", "proof", "evidence", "does it", "really", "testimonial"],
      responseTemplate: [
        `You want to know if it works. Good question — the right one.`,
        ``,
        `{tenantName} has {years} seeing real results with real people. {biggestWin}. The evidence isn't in the marketing — it's in the outcomes. I can share specific examples that match your situation.`,
      ].join("\n"),
      followUpQuestion: `Would hearing from someone with a similar situation who's seen results be useful?`,
    },
    {
      key: "side_effects",
      label: "Safety / Side Effects",
      keywords: ["safe", "side effects", "risk", "harm", "reaction", "allergic", "dangerous", "concern", "natural"],
      responseTemplate: [
        `Safety is the right thing to ask about.`,
        ``,
        `{product} has been through rigorous testing. {tenantName} wouldn't work with something they didn't believe in — {biggestWin}. I can share the clinical data and safety information.`,
      ].join("\n"),
      followUpQuestion: `Is there a specific safety concern I can address directly?`,
    },
    {
      key: "cost",
      label: "Cost / Affordability",
      keywords: ["cost", "price", "expensive", "afford", "worth", "money"],
      responseTemplate: [
        `The cost question.`,
        ``,
        `{tenantName} believes in value over price. {differentiator} The relevant comparison isn't just the cost of {product} — it's the cost of NOT addressing the problem it solves.`,
        ``,
        `{biggestWin}`,
      ].join("\n"),
      followUpQuestion: `If the cost weren't a factor, would you want to move forward?`,
    },
    {
      key: "time_commitment",
      label: "Time Commitment",
      keywords: ["time", "busy", "schedule", "commitment", "regular", "routine", "consistent"],
      responseTemplate: [
        `The time commitment is a real consideration.`,
        ``,
        `{tenantName} will be honest about what's actually required. {differentiator} Most people find it's less than they assumed once they start.`,
      ].join("\n"),
      followUpQuestion: `What does your current schedule look like — can we figure out what's realistic?`,
    },
    {
      key: "provider",
      label: "Already Have a Provider",
      keywords: ["already", "doctor", "current", "have a", "working with", "my therapist", "my physician"],
      responseTemplate: [
        `You're already working with someone. That's not a problem.`,
        ``,
        `{tenantName} isn't here to replace anyone. What they offer is {differentiator}. A lot of people find it complements what they're already doing.`,
      ].join("\n"),
      followUpQuestion: `What would need to be different for you to consider an additional option?`,
    },
    {
      key: "skepticism",
      label: "General Skepticism",
      keywords: ["skeptical", "doubt", "hesitant", "not sure", "heard it before", "tried it"],
      responseTemplate: [
        `Skepticism is healthy. {tenantName} prefers it.`,
        ``,
        `{years} in this field and {biggestWin}. The results are real and verifiable. The skepticism usually disappears after one honest conversation.`,
        ``,
        `{differentiator}`,
      ].join("\n"),
      followUpQuestion: `What would convince you — specifically?`,
    },
  ],

  patternInterrupts: [
    {
      name: "The Doctor's Recommendation",
      moments: ["stall", "pre_takeaway", "general"],
      storyTemplate: [
        `Something worth thinking about.`,
        ``,
        `Most people spend more time researching a restaurant than they do on a health decision. They go with what's familiar, not what's actually best.`,
        ``,
        `{tenantName} has {years} helping people who finally decided to look properly. What they found almost always surprised them.`,
        ``,
        `The question isn't "is this perfect?" It's "is this worth a real look?" Almost always, the answer is yes.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Investment in Self",
      moments: ["stall", "general"],
      storyTemplate: [
        `People will spend hundreds on a weekend trip without thinking twice. But when it comes to their own health, they hesitate.`,
        ``,
        `{tenantName} sees this all the time. The hesitation makes sense — it's new, it's uncertain. But the cost of staying where you are is usually higher than the cost of trying something different.`,
        ``,
        `What would it be worth to feel better? Not perfectly — just meaningfully better.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
  ],

  onboarding: {
    identityQuestions: [
      { key: "name", question: "What's your name?", required: true },
      { key: "productOrOpportunity", question: "What service or product do you offer?", required: true },
      { key: "yearsInProfession", question: "How long have you been in health and wellness?", required: true },
      { key: "biggestWin", question: "What's your best client transformation or result?", required: true, hint: "A before-and-after story, a client who achieved something significant." },
      { key: "differentiator", question: "What makes your approach different from others in your field?", required: true },
    ],
    icpSingleQuestions: [
      { key: "idealPerson", question: "Who is your ideal client? Describe them.", required: true },
      { key: "problemFaced", question: "What's the health or wellness challenge they're dealing with right now?", required: true },
    ],
  },

  soul: {
    systemPromptPreamble: [
      `You are a Tiger Claw agent built for a health and wellness professional.`,
      `You serve {tenantName}, who has {years} in the field.`,
      `Their specialty: {productOrOpportunity}.`,
      `Best result: {biggestWin}. What makes them different: {differentiator}.`,
    ].join("\n"),
    toneDirectives: [
      "Warm. Empathetic. Results-focused.",
      "Meet people where they are — health conversations require patience and care.",
      "Never fear-monger. Never make medical claims.",
      "The goal is to earn a conversation, not to diagnose.",
    ],
    languageDirective: "Respond to your tenant in their preferredLanguage. Generate prospect outreach in the prospect's detected language.",
    neverDoList: [
      "Never make medical diagnoses or treatment claims.",
      "Never guarantee specific health outcomes.",
      "Never pretend to be a human when directly asked.",
      "Never contact someone who has explicitly opted out.",
    ],
  },

  discovery: {
    activeSources: ["facebook_groups", "reddit", "telegram"],
  },
};
