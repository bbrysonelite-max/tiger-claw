// Tiger Claw — Real Estate Agent Flavor
// Single-oar: buyer/seller — TIGERCLAW-MASTER-SPEC-v2.md Block 2.4

import type { FlavorConfig } from "../types.js";

export const REAL_ESTATE_FLAVOR: FlavorConfig = {
  key: "real-estate",
  displayName: "Real Estate Agent",
  description: "Single-oar prospecting engine for real estate agents. Finds buyers and sellers, nurtures to a showing or listing agreement, then connects them with the agent.",

  conversion: {
    oars: ["single"],
    singleConversionGoal: "book a showing or sign a listing agreement",
  },

  objectionBuckets: [
    {
      key: "price",
      label: "Price / Valuation",
      keywords: ["price", "value", "worth", "overpriced", "too high", "low", "valuation", "appraisal"],
      responseTemplate: [
        `The price question. Let's look at it carefully.`,
        ``,
        `{tenantName} has {years} working this market. {biggestWin}. They price based on what the market is actually doing — not what sellers hope it will do.`,
        ``,
        `An overpriced listing sits. A correctly priced listing sells. That difference affects you more than any commission does.`,
      ].join("\n"),
      followUpQuestion: `Would it help to look at what comparable properties have actually sold for recently?`,
    },
    {
      key: "market",
      label: "Market Conditions / Timing",
      keywords: ["market", "timing", "wait", "bubble", "crash", "rates", "interest", "economy"],
      responseTemplate: [
        `The market timing question. It's real.`,
        ``,
        `{tenantName} has been through multiple market cycles over {years} in this business. {differentiator} The people who wait for a "perfect" market often miss the window that was right in front of them.`,
        ``,
        `There are always buyers. There are always sellers. The question is whether the conditions favor your specific situation.`,
      ].join("\n"),
      followUpQuestion: `What would "good timing" look like for you specifically?`,
    },
    {
      key: "agent_fees",
      label: "Agent Fees / Commission",
      keywords: ["commission", "fee", "agent", "realtor", "percentage", "cost"],
      responseTemplate: [
        `The commission question.`,
        ``,
        `Here's how {tenantName} thinks about it: a good agent doesn't cost you money — they make you money. {biggestWin}. The gap between a well-negotiated deal and a poorly-negotiated one is far larger than any commission.`,
        ``,
        `{differentiator}`,
      ].join("\n"),
      followUpQuestion: `Would it help to look at the net difference in what you'd actually walk away with?`,
    },
    {
      key: "timing",
      label: "Not Ready Yet",
      keywords: ["ready", "not yet", "wait", "later", "next year", "not now"],
      responseTemplate: [
        `You're not ready yet — I hear that.`,
        ``,
        `{tenantName} isn't going to push. {years} in this business and they've learned that the right transaction happens when the timing is right for the client.`,
      ].join("\n"),
      followUpQuestion: `What would need to change for the timing to work?`,
    },
    {
      key: "condition",
      label: "Property Condition",
      keywords: ["condition", "repair", "fix", "renovate", "update", "old", "worn", "damage", "as-is"],
      responseTemplate: [
        `The condition concern.`,
        ``,
        `{tenantName} has sold properties in every condition. {biggestWin}. There are always buyers — the question is how to position the property correctly.`,
        ``,
        `{differentiator}`,
      ].join("\n"),
      followUpQuestion: `Would a quick walkthrough to identify the highest-impact improvements be useful?`,
    },
    {
      key: "financing",
      label: "Buyer Financing",
      keywords: ["financing", "mortgage", "loan", "qualify", "credit", "bank", "lender"],
      responseTemplate: [
        `Financing concerns on the buyer's side.`,
        ``,
        `{tenantName} has strong relationships with lenders who move fast. {years} of transactions means they know who to call.`,
      ].join("\n"),
      followUpQuestion: `Would an introduction to a lender {tenantName} works with help clarify your options?`,
    },
    {
      key: "location",
      label: "Location Concerns",
      keywords: ["location", "area", "neighborhood", "street", "city", "school", "commute"],
      responseTemplate: [
        `The location question.`,
        ``,
        `{tenantName} knows this market — {years} in it. {differentiator} Every location has buyers and sellers. The question is positioning.`,
      ].join("\n"),
      followUpQuestion: `What specifically about the location is the concern?`,
    },
  ],

  patternInterrupts: [
    {
      name: "The Empty House",
      moments: ["stall", "pre_takeaway", "general"],
      storyTemplate: [
        `Quick story.`,
        ``,
        `A seller once told {tenantName} they didn't need an agent — they'd sell it themselves. {tenantName} said fine, no problem.`,
        ``,
        `The house sat for six months. By the time they called back, the market had shifted and they accepted 12% less than the original offer.`,
        ``,
        `That difference was real money — not a commission. Real money left on the table.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Market Window",
      moments: ["stall", "general"],
      storyTemplate: [
        `Here's what {tenantName} sees from {years} in the market.`,
        ``,
        `Every person who waited for the "perfect" time either ended up buying/selling at a worse point or never did it at all. The window is now. It's always now for someone.`,
        ``,
        `The question isn't "is the market perfect?" It's "is this the right move for YOU right now?"`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
  ],

  onboarding: {
    identityQuestions: [
      { key: "name", question: "What's your name?", required: true },
      { key: "productOrOpportunity", question: "What market do you specialize in? (City, neighborhoods, property types)", required: true },
      { key: "yearsInProfession", question: "How many years have you been in real estate?", required: true },
      { key: "biggestWin", question: "What's your biggest transaction or proudest result?", required: true, hint: "A record sale, a difficult deal you closed, a client story." },
      { key: "differentiator", question: "What makes you different from other agents in your market?", required: true },
    ],
    icpSingleQuestions: [
      { key: "idealPerson", question: "Describe your ideal client — buyer or seller?", required: true },
      { key: "problemFaced", question: "What's the main challenge your ideal client is facing right now?", required: true },
    ],
  },

  soul: {
    systemPromptPreamble: [
      `You are a Tiger Claw agent built for a real estate professional.`,
      `You serve {tenantName}, who has {years} in the {productOrOpportunity} market.`,
      `Their biggest result: {biggestWin}. What makes them different: {differentiator}.`,
    ].join("\n"),
    toneDirectives: [
      "Professional. Warm. Market-knowledgeable.",
      "Confident but never pushy.",
      "Always reference specific market data when available.",
      "The goal is to earn one conversation, not to close a deal in a message.",
    ],
    languageDirective: "Respond to your tenant in their preferredLanguage. Generate prospect outreach in the prospect's detected language.",
    neverDoList: [
      "Never make specific price guarantees.",
      "Never pretend to be a human when directly asked.",
      "Never contact someone who has explicitly opted out.",
      "Never make representations about specific properties without tenant review.",
    ],
  },

  discovery: {
    activeSources: ["facebook_groups", "reddit", "telegram"],
  },
};
