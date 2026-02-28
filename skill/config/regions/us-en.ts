// Tiger Claw — US Region Config (us-en)
// United States, English — TIGERCLAW-MASTER-SPEC-v2.md Block 2.4
//
// Primary channels: Telegram, WhatsApp
// Discovery sources: Reddit, Facebook Groups, Telegram
// Compliance: CAN-SPAM, TCPA (no unsolicited SMS/calls without prior consent)

import type { RegionalConfig } from "../types.js";

export const US_EN_CONFIG: RegionalConfig = {
  code: "us-en",
  language: "en",
  languageName: "English",
  primaryChannels: ["telegram", "whatsapp"],

  discovery: {
    activeSources: ["reddit", "facebook_groups", "telegram"],
    dailyLeadTarget: 10,
    rateLimitPerSource: 25,
  },

  timingNorms: {
    businessHourStart: 9,
    businessHourEnd: 20,
    preferredContactDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  },

  patternInterrupts: [
    {
      name: "The Airplane Question",
      moments: ["stall", "pre_takeaway", "general"],
      storyTemplate: [
        `Let me ask you something before we go any further.`,
        ``,
        `If someone offered you a million dollars to jump out of an airplane without a parachute, would you do it?`,
        ``,
        `Most people say no immediately. Here's the thing — nobody said the airplane was in the air. It's sitting on the runway.`,
        ``,
        `The lesson: don't say no before you have all the information.`,
        ``,
        `I think there might be some of that happening here. And that's fine — if you've thought it through. But if the no is coming from an incomplete picture, it's worth 10 minutes to complete it.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Roommate Principle",
      moments: ["stall", "general"],
      storyTemplate: [
        `Here's something {tenantName} taught me about this work.`,
        ``,
        `When you first meet someone, you don't lead with "will you be my roommate?" You get to know them first. Then, if it makes sense, you have that conversation.`,
        ``,
        `That's all I'm asking here. Not "will you join?" Just: is this worth one real conversation?`,
        ``,
        `That's a much smaller ask.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The 3-Step System",
      moments: ["general"],
      storyTemplate: [
        `Here's how {tenantName} thinks about referrals:`,
        ``,
        `Step 1: Get the name. Step 2: Call immediately. Step 3: Credit the person who gave it.`,
        ``,
        `The people who do this consistently build something. The ones who don't, don't.`,
        ``,
        `Who's the first name that comes to mind when you think about this?`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
  ],

  complianceNotes: [
    "CAN-SPAM: All messages must include opt-out option on email. Not applicable to direct messaging.",
    "TCPA: No automated calls or SMS to cell phones without prior express written consent.",
    "Agent identifies as AI — not a human. Always. (LOCKED, also a Tiger Claw core rule.)",
    "Negative/opt-out responses result in permanent no-contact flag — no exceptions.",
  ],

  culturalNotes: [
    "US communication norms: direct, time-is-money framing, individual achievement emphasis.",
    "Scarcity and selectivity language resonates well. 'I'm selective about who I work with.'",
    "The AI displacement / economic independence narrative plays well in the US market.",
    "Avoid overly formal or hierarchical language. Warm but not sycophantic.",
  ].join(" "),
};
