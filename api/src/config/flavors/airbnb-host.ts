// Tiger Claw — Airbnb Host Flavor
// Single-oar: find guests and co-hosts, nurture to a booking or co-host agreement.

import type { FlavorConfig } from "../types.js";

export const AIRBNB_HOST_FLAVOR: FlavorConfig = {
  key: "airbnb-host",
  displayName: "Airbnb Host",
  description: "Single-oar prospecting engine for short-term rental hosts. Finds guests and co-host partners, nurtures to a booking inquiry or co-host agreement.",

  conversion: {
    oars: ["single"],
    singleConversionGoal: "book a stay or start a co-host conversation",
  },

  objectionBuckets: [
    {
      key: "price",
      label: "Nightly Rate Too High",
      keywords: ["price", "expensive", "cost", "rate", "cheaper", "discount", "afford", "budget"],
      responseTemplate: [
        `The rate question — let's talk about it.`,
        ``,
        `{tenantName} has {years} in short-term rentals. {biggestWin}. Their pricing reflects what the market is actually bearing — not what the listing looks like on paper.`,
        ``,
        `{differentiator} Value isn't just the room. It's the experience, the location, the host.`,
      ].join("\n"),
      followUpQuestion: `What dates are you looking at? I can see if there's flexibility.`,
    },
    {
      key: "competition",
      label: "Too Many Listings",
      keywords: ["competition", "other listings", "alternatives", "similar", "options", "other places"],
      responseTemplate: [
        `There are other listings. That's true.`,
        ``,
        `{tenantName}'s {biggestWin}. They're selective about who they host — because the right guest and the right property create the right experience.`,
        ``,
        `{differentiator}`,
      ].join("\n"),
      followUpQuestion: `What specifically are you looking for that you haven't found yet?`,
    },
    {
      key: "availability",
      label: "Availability / Dates",
      keywords: ["available", "dates", "when", "open", "booking", "calendar", "flexible"],
      responseTemplate: [
        `The availability question.`,
        ``,
        `{tenantName} manages their calendar carefully — they don't overbook and they don't rush turnarounds. That's part of why their reviews look the way they do.`,
        ``,
        `{biggestWin}.`,
      ].join("\n"),
      followUpQuestion: `What dates work for you? Let me check.`,
    },
    {
      key: "trust",
      label: "Trust / Never Stayed Airbnb Before",
      keywords: ["trust", "safe", "legit", "real", "airbnb", "first time", "reviews", "verified"],
      responseTemplate: [
        `First time using Airbnb or just first time with this property? Either way, fair concern.`,
        ``,
        `{tenantName} has {years} of hosting experience and a track record of reviews that speaks for itself. {biggestWin}.`,
      ].join("\n"),
      followUpQuestion: `What would make you feel completely comfortable booking?`,
    },
    {
      key: "cohost_skepticism",
      label: "Co-Host / Partnership Skepticism",
      keywords: ["co-host", "partner", "manage", "split", "share", "fee", "percentage", "how does it work"],
      responseTemplate: [
        `The co-host question. Smart to look into this carefully.`,
        ``,
        `{tenantName} has been co-hosting for {years}. {biggestWin}. They're not taking on properties they can't run well — so they're selective about which partnerships they take on.`,
        ``,
        `{differentiator}`,
      ].join("\n"),
      followUpQuestion: `Do you have a property you're thinking about listing? I can pass the details to {tenantName}.`,
    },
  ],

  patternInterrupts: [
    {
      name: "The Empty Bedroom",
      moments: ["stall", "general"],
      storyTemplate: [
        `Quick thought.`,
        ``,
        `Every night a property sits empty is a night of income that doesn't come back. {tenantName} learned this when they first started. {biggestWin}.`,
        ``,
        `The question isn't "is this perfect?" It's "is this the right move to stop leaving money on the table?"`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Right Guest",
      moments: ["stall", "pre_takeaway", "general"],
      storyTemplate: [
        `Here's something {tenantName} always says.`,
        ``,
        `Not every guest is the right guest. Not every property is the right property. But when it's right — it's a completely different experience than anything a hotel offers.`,
        ``,
        `I think you might be the right fit. But you'd have to take one step to find out.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
  ],

  onboarding: {
    identityQuestions: [
      { key: "name", question: "What's your name?", required: true },
      { key: "productOrOpportunity", question: "Tell me about your property — where is it and what makes it special?", required: true },
      { key: "yearsInProfession", question: "How long have you been hosting?", required: true },
      { key: "biggestWin", question: "What's your best hosting result — a great review, occupancy record, or milestone?", required: true },
      { key: "differentiator", question: "What makes your property and hosting style different from every other listing in your area?", required: true },
    ],
    icpSingleQuestions: [
      { key: "idealPerson", question: "Who is your ideal guest — or co-host partner if that's what you're looking for?", required: true },
      { key: "problemFaced", question: "What's the main thing they're trying to solve that your property or co-host arrangement answers?", required: true },
    ],
  },

  soul: {
    systemPromptPreamble: [
      `You are a Tiger Claw agent built for a short-term rental host.`,
      `You serve {tenantName}, who has {years} of Airbnb and short-term rental experience.`,
      `Their property: {productOrOpportunity}. Their biggest result: {biggestWin}.`,
      `What makes them different: {differentiator}.`,
    ].join("\n"),
    toneDirectives: [
      "Warm. Genuine. Helpful — not salesy.",
      "You're matching people to a great experience, not selling them something they don't want.",
      "Lead with the property's strengths and the host's track record.",
      "Earn trust first. The booking follows.",
    ],
    languageDirective: "Respond to your tenant in their preferredLanguage. Generate guest outreach in the prospect's detected language.",
    neverDoList: [
      "Never guarantee specific availability without checking with the tenant.",
      "Never pretend to be a human when directly asked.",
      "Never contact someone who has explicitly opted out.",
      "Never overpromise on amenities or features.",
    ],
  },

  discovery: {
    activeSources: ["facebook_groups", "reddit", "telegram"],
  },
};
