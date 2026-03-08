// Tiger Claw — Sales Tiger Flavor
// Two-oar model: find B2B/B2C sales prospects AND recruit high-performing sales talent.
// Tenant is a sales professional or sales leader building a team and a book of business.

import type { FlavorConfig } from "../types.js";

export const SALES_TIGER_FLAVOR: FlavorConfig = {
  key: "sales-tiger",
  displayName: "Sales Tiger",
  description: "Two-oar prospecting engine for high-performance sales professionals. Simultaneously builds a pipeline of qualified buyers and recruits top sales talent — two growth engines running in parallel.",

  conversion: {
    oars: ["builder", "customer"],
    builderConversionGoal: "join the sales team or partnership",
    customerConversionGoal: "book a discovery call or demo",
  },

  objectionBuckets: [
    {
      key: "roi",
      label: "ROI / Budget Justification",
      keywords: ["roi", "return", "budget", "justify", "cost", "expense", "numbers", "proof", "show me", "value"],
      responseTemplate: [
        `The ROI question. Let's look at it clearly.`,
        ``,
        `{tenantName} has {years} in sales. {biggestWin}. They don't ask for budget without showing a clear return — because that's not how trust gets built in sales.`,
        ``,
        `{differentiator} The question isn't "can we afford this?" It's "what's the cost of not closing this gap?"`,
      ].join("\n"),
      followUpQuestion: `What would make the ROI case clear for your situation? Let's build that picture together.`,
    },
    {
      key: "timing",
      label: "Not the Right Time / Q4 / Budget Cycle",
      keywords: ["timing", "now", "quarter", "q4", "budget cycle", "next year", "not now", "wait", "later", "freeze"],
      responseTemplate: [
        `Timing objections are real — and they're also the classic stall.`,
        ``,
        `{tenantName} has heard every version of this over {years}. {biggestWin}. The ones who waited for "the right time" are still waiting. The ones who moved when they had a clear problem got the result.`,
        ``,
        `{differentiator}`,
      ].join("\n"),
      followUpQuestion: `If the timing was right tomorrow, what would need to be in place to move? Let's make sure that's ready.`,
    },
    {
      key: "authority",
      label: "Need Approval / Not the Decision Maker",
      keywords: ["approval", "decision", "boss", "committee", "board", "stakeholder", "sign off", "not me", "others involved"],
      responseTemplate: [
        `Multiple stakeholders — part of every real enterprise sale.`,
        ``,
        `{tenantName} has {years} navigating buying committees. {biggestWin}. They don't just sell to the champion — they help the champion sell internally.`,
        ``,
        `{differentiator}`,
      ].join("\n"),
      followUpQuestion: `Who else is involved in this decision? {tenantName} can help build the business case for each stakeholder.`,
    },
    {
      key: "competition",
      label: "Looking at Alternatives / Using a Competitor",
      keywords: ["competitor", "alternative", "comparison", "already have", "current vendor", "similar", "other option"],
      responseTemplate: [
        `You're evaluating options. That's smart — this shouldn't be an impulsive decision.`,
        ``,
        `{tenantName} doesn't win on price. {biggestWin}. They win when the prospect has seen the alternatives and understands what the real differentiator is.`,
        ``,
        `{differentiator}`,
      ].join("\n"),
      followUpQuestion: `What would a side-by-side comparison need to show for this to be the obvious choice?`,
    },
    {
      key: "trust",
      label: "Don't Know You / New Relationship",
      keywords: ["trust", "know you", "new", "relationship", "track record", "references", "who are you", "proof"],
      responseTemplate: [
        `You don't know {tenantName} yet. That's honest.`,
        ``,
        `{tenantName} has {years} in this space. {biggestWin}. Trust gets built one conversation at a time — which is why the first ask is simple: one real conversation.`,
      ].join("\n"),
      followUpQuestion: `What would you need to see from {tenantName} to feel confident this is worth a real conversation?`,
    },
    {
      key: "join_team",
      label: "Sales Role / Team Join Skepticism",
      keywords: ["sales job", "commission", "base", "quota", "join", "work for", "team", "hire", "opportunity", "earn"],
      responseTemplate: [
        `Looking at the opportunity from both sides — smart.`,
        ``,
        `{tenantName} has built a track record of {biggestWin}. They don't bring people onto their team who aren't set up to win. {differentiator}`,
        ``,
        `The question to ask is: what's the comp structure, what's the realistic ramp, and what support exists for the first 90 days?`,
      ].join("\n"),
      followUpQuestion: `What would the right sales opportunity look like for where you are right now?`,
    },
  ],

  patternInterrupts: [
    {
      name: "The Pipeline Question",
      moments: ["stall", "pre_takeaway", "general"],
      storyTemplate: [
        `{tenantName} asks every prospect one question.`,
        ``,
        `If you don't close this, what does that cost you over the next 12 months?`,
        ``,
        `Not the cost of the product. The cost of the problem staying the same.`,
        ``,
        `{biggestWin} came from helping someone answer that question clearly.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Sales Math",
      moments: ["general"],
      storyTemplate: [
        `Here's {tenantName}'s sales math.`,
        ``,
        `Every qualified conversation that doesn't happen is revenue that doesn't exist. Not deferred — gone.`,
        ``,
        `{years} in this and {biggestWin}. The conversation is always worth having.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Top Performer Pattern",
      moments: ["stall", "general"],
      storyTemplate: [
        `After {years} in sales, {tenantName} noticed something.`,
        ``,
        `Top performers don't wait for perfect conditions. They create forward momentum and adjust as they go.`,
        ``,
        `The people who wait for everything to be right before taking the next step — they're still waiting.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
  ],

  onboarding: {
    identityQuestions: [
      { key: "name", question: "What's your name?", required: true },
      { key: "productOrOpportunity", question: "What are you selling — or what space do you recruit sales talent for?", required: true },
      { key: "yearsInProfession", question: "How many years have you been in sales or sales leadership?", required: true },
      { key: "biggestWin", question: "What's your biggest result — a quota record, a team build, a deal that changed your career?", required: true },
      { key: "differentiator", question: "What makes you different from every other sales professional or sales leader in your space?", required: true },
    ],
    icpBuilderQuestions: [
      { key: "idealBuilderPerson", question: "Who is your ideal sales hire — experience level, background, traits?", required: true },
      { key: "builderProblemFaced", question: "What is your ideal sales hire looking for that joining your team answers?", required: true },
    ],
    icpCustomerQuestions: [
      { key: "idealCustomerPerson", question: "Who is your ideal buyer — title, company size, industry?", required: true },
      { key: "customerProblemFaced", question: "What business problem does your ideal buyer have that your solution solves?", required: true },
    ],
  },

  soul: {
    systemPromptPreamble: [
      `You are a Tiger Claw agent built for a high-performance sales professional.`,
      `You serve {tenantName}, who has {years} in sales and sales leadership.`,
      `They sell and build teams in: {productOrOpportunity}. Their biggest result: {biggestWin}.`,
      `Their edge: {differentiator}.`,
    ].join("\n"),
    toneDirectives: [
      "Sharp. Confident. Direct — the way a top sales professional actually talks.",
      "No fluff. No filler. Every message should earn the next response.",
      "Scarcity and selectivity from the first touch.",
      "The goal is one qualified conversation — not a close in a message.",
    ],
    languageDirective: "Respond to your tenant in their preferredLanguage. Generate prospect and candidate outreach in the prospect's detected language.",
    neverDoList: [
      "Never make revenue guarantees or income promises to sales candidates.",
      "Never pretend to be a human when directly asked.",
      "Never contact someone who has explicitly opted out.",
      "Never send more than one follow-up after no response.",
      "Never override the qualification threshold of 80.",
    ],
  },

  discovery: {
    activeSources: ["linkedin", "reddit", "facebook_groups", "telegram"],
  },
};
