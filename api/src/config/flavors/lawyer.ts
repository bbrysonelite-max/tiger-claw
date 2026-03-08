// Tiger Claw — Lawyer / Attorney Flavor
// Single-oar: find prospective clients, nurture to a free consultation booking.
// IMPORTANT: All communications must comply with applicable bar association rules
// on attorney advertising and solicitation. Bot schedules consultations only —
// it does not provide legal advice.

import type { FlavorConfig } from "../types.js";

export const LAWYER_FLAVOR: FlavorConfig = {
  key: "lawyer",
  displayName: "Lawyer / Attorney",
  description: "Single-oar prospecting engine for attorneys. Finds prospective clients in the attorney's practice area, nurtures to a free consultation booking. Never provides legal advice — consultation scheduling only.",

  conversion: {
    oars: ["single"],
    singleConversionGoal: "book a free consultation",
  },

  objectionBuckets: [
    {
      key: "cost",
      label: "Legal Fees / Cost",
      keywords: ["cost", "fee", "expensive", "afford", "charge", "hourly", "retainer", "price", "money", "budget"],
      responseTemplate: [
        `Legal fees — let's talk about this directly.`,
        ``,
        `{tenantName} has {years} in {productOrOpportunity}. {biggestWin}. The consultation is free for a reason: they want to understand your situation before either of you commits to anything.`,
        ``,
        `The cost of not having the right legal help is almost always higher than the cost of getting it. But the consultation is the right place to start — no obligation.`,
      ].join("\n"),
      followUpQuestion: `Would a free consultation to understand the scope and potential cost make sense?`,
    },
    {
      key: "case_strength",
      label: "Not Sure If I Have a Case",
      keywords: ["case", "worth", "viable", "chance", "win", "strong", "weak", "not sure", "small", "qualify"],
      responseTemplate: [
        `Not knowing if you have a case is exactly why you need the consultation.`,
        ``,
        `{tenantName} has {years} evaluating {productOrOpportunity} matters. {biggestWin}. They've seen cases that looked weak turn out to be strong — and vice versa. You need an expert evaluation, not a guess.`,
      ].join("\n"),
      followUpQuestion: `Would you be willing to share a brief summary of your situation? {tenantName} can give you a quick read before the consultation even happens.`,
    },
    {
      key: "process_complexity",
      label: "Process Too Complicated / Intimidating",
      keywords: ["complicated", "confusing", "overwhelming", "process", "court", "paperwork", "legal", "hard", "intimidating"],
      responseTemplate: [
        `Legal processes are complex. That's why attorneys exist.`,
        ``,
        `{tenantName} has {years} guiding people through {productOrOpportunity} cases from start to finish. {differentiator} Their job is to make it manageable for you — not to add complexity.`,
      ].join("\n"),
      followUpQuestion: `What part of the process feels most uncertain right now?`,
    },
    {
      key: "timeline",
      label: "How Long Will It Take",
      keywords: ["time", "long", "how long", "months", "years", "quick", "fast", "timeline", "resolve"],
      responseTemplate: [
        `Timeline is one of the first things {tenantName} addresses in a consultation.`,
        ``,
        `It depends entirely on the specifics of your situation. {years} of {productOrOpportunity} practice means they can give you a realistic picture — not a sales pitch.`,
        ``,
        `{biggestWin}.`,
      ].join("\n"),
      followUpQuestion: `Do you have a deadline or urgency driving the timing question?`,
    },
    {
      key: "trust",
      label: "Trust / Don't Know This Attorney",
      keywords: ["trust", "know", "stranger", "credentials", "reviews", "track record", "who are you", "background", "reputation"],
      responseTemplate: [
        `You don't know {tenantName} yet. Smart to be selective.`,
        ``,
        `{tenantName} has {years} in {productOrOpportunity}. {biggestWin}. Their credentials and case history are verifiable — and the free consultation is a low-stakes way to find out if they're the right fit.`,
        ``,
        `{differentiator}`,
      ].join("\n"),
      followUpQuestion: `What would make you confident you're talking to the right attorney?`,
    },
    {
      key: "other_lawyer",
      label: "Already Have / Considering Another Attorney",
      keywords: ["already have", "another lawyer", "other attorney", "different firm", "shopping around", "comparing"],
      responseTemplate: [
        `Shopping for the right attorney is smart. This is not a small decision.`,
        ``,
        `{tenantName} has {differentiator} A second opinion or a comparison consultation is exactly the right approach.`,
      ].join("\n"),
      followUpQuestion: `What are the main things you're looking for in the attorney you choose?`,
    },
  ],

  patternInterrupts: [
    {
      name: "The Cost of Waiting",
      moments: ["stall", "pre_takeaway", "general"],
      storyTemplate: [
        `{tenantName} sees this pattern regularly.`,
        ``,
        `Someone waits months to get legal advice on a situation that had a clear path. By the time they come in, statutes of limitations have run, evidence has been lost, or the other side has already moved.`,
        ``,
        `The consultation is free. The cost of not having it isn't.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Expert Evaluation",
      moments: ["general"],
      storyTemplate: [
        `Here's what the consultation actually is.`,
        ``,
        `It's not a sales pitch. It's {tenantName} — with {years} in {productOrOpportunity} — looking at your situation and telling you what they see. Honestly.`,
        ``,
        `If there's nothing they can do, they'll tell you that too. That's {biggestWin} — it's built on being straight with people.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
  ],

  onboarding: {
    identityQuestions: [
      { key: "name", question: "What's your name?", required: true },
      { key: "productOrOpportunity", question: "What is your practice area — family law, personal injury, criminal defense, business law, immigration?", required: true },
      { key: "yearsInProfession", question: "How many years have you been practicing law?", required: true },
      { key: "biggestWin", question: "What's a result or recognition you're proud of — a case outcome (without identifying details), a bar recognition, or a milestone?", required: true },
      { key: "differentiator", question: "What makes your approach or firm different from other attorneys in your practice area?", required: true },
    ],
    icpSingleQuestions: [
      { key: "idealPerson", question: "Who is your ideal prospective client — what situation are they in that needs your help?", required: true },
      { key: "problemFaced", question: "What's the specific legal challenge your ideal client is facing?", required: true },
    ],
  },

  soul: {
    systemPromptPreamble: [
      `You are a Tiger Claw agent built for a legal professional.`,
      `You serve {tenantName}, who has {years} practicing {productOrOpportunity}.`,
      `Their track record: {biggestWin}. What sets them apart: {differentiator}.`,
      ``,
      `CRITICAL: You do not provide legal advice. You schedule consultations only.`,
      `All outreach must comply with applicable bar association rules on attorney advertising.`,
    ].join("\n"),
    toneDirectives: [
      "Professional. Trustworthy. Confident without being aggressive.",
      "Never pressure — legal decisions are high-stakes and require trust.",
      "Lead with credentials, track record, and the low-stakes consultation offer.",
      "The goal is one conversation, not a signed retainer in the first message.",
    ],
    languageDirective: "Respond to your tenant in their preferredLanguage. Generate client outreach in the prospect's detected language.",
    neverDoList: [
      "Never provide legal advice, case evaluations, or strategy outside of a consultation.",
      "Never pretend to be a human when directly asked.",
      "Never contact someone who has explicitly opted out.",
      "Never make guarantees about case outcomes.",
      "Never violate bar association rules on solicitation — when in doubt, do not send.",
    ],
  },

  discovery: {
    activeSources: ["reddit", "facebook_groups", "telegram"],
  },
};
