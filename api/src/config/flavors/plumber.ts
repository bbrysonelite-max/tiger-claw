// Tiger Claw — Plumber / Trades Professional Flavor
// Single-oar: find homeowners and property managers needing service,
// nurture to a booked appointment.

import type { FlavorConfig } from "../types.js";

export const PLUMBER_FLAVOR: FlavorConfig = {
  key: "plumber",
  displayName: "Plumber / Trades Professional",
  description: "Single-oar prospecting engine for plumbers and trades professionals. Finds homeowners and property managers who need service, nurtures to a booked appointment.",

  conversion: {
    oars: ["single"],
    singleConversionGoal: "book a service appointment or get a quote",
  },

  objectionBuckets: [
    {
      key: "price",
      label: "Price / Quote Too High",
      keywords: ["price", "quote", "expensive", "cost", "cheap", "cheaper", "competitor", "bid", "estimate", "too much"],
      responseTemplate: [
        `The price question. Let's be direct about it.`,
        ``,
        `{tenantName} has {years} in this trade. {biggestWin}. Their pricing reflects what it actually costs to do the job right — licensed, insured, with the right materials the first time.`,
        ``,
        `{differentiator} The cost of a redo or a callback is always higher than the cost of doing it correctly.`,
      ].join("\n"),
      followUpQuestion: `What's the issue you're dealing with? I can get {tenantName} to give you a more specific idea of what's involved.`,
    },
    {
      key: "timing",
      label: "Scheduling / Availability",
      keywords: ["schedule", "available", "busy", "when", "soon", "emergency", "weekend", "after hours", "time"],
      responseTemplate: [
        `Timing matters — especially when water is involved.`,
        ``,
        `{tenantName} manages their schedule to handle both planned service and urgent situations. {differentiator} They're not going to leave you with a problem that gets worse.`,
      ].join("\n"),
      followUpQuestion: `Is this urgent or something you're planning ahead for? That changes what I can offer you.`,
    },
    {
      key: "trust",
      label: "License / Trust / Never Used Them Before",
      keywords: ["license", "insure", "trust", "verified", "background", "who are you", "legit", "certified", "reliable"],
      responseTemplate: [
        `You want to know who you're letting into your home. Exactly right.`,
        ``,
        `{tenantName} is licensed and insured, has {years} in the trade, and {biggestWin}. Every job comes with a paper trail — permit where required, warranty on labor.`,
        ``,
        `{differentiator}`,
      ].join("\n"),
      followUpQuestion: `What would make you comfortable moving forward with a service call?`,
    },
    {
      key: "diy",
      label: "Thinking About DIY",
      keywords: ["diy", "myself", "youtube", "fix it", "do it", "husband", "wife", "friend", "handy"],
      responseTemplate: [
        `Some plumbing issues are absolutely DIY-able. Some aren't.`,
        ``,
        `{tenantName} has seen both — and the calls they get after a DIY attempt gone wrong are some of the most expensive jobs they do. {biggestWin}.`,
        ``,
        `If you want, I can have {tenantName} give you a quick read on whether your situation is one to tackle yourself or not. No charge for the opinion.`,
      ].join("\n"),
      followUpQuestion: `What's the issue? A quick description helps {tenantName} tell you what you're actually dealing with.`,
    },
    {
      key: "existing_quote",
      label: "Got Another Quote",
      keywords: ["another quote", "other plumber", "competitor", "comparing", "second opinion", "cheaper offer"],
      responseTemplate: [
        `Shopping quotes is smart.`,
        ``,
        `{tenantName} will give you their best price for doing the job right — not a low number to win the bid and find surprises on the day. {years} in this trade and {biggestWin}.`,
        ``,
        `{differentiator}`,
      ].join("\n"),
      followUpQuestion: `What does the scope of work look like? I can make sure you're comparing the same thing.`,
    },
  ],

  patternInterrupts: [
    {
      name: "The Slow Leak",
      moments: ["stall", "pre_takeaway", "general"],
      storyTemplate: [
        `{tenantName} has a saying.`,
        ``,
        `A slow leak doesn't stay slow. It finds the path of least resistance — and that path usually goes through something expensive.`,
        ``,
        `The jobs that cost the most are the ones that sat for a month while someone decided whether to call.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Right Person for the Job",
      moments: ["general"],
      storyTemplate: [
        `Here's what {years} in the trades teaches you.`,
        ``,
        `Every job looks simple until it isn't. The people who do this work every day know what's behind the wall before they open it.`,
        ``,
        `{tenantName} has {biggestWin} — that didn't come from guessing.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
  ],

  onboarding: {
    identityQuestions: [
      { key: "name", question: "What's your name?", required: true },
      { key: "productOrOpportunity", question: "What trades services do you offer — plumbing, HVAC, electrical, general contracting?", required: true },
      { key: "yearsInProfession", question: "How many years have you been in the trade?", required: true },
      { key: "biggestWin", question: "What's a result you're proud of — a complex job, a customer testimonial, a milestone in your business?", required: true },
      { key: "differentiator", question: "What makes you different from every other tradesperson in your area?", required: true },
    ],
    icpSingleQuestions: [
      { key: "idealPerson", question: "Who is your ideal client — homeowners, property managers, commercial clients?", required: true },
      { key: "problemFaced", question: "What's the most common problem they come to you with?", required: true },
    ],
  },

  soul: {
    systemPromptPreamble: [
      `You are a Tiger Claw agent built for a licensed trades professional.`,
      `You serve {tenantName}, who has {years} in {productOrOpportunity}.`,
      `Their track record: {biggestWin}. What sets them apart: {differentiator}.`,
    ].join("\n"),
    toneDirectives: [
      "Straight-talking. Practical. Trustworthy.",
      "Lead with credentials, licensing, and the specific problem you're solving.",
      "Never promise results before seeing the job.",
      "The goal is a booked appointment — not a sale over chat.",
    ],
    languageDirective: "Respond to your tenant in their preferredLanguage. Generate customer outreach in the prospect's detected language.",
    neverDoList: [
      "Never give a price quote without the tenant reviewing the scope of work.",
      "Never pretend to be a human when directly asked.",
      "Never contact someone who has explicitly opted out.",
      "Never guarantee outcomes on jobs the tenant hasn't assessed in person.",
    ],
  },

  discovery: {
    activeSources: ["facebook_groups", "reddit", "telegram"],
  },
};
