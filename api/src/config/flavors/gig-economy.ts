// Tiger Claw — Gig Economy Flavor
// Single-oar: help others get started earning in the gig economy,
// nurture to a first shift completed or first platform sign-up.

import type { FlavorConfig } from "../types.js";

export const GIG_ECONOMY_FLAVOR: FlavorConfig = {
  key: "gig-economy",
  displayName: "Gig Economy Guide",
  description: "Single-oar prospecting engine for gig economy earners who help others get started. Finds people looking for flexible income, nurtures them to their first platform sign-up or first earning shift.",

  conversion: {
    oars: ["single"],
    singleConversionGoal: "sign up for the platform and complete the first earning opportunity",
  },

  objectionBuckets: [
    {
      key: "income",
      label: "Income Potential / Is It Worth It",
      keywords: ["earn", "income", "money", "worth", "much", "pay", "how much", "profit", "salary", "revenue"],
      responseTemplate: [
        `The earnings question — the right one to start with.`,
        ``,
        `{tenantName} has {years} in the gig economy. {biggestWin}. They're not going to give you a number that doesn't match reality — that's not how trust gets built.`,
        ``,
        `What they can tell you: what a realistic week looks like, what the ceiling is, and what separates the people who earn well from those who don't.`,
      ].join("\n"),
      followUpQuestion: `What income would make this worth your time? That helps me give you a realistic picture.`,
    },
    {
      key: "flexibility",
      label: "Flexibility / Schedule",
      keywords: ["flexible", "schedule", "hours", "when", "time", "commitment", "part-time", "full-time", "nights", "weekends"],
      responseTemplate: [
        `Flexibility is exactly the point.`,
        ``,
        `{tenantName} built {biggestWin} while working {productOrOpportunity} on their own terms. No required hours, no mandatory shifts. You work when it works for you.`,
        ``,
        `{differentiator}`,
      ].join("\n"),
      followUpQuestion: `What does your current schedule look like? I can show you how people fit this into similar situations.`,
    },
    {
      key: "startup",
      label: "Startup Requirements",
      keywords: ["cost", "requirement", "car", "equipment", "start", "need", "phone", "qualify", "background check"],
      responseTemplate: [
        `You want to know what's actually needed to get started. Fair.`,
        ``,
        `{tenantName} has {years} in this and knows exactly what the onboarding process looks like for {productOrOpportunity}. {differentiator} They can walk you through what you need before you sign up a single form.`,
      ].join("\n"),
      followUpQuestion: `What platform or type of gig work are you thinking about? I can get {tenantName} to give you the exact requirements.`,
    },
    {
      key: "competition",
      label: "Too Many Drivers / Workers Already",
      keywords: ["saturated", "competition", "too many", "full", "enough workers", "already", "market"],
      responseTemplate: [
        `Wondering if there's still room — smart question.`,
        ``,
        `{tenantName} has been in {productOrOpportunity} for {years} and is still earning well. {biggestWin}. Demand for gig workers in most markets still outpaces supply during key windows.`,
        ``,
        `{differentiator}`,
      ].join("\n"),
      followUpQuestion: `What's your market? {tenantName} can tell you what the demand looks like where you are.`,
    },
    {
      key: "stability",
      label: "Is It Stable / Consistent",
      keywords: ["stable", "consistent", "reliable", "guaranteed", "steady", "depend", "fluctuate"],
      responseTemplate: [
        `Gig income isn't a salary — that's honest.`,
        ``,
        `What it is: predictable once you understand the patterns. {tenantName} has {years} of data on when demand peaks and how to position yourself for consistent earnings.`,
        ``,
        `{biggestWin}. That came from understanding the system.`,
      ].join("\n"),
      followUpQuestion: `How would you use extra income if it was consistent? That helps clarify whether the math works for your situation.`,
    },
  ],

  patternInterrupts: [
    {
      name: "The First Shift",
      moments: ["stall", "pre_takeaway", "general"],
      storyTemplate: [
        `{tenantName} remembers the first shift.`,
        ``,
        `Not knowing how it would go. Not sure if it was worth it. Then it was over, and the money was in the account.`,
        ``,
        `Everything that came after — {biggestWin} — started from deciding to try one shift instead of thinking about it indefinitely.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Side Income Calculation",
      moments: ["general"],
      storyTemplate: [
        `Here's a simple question.`,
        ``,
        `If you put in 8 hours on a weekend doing {productOrOpportunity}, and walked away with real money — would that change anything about your week?`,
        ``,
        `{tenantName} made that calculation once. {biggestWin}. It wasn't complicated math.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
  ],

  onboarding: {
    identityQuestions: [
      { key: "name", question: "What's your name?", required: true },
      { key: "productOrOpportunity", question: "What platform or type of gig work do you specialize in — rideshare, delivery, freelance, TaskRabbit?", required: true },
      { key: "yearsInProfession", question: "How long have you been earning in the gig economy?", required: true },
      { key: "biggestWin", question: "What's your best result — a monthly earnings record, a milestone, something that proves it works?", required: true },
      { key: "differentiator", question: "What do you know about succeeding in gig work that most people starting out don't?", required: true },
    ],
    icpSingleQuestions: [
      { key: "idealPerson", question: "Who is your ideal person to help get started — someone between jobs, a stay-at-home parent, a student?", required: true },
      { key: "problemFaced", question: "What's the main problem they're trying to solve with gig income?", required: true },
    ],
  },

  soul: {
    systemPromptPreamble: [
      `You are a Tiger Claw agent built for an experienced gig economy earner.`,
      `You serve {tenantName}, who has {years} earning in {productOrOpportunity}.`,
      `Their result: {biggestWin}. Their edge: {differentiator}.`,
    ].join("\n"),
    toneDirectives: [
      "Straight-talking. Real. No hype.",
      "Treat prospects like adults who can handle accurate income expectations.",
      "The goal is getting them started — not overselling.",
      "Share the practical reality, not the best-case scenario.",
    ],
    languageDirective: "Respond to your tenant in their preferredLanguage. Generate prospect outreach in the prospect's detected language.",
    neverDoList: [
      "Never guarantee specific income amounts.",
      "Never pretend to be a human when directly asked.",
      "Never contact someone who has explicitly opted out.",
      "Never oversell flexibility or income potential beyond what {tenantName} has verified.",
    ],
  },

  discovery: {
    activeSources: ["facebook_groups", "reddit", "telegram"],
  },
};
