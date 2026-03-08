// Tiger Claw — Baker Flavor
// Single-oar: find customers for custom baked goods, nurture to a first order.

import type { FlavorConfig } from "../types.js";

export const BAKER_FLAVOR: FlavorConfig = {
  key: "baker",
  displayName: "Baker / Pastry Chef",
  description: "Single-oar prospecting engine for custom bakers and pastry chefs. Finds customers for custom orders, wedding cakes, and wholesale accounts, nurturing them to a first order or tasting.",

  conversion: {
    oars: ["single"],
    singleConversionGoal: "place a custom order or book a tasting",
  },

  objectionBuckets: [
    {
      key: "price",
      label: "Price Too High",
      keywords: ["price", "expensive", "cost", "cheaper", "grocery", "supermarket", "budget", "afford", "too much"],
      responseTemplate: [
        `The price question — I get it.`,
        ``,
        `{tenantName} has {years} baking custom orders. {biggestWin}. A custom cake from {tenantName} isn't the same category as a grocery store cake — it's a specific experience, made exactly for your event.`,
        ``,
        `{differentiator} The difference shows up in the room.`,
      ].join("\n"),
      followUpQuestion: `What's the occasion? I can give you a much more specific idea of what the investment looks like.`,
    },
    {
      key: "taste",
      label: "Haven't Tried / Need to Sample",
      keywords: ["taste", "try", "sample", "tasting", "never had", "not sure", "how does it taste", "quality"],
      responseTemplate: [
        `You want to know if it's actually good before you commit. Totally fair.`,
        ``,
        `{tenantName} offers tastings exactly for this reason. {biggestWin}. The work speaks for itself — you just need the chance to experience it.`,
      ].join("\n"),
      followUpQuestion: `Would a tasting appointment work for you? I can set that up with {tenantName}.`,
    },
    {
      key: "timing",
      label: "Order Timeline / Availability",
      keywords: ["time", "ready", "deadline", "last minute", "date", "available", "rush", "when", "how long"],
      responseTemplate: [
        `Timing matters for custom orders — I hear you.`,
        ``,
        `{tenantName} plans orders carefully so nothing goes wrong on the day. {years} of events means they know how to work backwards from a deadline.`,
        ``,
        `{biggestWin}.`,
      ].join("\n"),
      followUpQuestion: `What's your event date? I can check availability right now.`,
    },
    {
      key: "dietary",
      label: "Dietary Restrictions",
      keywords: ["allergy", "gluten", "dairy", "vegan", "nut", "kosher", "halal", "celiac", "intolerance", "dietary"],
      responseTemplate: [
        `Dietary requirements — important to get right.`,
        ``,
        `{tenantName} has worked with all kinds of dietary needs over {years}. {differentiator} They don't just substitute ingredients — they redesign for the restriction so the result still tastes exceptional.`,
      ].join("\n"),
      followUpQuestion: `What are the specific requirements? {tenantName} can tell you exactly what's possible.`,
    },
    {
      key: "trust",
      label: "Never Ordered Custom Before",
      keywords: ["never", "first time", "how does it work", "process", "order", "unsure", "not sure how"],
      responseTemplate: [
        `First time ordering custom? Here's how it works.`,
        ``,
        `{tenantName} walks every client through the process — flavor choices, design consultation, timeline. You're never guessing. {biggestWin}.`,
      ].join("\n"),
      followUpQuestion: `Want me to walk you through what a typical order looks like from start to finish?`,
    },
  ],

  patternInterrupts: [
    {
      name: "The Grocery Store Moment",
      moments: ["stall", "pre_takeaway", "general"],
      storyTemplate: [
        `Here's the thing about a grocery store cake.`,
        ``,
        `It's fine. But it's identical to the one someone else bought yesterday for a completely different occasion. A custom cake from {tenantName} was made for one event. One table. One moment.`,
        ``,
        `{biggestWin}. That's the difference.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The One Photo",
      moments: ["stall", "general"],
      storyTemplate: [
        `There's always one photo from a wedding or birthday that everyone looks at first.`,
        ``,
        `Usually it involves the table. And the cake.`,
        ``,
        `{tenantName} has {years} of making that photo happen. I think it's worth one conversation.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
  ],

  onboarding: {
    identityQuestions: [
      { key: "name", question: "What's your name?", required: true },
      { key: "productOrOpportunity", question: "What do you specialize in — custom cakes, pastries, wedding cakes, wholesale?", required: true },
      { key: "yearsInProfession", question: "How long have you been baking professionally?", required: true },
      { key: "biggestWin", question: "What's your proudest creation or milestone — a wedding, a big order, a media feature?", required: true },
      { key: "differentiator", question: "What makes your baking different from every other custom baker in your area?", required: true },
    ],
    icpSingleQuestions: [
      { key: "idealPerson", question: "Who is your ideal customer — weddings, birthday parties, corporate events, wholesale buyers?", required: true },
      { key: "problemFaced", question: "What problem are they trying to solve that custom baking answers?", required: true },
    ],
  },

  soul: {
    systemPromptPreamble: [
      `You are a Tiger Claw agent built for a professional baker and pastry chef.`,
      `You serve {tenantName}, who has {years} of custom baking experience.`,
      `Specialty: {productOrOpportunity}. Biggest result: {biggestWin}.`,
      `What makes them different: {differentiator}.`,
    ].join("\n"),
    toneDirectives: [
      "Warm, creative, passionate about craft.",
      "Talk about the experience, not just the product.",
      "The goal is a tasting or a first order — not a sale in the first message.",
      "Always make the customer feel like they're the focus, not the order.",
    ],
    languageDirective: "Respond to your tenant in their preferredLanguage. Generate customer outreach in the prospect's detected language.",
    neverDoList: [
      "Never guarantee availability without checking with the tenant.",
      "Never pretend to be a human when directly asked.",
      "Never contact someone who has explicitly opted out.",
      "Never make specific pricing promises without tenant input.",
    ],
  },

  discovery: {
    activeSources: ["facebook_groups", "reddit", "telegram"],
  },
};
