// Tiger Claw — tiger_objection Tool
// Objection handling library with per-flavor buckets — Block 3.6 of TIGERCLAW-MASTER-SPEC-v2.md
//
// LOCKED:
//   Each flavor defines its own objection buckets with pre-built content.
//   Agent matches prospect text → bucket → delivers response.
//   Pattern Interrupt Stories: deployed at stall points, NOT randomly.
//   Flagship: The Airplane Question (network-marketer flavor).
//
// Flavors and their buckets:
//   network-marketer:  compensation | product | time | reputation | trust | family | cost
//   real-estate:       price | market | agent_fees | timing | condition | financing | location
//   health-wellness:   effectiveness | side_effects | cost | time_commitment | provider | skepticism
//
// Pattern interrupts are moment-aware:
//   "stall"      — prospect going quiet, buying-time answers, vague responses
//   "pre-takeaway" — final move before letting go (Airplane Question)
//   "general"    — any reset needed
//
// Actions:
//   classify        — infer bucket from prospect text, return response
//   respond         — given a known bucket, return the response directly
//   pattern_interrupt — return the right story for flavor + moment
//   list_buckets    — list all buckets for current flavor
//   log             — log an objection handling event for record-keeping

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Network Marketer buckets (spec LOCKED)
type NMBucket = "compensation" | "product" | "time" | "reputation" | "trust" | "family" | "cost";
// Real Estate buckets
type REBucket = "price" | "market" | "agent_fees" | "timing" | "condition" | "financing" | "location";
// Health & Wellness buckets
type HWBucket = "effectiveness" | "side_effects" | "cost" | "time_commitment" | "provider" | "skepticism";

type AnyBucket = NMBucket | REBucket | HWBucket | "unknown";

type PatternInterruptMoment = "stall" | "pre_takeaway" | "general";

interface ObjectionResponse {
  bucket: AnyBucket;
  label: string;
  responseTemplate: string;   // Uses {tenantName}, {years}, {biggestWin}, {product} tokens
  followUpQuestion: string;   // Re-engage question after the response
}

interface PatternInterruptStory {
  name: string;
  moment: PatternInterruptMoment[];
  storyTemplate: string;
}

interface ObjectionLogEntry {
  id: string;
  leadId?: string;
  prospectText?: string;
  bucket: AnyBucket;
  flavor: string;
  responseText: string;
  loggedAt: string;
}

interface ObjectionLog {
  entries: ObjectionLogEntry[];
}

interface OnboardState {
  phase: string;
  flavor: string;
  region?: string;
  identity: {
    name?: string;
    productOrOpportunity?: string;
    yearsInProfession?: string;
    biggestWin?: string;
    differentiator?: string;
  };
  botName?: string;
}

interface ToolContext {
  sessionKey: string;
  agentId: string;
  workdir: string;
  config: Record<string, unknown>;
  abortSignal: AbortSignal;
  logger: {
    debug(msg: string, ...args: unknown[]): void;
    info(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
  };
}

interface ToolResult {
  ok: boolean;
  output?: string;
  error?: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// Objection libraries — per flavor
// ---------------------------------------------------------------------------

// Templates use: {tenantName} {years} {biggestWin} {product} {differentiator}

const NM_BUCKETS: Record<NMBucket, ObjectionResponse> = {
  compensation: {
    bucket: "compensation",
    label: "Income / Compensation",
    responseTemplate: [
      `The income question — that's the right one to ask.`,
      ``,
      `I'll be straight with you: this isn't a lottery ticket. {tenantName} wouldn't tell you it is. What it is, for people who work the 3-per-day principle consistently, is a compounding income stream that grows with their network.`,
      ``,
      `{tenantName} has {years} in this. {biggestWin}. That didn't happen overnight — it happened from daily, consistent activity over time.`,
      ``,
      `There are realistic income ranges I can share if that helps. The numbers are honest and based on actual activity levels.`,
    ].join("\n"),
    followUpQuestion: `Does that make the income picture clearer, or is there a specific number you're trying to understand?`,
  },

  product: {
    bucket: "product",
    label: "Product / Results",
    responseTemplate: [
      `You want to know if {product} actually works. That's fair — and it's the right question.`,
      ``,
      `{tenantName} has {years} of results to draw on. The evidence isn't in marketing materials — it's in real people with real outcomes. I can point you to specific examples that match your situation.`,
      ``,
      `{differentiator}`,
    ].join("\n"),
    followUpQuestion: `Would it help to hear from someone in a similar situation who's been using it?`,
  },

  time: {
    bucket: "time",
    label: "Time / Schedule",
    responseTemplate: [
      `The time question. This one comes up a lot.`,
      ``,
      `{tenantName} built this part-time — while running other things. The 3-per-day rule sounds like a lot until you realize most people are already having 3 conversations a day. It's about directing existing conversations, not adding new ones.`,
      ``,
      `The time commitment is real, but it's smaller than people assume. {differentiator}`,
    ].join("\n"),
    followUpQuestion: `If I could show you what a realistic weekly schedule looks like, would that change anything?`,
  },

  reputation: {
    bucket: "reputation",
    label: "Reputation / Legitimacy",
    responseTemplate: [
      `The pyramid / legitimacy question. I'd rather you ask it than not.`,
      ``,
      `{product} has a track record. {tenantName} has been doing this for {years} — they've seen companies come and go, and they wouldn't be here if this wasn't legitimate.`,
      ``,
      `The simplest test for any business model: are customers actually buying because they want the product, or only to recruit? If it's the former, it's a real business. You can verify that.`,
    ].join("\n"),
    followUpQuestion: `What specifically would make you feel confident this is the real deal?`,
  },

  trust: {
    bucket: "trust",
    label: "Trust / Who Is This Person",
    responseTemplate: [
      `You don't know {tenantName} personally yet. That's honest and it's smart.`,
      ``,
      `Here's what I can tell you: {tenantName} {biggestWin}. They've spent {years} in this space and have a track record with real people I can point you to. Trust gets built through a conversation — which is exactly what I'm here to set up.`,
      ``,
      `The people who've worked with {tenantName} — I can make an introduction.`,
    ].join("\n"),
    followUpQuestion: `Would it help to hear directly from someone who's worked with {tenantName}?`,
  },

  family: {
    bucket: "family",
    label: "Spouse / Family Approval",
    responseTemplate: [
      `You want to talk it over. That's smart — decisions like this should involve the people they affect.`,
      ``,
      `{tenantName} has had this conversation with couples and families before. They're happy to include whoever matters in your decision. This isn't a one-person pitch — it's about making sure everyone who needs to understand it can.`,
      ``,
      `A short conversation with both of you present is easy to arrange.`,
    ].join("\n"),
    followUpQuestion: `Would it make sense to set up a conversation where your partner can hear it directly?`,
  },

  cost: {
    bucket: "cost",
    label: "Startup Cost / Investment",
    responseTemplate: [
      `The startup cost — that's the right thing to look at.`,
      ``,
      `{tenantName} can walk you through exactly what's required and what the risk actually is. The ROI framing is very different from the upfront-cost framing. Most traditional businesses require 10-100x more capital with far less support.`,
      ``,
      `{biggestWin} — that happened from a specific investment of time and money. {tenantName} can show you the math.`,
    ].join("\n"),
    followUpQuestion: `If the numbers made sense for your situation, what else would be in the way?`,
  },
};

const RE_BUCKETS: Record<REBucket, ObjectionResponse> = {
  price: {
    bucket: "price",
    label: "Price / Valuation",
    responseTemplate: [
      `The price question. Let's look at it carefully.`,
      ``,
      `{tenantName} has {years} working this market. {biggestWin}. They price based on what the market is actually doing — not what sellers hope it will do.`,
      ``,
      `An overpriced listing sits. A correctly priced listing sells. That difference affects you more than any commission does.`,
    ].join("\n"),
    followUpQuestion: `Would it help to look at what comparable properties have actually sold for recently?`,
  },

  market: {
    bucket: "market",
    label: "Market Conditions / Timing",
    responseTemplate: [
      `The market timing question. It's real.`,
      ``,
      `{tenantName} has been through multiple market cycles over {years} in this business. {differentiator} The people who wait for a "perfect" market often miss the window that was right in front of them.`,
      ``,
      `There are always buyers. There are always sellers. The question is whether the conditions favor your specific situation.`,
    ].join("\n"),
    followUpQuestion: `What would "good timing" look like for you specifically?`,
  },

  agent_fees: {
    bucket: "agent_fees",
    label: "Agent Fees / Commission",
    responseTemplate: [
      `The commission question.`,
      ``,
      `Here's how {tenantName} thinks about it: a good agent doesn't cost you money — they make you money. {biggestWin}. The gap between a well-negotiated deal and a poorly-negotiated one is far larger than any commission.`,
      ``,
      `{differentiator}`,
    ].join("\n"),
    followUpQuestion: `Would it help to look at the net difference in terms of what you'd actually walk away with?`,
  },

  timing: {
    bucket: "timing",
    label: "Not Ready Yet",
    responseTemplate: [
      `You're not ready yet — I hear that.`,
      ``,
      `{tenantName} isn't going to push. {years} in this business and they've learned that the right transaction happens when the timing is right for the client.`,
      ``,
      `What would need to change for the timing to work?`,
    ].join("\n"),
    followUpQuestion: `Is there something specific holding the timing back that we could work around?`,
  },

  condition: {
    bucket: "condition",
    label: "Property Condition",
    responseTemplate: [
      `The condition concern.`,
      ``,
      `{tenantName} has sold properties in every condition. {biggestWin}. There are always buyers — the question is how to position the property correctly.`,
      ``,
      `{differentiator}`,
    ].join("\n"),
    followUpQuestion: `Would a quick walkthrough to identify the highest-impact improvements be useful?`,
  },

  financing: {
    bucket: "financing",
    label: "Buyer Financing",
    responseTemplate: [
      `Financing concerns on the buyer's side.`,
      ``,
      `{tenantName} has strong relationships with lenders who move fast. {years} of transactions means they know who to call. Pre-approval and financing obstacles are manageable when you have the right network.`,
    ].join("\n"),
    followUpQuestion: `Would an introduction to a lender {tenantName} works with regularly help clarify your options?`,
  },

  location: {
    bucket: "location",
    label: "Location Concerns",
    responseTemplate: [
      `The location question.`,
      ``,
      `{tenantName} knows this market — {years} in it. {differentiator} Every location has buyers and sellers. The question is positioning.`,
    ].join("\n"),
    followUpQuestion: `What specifically about the location is the concern?`,
  },
};

const HW_BUCKETS: Record<HWBucket, ObjectionResponse> = {
  effectiveness: {
    bucket: "effectiveness",
    label: "Does It Actually Work",
    responseTemplate: [
      `You want to know if it works. Good question — the right one.`,
      ``,
      `{tenantName} has {years} seeing real results with real people. {biggestWin}. The evidence isn't in the marketing — it's in the outcomes. I can share specific examples that match your situation.`,
    ].join("\n"),
    followUpQuestion: `Would hearing from someone with a similar situation who's seen results be useful?`,
  },

  side_effects: {
    bucket: "side_effects",
    label: "Safety / Side Effects",
    responseTemplate: [
      `Safety is the right thing to ask about.`,
      ``,
      `{product} has been through rigorous testing. {tenantName} wouldn't work with something they didn't believe in — {biggestWin}. I can share the clinical data and testing information.`,
    ].join("\n"),
    followUpQuestion: `Is there a specific concern about safety I can address directly?`,
  },

  cost: {
    bucket: "cost",
    label: "Cost / Affordability",
    responseTemplate: [
      `The cost question.`,
      ``,
      `{tenantName} believes in value over price. {differentiator} The relevant comparison isn't just the cost of {product} — it's the cost of NOT addressing the problem it solves.`,
      ``,
      `{biggestWin}`,
    ].join("\n"),
    followUpQuestion: `If the cost weren't a factor, would you want to move forward?`,
  },

  time_commitment: {
    bucket: "time_commitment",
    label: "Time Commitment",
    responseTemplate: [
      `The time commitment is a real consideration.`,
      ``,
      `{tenantName} will be honest about what's actually required. {differentiator} Most people find it's less time than they assumed once they start.`,
    ].join("\n"),
    followUpQuestion: `What does your current schedule look like — can we figure out what's realistic?`,
  },

  provider: {
    bucket: "provider",
    label: "Already Have a Provider",
    responseTemplate: [
      `You're already working with someone. That's not a problem.`,
      ``,
      `{tenantName} isn't here to replace anyone. What they offer is {differentiator}. A lot of people find it complements what they're already doing.`,
    ].join("\n"),
    followUpQuestion: `What would need to be different for you to consider an additional option?`,
  },

  skepticism: {
    bucket: "skepticism",
    label: "General Skepticism",
    responseTemplate: [
      `Skepticism is healthy. {tenantName} prefers it.`,
      ``,
      `{years} in this field and {biggestWin}. The results are real and verifiable. The skepticism usually disappears after one honest conversation with someone who has actually been through it.`,
      ``,
      `{differentiator}`,
    ].join("\n"),
    followUpQuestion: `What would convince you — specifically?`,
  },
};

// ---------------------------------------------------------------------------
// Pattern Interrupt Stories — per flavor (Named Feature, LOCKED)
// ---------------------------------------------------------------------------

const PATTERN_INTERRUPTS: Record<string, PatternInterruptStory[]> = {
  "network-marketer": [
    {
      name: "The Airplane Question",
      moment: ["stall", "pre_takeaway", "general"],
      storyTemplate: [
        `Let me ask you something before we go any further.`,
        ``,
        `If someone offered you a million dollars to jump out of an airplane without a parachute, would you do it?`,
        ``,
        `Most people say no immediately. Here's the thing — nobody said the airplane was in the air. It's sitting on the runway.`,
        ``,
        `The lesson: don't say no before you have all the information.`,
        ``,
        `I think there might be some of that happening here. And that's fine — if you've actually thought it through. But if the no is coming from an incomplete picture, it's worth 10 minutes to complete it.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Roommate Principle",
      moment: ["stall", "general"],
      storyTemplate: [
        `Here's something {tenantName} taught me about this work.`,
        ``,
        `When you first meet someone, you don't lead with "will you be my roommate?" You get to know them first. You find out who they are. Then, if it makes sense, you have that conversation.`,
        ``,
        `That's what this is. I'm not asking you to commit to anything. I'm asking you to have a real conversation with someone worth talking to.`,
        ``,
        `That's a much smaller ask.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "Japan Expansion",
      moment: ["stall", "general"],
      storyTemplate: [
        `{tenantName} told me a story about when their company opened Japan.`,
        ``,
        `Everyone said it would never work. Different culture, different language, nobody's heard of it. The first rep there was a schoolteacher who didn't even speak English well.`,
        ``,
        `Within 18 months that teacher had the largest team in the country. Not because the market was easy — because it was new. The people who move first in a new market don't compete. They lead.`,
        ``,
        `Right now, you're looking at something most people haven't heard of yet. That's not a problem. That's the advantage.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "Rick and the Takeaway",
      moment: ["pre_takeaway"],
      storyTemplate: [
        `Let me tell you about Rick.`,
        ``,
        `Rick was skeptical. Told {tenantName} he wasn't interested — three separate times. {tenantName} respected that every time. No pressure. No follow-up guilt trips. Just said "no worries, the door's always open."`,
        ``,
        `Six months later Rick called back. His company had just done layoffs and he remembered the conversation. He started, worked it part-time, and replaced his old salary within a year.`,
        ``,
        `Rick will tell you his only regret is the six months he waited.`,
        ``,
        `I'm not Rick-ing you. If it's not for you, it's not for you. But if you're saying no because of timing — timing has a cost too.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Two Friends",
      moment: ["stall", "general"],
      storyTemplate: [
        `Quick thought.`,
        ``,
        `Two friends hear about the same opportunity on the same day. One says "I'll look into it later." The other says "tell me more."`,
        ``,
        `A year goes by. The first friend is still in the same spot. The second friend isn't rich — but they have momentum, a side income, and options they didn't have before.`,
        ``,
        `The difference wasn't talent or money or connections. It was one decision: "tell me more" instead of "maybe later."`,
        ``,
        `That's all I'm suggesting here.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Taxi Driver",
      moment: ["stall", "general"],
      storyTemplate: [
        `{tenantName} told me about a taxi driver they met overseas.`,
        ``,
        `The driver worked 14-hour days, six days a week. He had a family, bills, the whole thing. Someone introduced him to {product} as a side project.`,
        ``,
        `He didn't have time. He didn't have money. He didn't have connections. What he had was the ability to talk to people all day long — which he was already doing for free.`,
        ``,
        `Within a year he'd built enough to cut his driving days in half. Within two years he stopped driving entirely.`,
        ``,
        `I'm not saying that's you. I'm saying the "I don't have time" story isn't always as true as it feels.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
  ],

  "real-estate": [
    {
      name: "The Empty House",
      moment: ["stall", "pre_takeaway", "general"],
      storyTemplate: [
        `Quick story.`,
        ``,
        `A seller once told {tenantName} they didn't need an agent — they'd sell it themselves. {tenantName} said fine, no problem, just let me know how it goes.`,
        ``,
        `The house sat for six months. By the time they called back, the market had shifted and they accepted 12% less than the original offer on the table.`,
        ``,
        `That difference was real money. Not a commission — real money left on the table.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Sunday Open House",
      moment: ["stall", "general"],
      storyTemplate: [
        `{tenantName} once had a buyer who went to 40 open houses over six months. Loved looking. Never made an offer.`,
        ``,
        `Meanwhile, three properties they liked sold to other buyers. Each one went for less than the next one they liked.`,
        ``,
        `The cost of waiting wasn't just time — it was price. Every month they hesitated, the market moved without them.`,
        ``,
        `A conversation with {tenantName} isn't a commitment. It's getting ahead of the next one that slips away.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
  ],

  "health-wellness": [
    {
      name: "The Doctor's Recommendation",
      moment: ["stall", "pre_takeaway", "general"],
      storyTemplate: [
        `Something worth thinking about.`,
        ``,
        `Most people spend more time researching a restaurant than they spend on a health decision. They go with what's familiar, not what's actually best.`,
        ``,
        `{tenantName} has {years} helping people who finally decided to look at it properly. What they found almost always surprised them.`,
        ``,
        `The question isn't "is this perfect?" It's "is this worth a real look?" Almost always, the answer is yes.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Morning Routine",
      moment: ["stall", "general"],
      storyTemplate: [
        `{tenantName} always asks new clients one question: what does your morning look like?`,
        ``,
        `Most people describe a rush. Coffee, phone, stress, go. The body is already in defense mode before 8 AM.`,
        ``,
        `One small change to that first hour can shift the entire day. Not a lifestyle overhaul. One thing.`,
        ``,
        `That's what a conversation with {tenantName} looks like. Not "change everything." Just "what's the one thing that would make tomorrow better than today?"`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
  ],
};

// ---------------------------------------------------------------------------
// Regional pattern interrupt overrides (Block 2.3 Regional Config)
// Thai content per spec decision 16: "provided by Thai organization leader"
// ---------------------------------------------------------------------------

const REGIONAL_PATTERN_INTERRUPTS: Record<string, Record<string, PatternInterruptStory[]>> = {
  "th-th": {
    "network-marketer": [
      {
        name: "เรื่องเครื่องบิน (The Airplane Question)",
        moment: ["stall", "pre_takeaway", "general"],
        storyTemplate: [
          `ขอถามอะไรสักอย่างก่อนนะคะ`,
          ``,
          `ถ้ามีคนเสนอเงินล้านบาทให้กระโดดออกจากเครื่องบินโดยไม่มีร่มชูชีพ จะทำไหมคะ?`,
          ``,
          `คนส่วนใหญ่จะบอกไม่ทันที แต่ไม่มีใครบอกว่าเครื่องบินอยู่กลางอากาศนะคะ มันจอดอยู่บนรันเวย์`,
          ``,
          `บทเรียนคือ: อย่าเพิ่งปฏิเสธก่อนที่จะได้รู้ข้อมูลทั้งหมด`,
          ``,
          `{tenantName} แค่อยากให้ได้ฟังข้อมูลครบก่อนตัดสินใจค่ะ`,
          ``,
          `— {botName}`,
        ].join("\n"),
      },
      {
        name: "คนขับแท็กซี่ (The Taxi Driver)",
        moment: ["stall", "general"],
        storyTemplate: [
          `{tenantName} เล่าให้ฟังเรื่องคนขับแท็กซี่คนหนึ่ง`,
          ``,
          `ขับวันละ 14 ชั่วโมง หกวันต่อสัปดาห์ มีครอบครัว มีค่าใช้จ่าย แบบเราทุกคน มีคนแนะนำให้ลอง {product} เป็นงานเสริม`,
          ``,
          `ไม่มีเวลา ไม่มีเงิน ไม่มีคอนเนคชั่น แต่มีสิ่งหนึ่ง — คุยกับคนได้ทั้งวัน ซึ่งปกติก็ทำอยู่แล้วฟรีๆ`,
          ``,
          `ภายในปีเดียว ลดวันขับรถลงครึ่งหนึ่ง ภายในสองปี หยุดขับเลย`,
          ``,
          `ไม่ได้บอกว่าคุณจะเหมือนกัน แค่บอกว่า "ไม่มีเวลา" อาจไม่ได้เป็นจริงเสมอไปค่ะ`,
          ``,
          `— {botName}`,
        ].join("\n"),
      },
      {
        name: "ตลาดนัด (The Market Stall)",
        moment: ["stall", "general"],
        storyTemplate: [
          `ลองนึกถึงคนขายของที่ตลาดนัดค่ะ`,
          ``,
          `คนที่มาก่อนเจ้าอื่นได้ที่ดีที่สุด มีลูกค้ามากที่สุด เพราะมาตอนที่คนอื่นยังไม่มา`,
          ``,
          `ตอนนี้ {product} ยังเป็นโอกาสใหม่ คนส่วนใหญ่ยังไม่รู้จัก นั่นไม่ใช่ปัญหา — นั่นคือข้อได้เปรียบค่ะ`,
          ``,
          `คนที่เริ่มก่อนไม่ได้แข่งกับใคร — เขาเป็นผู้นำเลย`,
          ``,
          `— {botName}`,
        ].join("\n"),
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Regional objection bucket overrides
// Culturally adapted responses for th-th region
// ---------------------------------------------------------------------------

const REGIONAL_BUCKET_OVERRIDES: Record<string, Record<string, Partial<Record<string, ObjectionResponse>>>> = {
  "th-th": {
    "network-marketer": {
      compensation: {
        bucket: "compensation",
        label: "รายได้ / ค่าตอบแทน",
        responseTemplate: [
          `เรื่องรายได้ — คำถามที่ดีมากค่ะ`,
          ``,
          `พูดตรงๆ นะคะ: นี่ไม่ใช่ลอตเตอรี่ {tenantName} ไม่เคยบอกว่าเป็น แต่สำหรับคนที่ทำ 3 คนต่อวันสม่ำเสมอ มันเป็นรายได้ที่เติบโตตามเครือข่าย`,
          ``,
          `{tenantName} ทำมา {years} แล้ว {biggestWin} ไม่ใช่เรื่องข้ามคืน แต่เกิดจากทำทุกวันอย่างต่อเนื่อง`,
          ``,
          `มีตัวเลขจริงที่แชร์ได้ค่ะ ตัวเลขที่ซื่อสัตย์และอ้างอิงจากการทำงานจริง`,
        ].join("\n"),
        followUpQuestion: `อยากรู้ตัวเลขที่เป็นไปได้สำหรับสถานการณ์ของคุณไหมคะ?`,
      },
      time: {
        bucket: "time",
        label: "เวลา / ตารางงาน",
        responseTemplate: [
          `เรื่องเวลา — เข้าใจเลยค่ะ คนไทยเราทำงานหนักกันอยู่แล้ว`,
          ``,
          `{tenantName} สร้างธุรกิจนี้ควบคู่กับงานอื่น กฎ 3 คนต่อวันฟังดูเยอะ แต่จริงๆ คนเราคุยกับคนวันละ 3 คนอยู่แล้ว แค่เปลี่ยนบทสนทนาเล็กน้อย`,
          ``,
          `เวลาที่ต้องใช้จริงน้อยกว่าที่คิด {differentiator}`,
        ].join("\n"),
        followUpQuestion: `ถ้าเห็นตารางที่เป็นไปได้จริงๆ ต่อสัปดาห์ จะสนใจไหมคะ?`,
      },
      trust: {
        bucket: "trust",
        label: "ความน่าเชื่อถือ / ใครคือคนนี้",
        responseTemplate: [
          `ยังไม่รู้จัก {tenantName} เป็นการส่วนตัว — เข้าใจค่ะ`,
          ``,
          `{tenantName} {biggestWin} ทำมาแล้ว {years} ในวงการนี้ มีผลงานจริงกับคนจริงที่แนะนำได้ ความเชื่อใจมันต้องสร้างผ่านการพูดคุย — ซึ่งเป็นสิ่งที่อยากจัดให้ค่ะ`,
          ``,
          `ในวัฒนธรรมเรา ความเชื่อใจเริ่มต้นจากการแนะนำ — และนี่คือสิ่งที่ {tenantName} อยากทำ พูดคุยกันตัวต่อตัว`,
        ].join("\n"),
        followUpQuestion: `ถ้าได้คุยกับ {tenantName} โดยตรง จะสบายใจขึ้นไหมคะ?`,
      },
    },
  },
};

// ---------------------------------------------------------------------------
// Bucket keyword maps — for classification
// ---------------------------------------------------------------------------

const BUCKET_KEYWORDS: Record<string, Record<string, string[]>> = {
  "network-marketer": {
    compensation: ["money", "income", "earn", "pay", "paid", "salary", "profit", "commission", "compensation", "financial", "revenue", "return", "roi", "how much can i make"],
    product: ["product", "work", "effective", "results", "proof", "evidence", "testimonial", "before", "after", "quality", "ingredients", "safe", "tested", "does it work"],
    time: ["time", "busy", "schedule", "hours", "full-time", "part-time", "commitment", "juggle", "balance", "availability", "free", "spare", "no time"],
    reputation: ["pyramid", "mlm", "scheme", "scam", "legit", "legitimate", "real", "reputation", "credible", "trusted", "history", "company", "brand"],
    trust: ["trust", "know you", "know them", "stranger", "who are you", "background", "experience", "credentials", "track record", "vouch", "who is"],
    family: ["spouse", "husband", "wife", "partner", "family", "kids", "children", "home", "parents", "support", "approval", "together", "discuss", "ask them"],
    cost: ["cost", "price", "expensive", "afford", "investment", "upfront", "startup", "fee", "charge", "risk", "money down", "how much to start"],
  },
  "real-estate": {
    price: ["price", "value", "worth", "overpriced", "too high", "low", "valuation", "appraisal"],
    market: ["market", "timing", "wait", "bubble", "crash", "rates", "interest", "now", "later", "economy"],
    agent_fees: ["commission", "fee", "agent", "realtor", "cost", "percentage", "split"],
    timing: ["ready", "not yet", "wait", "later", "next year", "someday", "soon", "not now"],
    condition: ["condition", "repair", "fix", "renovate", "update", "old", "worn", "damage", "as-is"],
    financing: ["financing", "mortgage", "loan", "qualify", "credit", "bank", "lender", "pre-approval"],
    location: ["location", "area", "neighborhood", "street", "city", "school", "commute", "far"],
  },
  "health-wellness": {
    effectiveness: ["work", "effective", "results", "proof", "evidence", "does it", "really", "testimonial"],
    side_effects: ["safe", "side effects", "risk", "harm", "reaction", "allergic", "dangerous", "concern", "natural"],
    cost: ["cost", "price", "expensive", "afford", "worth", "cheap", "money"],
    time_commitment: ["time", "busy", "schedule", "commitment", "regular", "routine", "consistent", "keep up"],
    provider: ["already", "doctor", "current", "have a", "working with", "my therapist", "my physician"],
    skepticism: ["skeptical", "not sure", "doubt", "maybe", "probably not", "heard it before", "tried it"],
  },
};

// ---------------------------------------------------------------------------
// Classify objection
// ---------------------------------------------------------------------------

export function classifyBucket(text: string, flavor: string): AnyBucket {
  const bucketMap = BUCKET_KEYWORDS[flavor] ?? BUCKET_KEYWORDS["network-marketer"];
  const lower = text.toLowerCase();
  let best: AnyBucket = "unknown";
  let bestScore = 0;

  for (const [bucket, keywords] of Object.entries(bucketMap)) {
    const score = keywords.filter((kw) => lower.includes(kw)).length;
    if (score > bestScore) {
      bestScore = score;
      best = bucket as AnyBucket;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Get response for bucket
// ---------------------------------------------------------------------------

export function getBucketResponse(bucket: AnyBucket, flavor: string, region?: string): ObjectionResponse | null {
  // Check regional override first
  if (region) {
    const regionalOverride = REGIONAL_BUCKET_OVERRIDES[region]?.[flavor]?.[bucket];
    if (regionalOverride) return regionalOverride;
  }
  if (flavor === "network-marketer") return NM_BUCKETS[bucket as NMBucket] ?? null;
  if (flavor === "real-estate") return RE_BUCKETS[bucket as REBucket] ?? null;
  if (flavor === "health-wellness") return HW_BUCKETS[bucket as HWBucket] ?? null;
  return null;
}

// ---------------------------------------------------------------------------
// Template substitution
// ---------------------------------------------------------------------------

export function fillTemplate(template: string, onboard: OnboardState): string {
  return template
    .replace(/\{tenantName\}/g, onboard.identity.name ?? "your operator")
    .replace(/\{years\}/g, onboard.identity.yearsInProfession ?? "several years")
    .replace(/\{biggestWin\}/g, onboard.identity.biggestWin ?? "built a strong track record")
    .replace(/\{product\}/g, onboard.identity.productOrOpportunity ?? "the opportunity")
    .replace(/\{differentiator\}/g, onboard.identity.differentiator ?? "takes a genuinely different approach")
    .replace(/\{botName\}/g, onboard.botName ?? "your Tiger Claw bot");
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function loadOnboard(workdir: string): OnboardState | null {
  const p = path.join(workdir, "onboard_state.json");
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8")) as OnboardState;
  } catch { /* fall through */ }
  return null;
}

function appendLog(workdir: string, entry: ObjectionLogEntry): void {
  const p = path.join(workdir, "objection_log.json");
  let log: ObjectionLog = { entries: [] };
  try {
    if (fs.existsSync(p)) log = JSON.parse(fs.readFileSync(p, "utf8")) as ObjectionLog;
  } catch { /* fall through */ }
  log.entries.push(entry);
  // Keep last 500
  if (log.entries.length > 500) log.entries = log.entries.slice(-500);
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(log, null, 2), "utf8");
}

// ---------------------------------------------------------------------------
// Action: classify
// ---------------------------------------------------------------------------

interface ClassifyParams {
  action: "classify";
  prospectText: string;
  leadId?: string;
  autoLog?: boolean;
}

function handleClassify(
  params: ClassifyParams,
  workdir: string,
  logger: ToolContext["logger"],
  region: string
): ToolResult {
  const onboard = loadOnboard(workdir);
  if (!onboard || onboard.phase !== "complete") {
    return { ok: false, error: "Onboarding not complete." };
  }

  const flavor = onboard.flavor ?? "network-marketer";
  const bucket = classifyBucket(params.prospectText, flavor);
  const def = getBucketResponse(bucket, flavor, region);

  const responseText = def
    ? fillTemplate(def.responseTemplate, onboard) +
      "\n\n" +
      fillTemplate(def.followUpQuestion, onboard)
    : fillTemplate(
        `I hear you — "{prospectText}". Let me connect you with {tenantName} directly — they can answer that better than I can.\n\n{followUp}`,
        onboard
      )
        .replace(/\{prospectText\}/g, params.prospectText.slice(0, 60))
        .replace(/\{followUp\}/g, "Is there a good time for a quick conversation?");

  if (params.autoLog !== false) {
    appendLog(workdir, {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      leadId: params.leadId,
      prospectText: params.prospectText,
      bucket,
      flavor,
      responseText,
      loggedAt: new Date().toISOString(),
    });
  }

  logger.info("tiger_objection: classify", { bucket, flavor });

  const label = def?.label ?? "Unknown objection";

  return {
    ok: true,
    output: [
      `Classified as: ${bucket} (${label})`,
      ``,
      `Response:`,
      `---`,
      responseText,
      `---`,
    ].join("\n"),
    data: { bucket, label, responseText, flavor },
  };
}

// ---------------------------------------------------------------------------
// Action: respond (direct bucket lookup)
// ---------------------------------------------------------------------------

interface RespondParams {
  action: "respond";
  bucket: AnyBucket;
  leadId?: string;
}

function handleRespond(
  params: RespondParams,
  workdir: string,
  logger: ToolContext["logger"],
  region: string
): ToolResult {
  const onboard = loadOnboard(workdir);
  if (!onboard || onboard.phase !== "complete") {
    return { ok: false, error: "Onboarding not complete." };
  }

  const flavor = onboard.flavor ?? "network-marketer";
  const def = getBucketResponse(params.bucket, flavor, region);

  if (!def) {
    return {
      ok: false,
      error: `Bucket "${params.bucket}" not found for flavor "${flavor}". Call list_buckets to see available options.`,
    };
  }

  const responseText =
    fillTemplate(def.responseTemplate, onboard) +
    "\n\n" +
    fillTemplate(def.followUpQuestion, onboard);

  appendLog(workdir, {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    leadId: params.leadId,
    bucket: params.bucket,
    flavor,
    responseText,
    loggedAt: new Date().toISOString(),
  });

  logger.info("tiger_objection: respond", { bucket: params.bucket, flavor });

  return {
    ok: true,
    output: [`${def.label} response:`, `---`, responseText, `---`].join("\n"),
    data: { bucket: params.bucket, label: def.label, responseText, flavor },
  };
}

// ---------------------------------------------------------------------------
// Action: pattern_interrupt
// ---------------------------------------------------------------------------

interface PatternInterruptParams {
  action: "pattern_interrupt";
  moment?: PatternInterruptMoment;
  storyName?: string;
}

function handlePatternInterrupt(
  params: PatternInterruptParams,
  workdir: string,
  logger: ToolContext["logger"],
  region: string
): ToolResult {
  const onboard = loadOnboard(workdir);
  if (!onboard || onboard.phase !== "complete") {
    return { ok: false, error: "Onboarding not complete." };
  }

  const flavor = onboard.flavor ?? "network-marketer";

  // Prefer regional stories, fall back to default
  const regionalStories = REGIONAL_PATTERN_INTERRUPTS[region]?.[flavor];
  const defaultStories = PATTERN_INTERRUPTS[flavor] ?? PATTERN_INTERRUPTS["network-marketer"];
  const stories = regionalStories && regionalStories.length > 0 ? regionalStories : defaultStories;
  const moment = params.moment ?? "general";

  let story: PatternInterruptStory | undefined;

  if (params.storyName) {
    // Search both regional and default for named stories
    story = stories.find((s) => s.name.toLowerCase() === params.storyName!.toLowerCase())
      ?? defaultStories.find((s) => s.name.toLowerCase() === params.storyName!.toLowerCase());
  }

  if (!story) {
    // Find first story appropriate for this moment
    story = stories.find((s) => s.moment.includes(moment)) ?? stories[0];
  }

  if (!story) {
    return { ok: false, error: `No pattern interrupt stories found for flavor "${flavor}".` };
  }

  const storyText = fillTemplate(story.storyTemplate, onboard);

  logger.info("tiger_objection: pattern_interrupt", { story: story.name, moment, flavor });

  return {
    ok: true,
    output: [`Pattern interrupt: "${story.name}"`, `Moment: ${moment}`, ``, `---`, storyText, `---`].join("\n"),
    data: { storyName: story.name, moment, storyText, flavor },
  };
}

// ---------------------------------------------------------------------------
// Action: list_buckets
// ---------------------------------------------------------------------------

function handleListBuckets(workdir: string, region: string): ToolResult {
  const onboard = loadOnboard(workdir);
  const flavor = onboard?.flavor ?? "network-marketer";

  const bucketMaps: Record<string, Record<string, ObjectionResponse>> = {
    "network-marketer": NM_BUCKETS as unknown as Record<string, ObjectionResponse>,
    "real-estate": RE_BUCKETS as unknown as Record<string, ObjectionResponse>,
    "health-wellness": HW_BUCKETS as unknown as Record<string, ObjectionResponse>,
  };

  const map = bucketMaps[flavor] ?? bucketMaps["network-marketer"];
  const regionalOverrides = REGIONAL_BUCKET_OVERRIDES[region]?.[flavor] ?? {};
  const lines = [`Objection buckets for flavor "${flavor}" (region: ${region}):`, ``];

  for (const [key, def] of Object.entries(map)) {
    const isRegional = key in regionalOverrides;
    lines.push(`  ${key.padEnd(20)} ${(def as ObjectionResponse).label}${isRegional ? " [regional]" : ""}`);
  }

  const regionalStories = REGIONAL_PATTERN_INTERRUPTS[region]?.[flavor];
  const defaultStories = PATTERN_INTERRUPTS[flavor] ?? PATTERN_INTERRUPTS["network-marketer"];
  const stories = regionalStories && regionalStories.length > 0 ? regionalStories : defaultStories;
  lines.push(``, `Pattern interrupt stories${regionalStories ? ` (${region} regional)` : ""}:`);
  for (const s of stories) {
    lines.push(`  "${s.name}" — moments: ${s.moment.join(", ")}`);
  }

  return {
    ok: true,
    output: lines.join("\n"),
    data: {
      flavor,
      buckets: Object.keys(map),
      patternInterrupts: stories.map((s) => ({ name: s.name, moments: s.moment })),
    },
  };
}

// ---------------------------------------------------------------------------
// Action: log
// ---------------------------------------------------------------------------

interface LogParams {
  action: "log";
  bucket: AnyBucket;
  leadId?: string;
  prospectText?: string;
  notes?: string;
}

function handleLog(params: LogParams, workdir: string): ToolResult {
  const onboard = loadOnboard(workdir);
  const flavor = onboard?.flavor ?? "network-marketer";

  appendLog(workdir, {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    leadId: params.leadId,
    prospectText: params.prospectText,
    bucket: params.bucket,
    flavor,
    responseText: params.notes ?? "",
    loggedAt: new Date().toISOString(),
  });

  return {
    ok: true,
    output: `Objection logged: ${params.bucket}${params.leadId ? ` for lead ${params.leadId}` : ""}.`,
    data: { bucket: params.bucket, flavor },
  };
}

// ---------------------------------------------------------------------------
// Main execute dispatcher
// ---------------------------------------------------------------------------

async function execute(
  params: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { workdir, logger } = context;
  const action = params.action as string;
  const region = (context.config["REGION"] as string) ?? "us-en";

  logger.info("tiger_objection called", { action });

  try {
    switch (action) {
      case "classify":
        return handleClassify(params as unknown as ClassifyParams, workdir, logger, region);

      case "respond":
        return handleRespond(params as unknown as RespondParams, workdir, logger, region);

      case "pattern_interrupt":
        return handlePatternInterrupt(params as unknown as PatternInterruptParams, workdir, logger, region);

      case "list_buckets":
        return handleListBuckets(workdir, region);

      case "log":
        return handleLog(params as unknown as LogParams, workdir);

      default:
        return {
          ok: false,
          error: `Unknown action: "${action}". Valid: classify | respond | pattern_interrupt | list_buckets | log`,
        };
    }
  } catch (err) {
    logger.error("tiger_objection error", { action, err: String(err) });
    return {
      ok: false,
      error: `tiger_objection error in action "${action}": ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_objection = {
  name: "tiger_objection",
  description:
    "Objection handling library with per-flavor buckets and pattern interrupt stories. Classify prospect text into an objection bucket and get a templated response using the tenant's real credentials. OR look up a specific bucket directly. OR fire a pattern interrupt story at a stall point. Flavors: network-marketer (compensation/product/time/reputation/trust/family/cost), real-estate (price/market/agent_fees/timing/condition/financing/location), health-wellness (effectiveness/side_effects/cost/time_commitment/provider/skepticism). Pattern interrupts deployed at stall points and pre-takeaway — NOT randomly. Flagship: The Airplane Question (network-marketer). Logs all objection events to objection_log.json.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["classify", "respond", "pattern_interrupt", "list_buckets", "log"],
        description:
          "classify: auto-detect bucket from prospect text and return response. respond: given a known bucket name, return response directly. pattern_interrupt: return a story for the current moment (stall/pre_takeaway/general). list_buckets: show all buckets for current flavor. log: record an objection event.",
      },
      prospectText: {
        type: "string",
        description: "The prospect's actual words. Required for classify.",
      },
      bucket: {
        type: "string",
        description: "Objection bucket name. Required for respond and log. See list_buckets for valid values per flavor.",
      },
      leadId: {
        type: "string",
        description: "Optional lead UUID to associate the event with a lead record.",
      },
      moment: {
        type: "string",
        enum: ["stall", "pre_takeaway", "general"],
        description: "The conversational moment for pattern_interrupt selection. stall: prospect going quiet. pre_takeaway: final move before letting go. general: any reset needed. Defaults to general.",
      },
      storyName: {
        type: "string",
        description: "Specific story name for pattern_interrupt. If omitted, best story for the moment is selected automatically.",
      },
      notes: {
        type: "string",
        description: "Optional notes for log action.",
      },
      autoLog: {
        type: "boolean",
        description: "Whether to automatically log the classify result. Defaults to true.",
      },
    },
    required: ["action"],
  },

  execute,
};

export default tiger_objection;
