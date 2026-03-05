// Tiger Claw — tiger_aftercare Tool
// Stage 5: Retention & Aftercare — Block 3.8 of TIGERCLAW-MASTER-SPEC-v2.md
//
// Two tracks (LOCKED):
//
//   TRACK A — Business Builder Aftercare
//     Phase 1  Day 1-7:   Welcome sequence, first steps, product basics
//     Phase 2  Day 8-30:  Skill building, first conversations, 3-per-day rule
//     Phase 3  Day 31-90: Momentum, activity tracking, wins/struggles
//     Phase 4  Ongoing:   30/60/90 day check-ins, inactive flagging, high performer recognition
//
//   TRACK B — Customer Aftercare (Bronze → Silver → Gold)
//     Bronze: Welcome, 7-day check-in, monthly satisfaction survey, referral ask
//     Silver: All Bronze + full 7-touch referral campaign, upsell sequence, usage reports
//     Gold:   All Silver + annual plan offers, quarterly review calls, double referral bonus, VIP early access
//
//     Tier promotion triggered by: purchase frequency, referral count, engagement.
//     Tenant can override tier manually.
//
//   Customer-to-Builder Upgrade Detection (LOCKED):
//     Bot watches for builder signals: enthusiasm, multiple referrals, business questions.
//     3+ referrals → flag to tenant: "They're showing builder signals."
//     Tenant responds: yes / no / "I'll handle personally."
//
//   Inactive detection (Track A): no response after 2 consecutive touches → flag to tenant.
//   High performer detection (Track A): consistent engagement → proactive recognition.
//
// Cron fires `check` daily.
// Actions: enroll | check | mark_sent | record_signal | set_tier | list

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Track A — touch schedule (day offsets from enrollment)
const BUILDER_TOUCHES: Array<{ day: number; phase: BuilderPhase; type: BuilderTouchType }> = [
  { day: 1,  phase: "welcome",        type: "welcome" },
  { day: 3,  phase: "welcome",        type: "first_steps" },
  { day: 5,  phase: "welcome",        type: "product_basics" },
  { day: 7,  phase: "welcome",        type: "who_do_you_know" },
  { day: 10, phase: "skill_building", type: "three_per_day_rule" },
  { day: 14, phase: "skill_building", type: "first_conversation_coaching" },
  { day: 21, phase: "skill_building", type: "checkin" },
  { day: 28, phase: "skill_building", type: "who_do_you_know_followup" },
  { day: 35, phase: "momentum",       type: "momentum_check" },
  { day: 45, phase: "momentum",       type: "win_or_struggle" },
  { day: 60, phase: "momentum",       type: "thirty_day_review" },
  { day: 75, phase: "momentum",       type: "activity_check" },
  { day: 90, phase: "momentum",       type: "ninety_day_review" },
  { day: 120, phase: "ongoing",       type: "four_month_checkin" },
  { day: 150, phase: "ongoing",       type: "five_month_checkin" },
  { day: 180, phase: "ongoing",       type: "six_month_checkin" },
];

// Track B — Bronze touch schedule
const BRONZE_TOUCHES: Array<{ day: number; type: CustomerTouchType }> = [
  { day: 1,   type: "customer_welcome" },
  { day: 7,   type: "seven_day_checkin" },
  { day: 30,  type: "satisfaction_survey" },
  { day: 30,  type: "referral_ask" },
  { day: 60,  type: "monthly_checkin" },
  { day: 90,  type: "three_month_checkin" },
];

// Silver adds onto Bronze
const SILVER_EXTRA_TOUCHES: Array<{ dayOffset: number; type: CustomerTouchType }> = [
  { dayOffset: 0,  type: "silver_welcome" },
  { dayOffset: 5,  type: "referral_campaign_1" },
  { dayOffset: 10, type: "referral_campaign_2" },
  { dayOffset: 16, type: "referral_campaign_3" },
  { dayOffset: 22, type: "upsell_intro" },
  { dayOffset: 28, type: "referral_campaign_4" },
  { dayOffset: 35, type: "referral_campaign_5" },
  { dayOffset: 42, type: "referral_campaign_6" },
  { dayOffset: 50, type: "usage_report" },
  { dayOffset: 58, type: "referral_campaign_7" },
  { dayOffset: 65, type: "upsell_followup" },
];

// Gold adds on top of Silver
const GOLD_EXTRA_TOUCHES: Array<{ dayOffset: number; type: CustomerTouchType }> = [
  { dayOffset: 0,  type: "gold_welcome" },
  { dayOffset: 10, type: "annual_plan_offer" },
  { dayOffset: 30, type: "quarterly_review_schedule" },
  { dayOffset: 60, type: "vip_early_access" },
];

// Tier upgrade thresholds
const SILVER_REFERRAL_THRESHOLD = 2;
const SILVER_PURCHASE_THRESHOLD = 2;
const GOLD_REFERRAL_THRESHOLD = 5;
const GOLD_PURCHASE_THRESHOLD = 4;
const BUILDER_UPGRADE_REFERRAL_THRESHOLD = 3;

// Inactive: no response to 2 consecutive touches
const INACTIVE_CONSECUTIVE_THRESHOLD = 2;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BuilderPhase = "welcome" | "skill_building" | "momentum" | "ongoing";
type CustomerTier = "bronze" | "silver" | "gold";

type BuilderTouchType =
  | "welcome"
  | "first_steps"
  | "product_basics"
  | "who_do_you_know"
  | "three_per_day_rule"
  | "first_conversation_coaching"
  | "checkin"
  | "who_do_you_know_followup"
  | "momentum_check"
  | "win_or_struggle"
  | "thirty_day_review"
  | "activity_check"
  | "ninety_day_review"
  | "four_month_checkin"
  | "five_month_checkin"
  | "six_month_checkin";

type CustomerTouchType =
  | "customer_welcome"
  | "seven_day_checkin"
  | "satisfaction_survey"
  | "referral_ask"
  | "monthly_checkin"
  | "three_month_checkin"
  | "silver_welcome"
  | "referral_campaign_1" | "referral_campaign_2" | "referral_campaign_3" | "referral_campaign_4"
  | "referral_campaign_5" | "referral_campaign_6" | "referral_campaign_7"
  | "upsell_intro"
  | "usage_report"
  | "upsell_followup"
  | "gold_welcome"
  | "annual_plan_offer"
  | "quarterly_review_schedule"
  | "vip_early_access"
  | "builder_upgrade_flag";

type AftercareStatus =
  | "active"
  | "inactive_flagged"   // 2 no-responses — tenant alerted
  | "upgrade_flagged"    // Builder signals detected — tenant alerted
  | "paused"             // Tenant said "I'll handle personally"
  | "completed";         // Sequence done

interface AftercareTouchRecord {
  touchNumber: number;
  type: BuilderTouchType | CustomerTouchType;
  scheduledFor: string;
  sentAt?: string;
  responseAt?: string;
  responseType?: "positive" | "neutral" | "no_response";
  referralsGiven?: number;   // Track B: referrals provided in this touch
}

interface TierHistoryEntry {
  tier: CustomerTier;
  promotedAt: string;
  reason: string;
}

interface AftercareRecord {
  id: string;
  leadId: string;
  leadDisplayName: string;
  platform: string;
  oar: "builder" | "customer";
  enrolledAt: string;
  status: AftercareStatus;

  // Track A (builder)
  phase?: BuilderPhase;
  currentTouchNumber: number;
  touchHistory: AftercareTouchRecord[];
  consecutiveNoResponses: number;
  flaggedInactiveAt?: string;
  flaggedHighPerformerAt?: string;
  positiveResponseCount: number;

  // Track B (customer)
  tier?: CustomerTier;
  tierHistory: TierHistoryEntry[];
  purchaseCount: number;
  referralCount: number;
  builderSignalCount: number;
  flaggedForUpgradeAt?: string;
  tierPromotionTouches: AftercareTouchRecord[];

  // Scheduling
  nextTouchScheduledFor?: string;
  lastTouchSentAt?: string;
  completedAt?: string;
}

interface AftercarStore {
  [aftercareId: string]: AftercareRecord;
}

interface OnboardState {
  phase: string;
  flavor: string;
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
// Persistence
// ---------------------------------------------------------------------------

function loadJson<T>(filePath: string): T | null {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch { /* fall through */ }
  return null;
}

function saveJson(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
}

function daysFromEnrollment(enrolledAt: string): number {
  return Math.floor((Date.now() - new Date(enrolledAt).getTime()) / 86400000);
}

function dateAtDayOffset(enrolledAt: string, dayOffset: number): string {
  return new Date(new Date(enrolledAt).getTime() + dayOffset * 86400000).toISOString();
}

// ---------------------------------------------------------------------------
// Message generation — Track A (builder)
// ---------------------------------------------------------------------------

function buildBuilderMessage(
  type: BuilderTouchType,
  record: AftercareRecord,
  onboard: OnboardState
): string {
  const botName = onboard.botName ?? "your Tiger Claw bot";
  const tenantName = onboard.identity.name ?? "your operator";
  const product = onboard.identity.productOrOpportunity ?? "the opportunity";
  const name = record.leadDisplayName;
  const days = daysFromEnrollment(record.enrolledAt);

  switch (type) {
    case "welcome":
      return [
        `Welcome to the team, ${name}!`,
        ``,
        `I'm ${botName}, working with ${tenantName}. I'll be your support system over the next 90 days — checking in, giving you tools, and flagging you to ${tenantName} when something needs their personal attention.`,
        ``,
        `Here's the plan: Days 1-7 are about getting your footing. Days 8-30 are about building the skill. Days 31-90 are about momentum.`,
        ``,
        `One thing to know from day one: this works on a simple principle. Three quality conversations per day. That's it. Everything else follows from that.`,
        ``,
        `More to come. Welcome aboard.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "first_steps":
      return [
        `Hey ${name},`,
        ``,
        `Three things for your first week:`,
        ``,
        `1. Get familiar with ${product} as if you're going to explain it to someone who's never heard of it. Because you will be.`,
        `2. Make a list — everyone you know. Don't pre-qualify them. Just write names.`,
        `3. Reach out to ${tenantName} with one question you have. Just one. Get that conversation started.`,
        ``,
        `Nothing complicated. First week is about orientation.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "product_basics":
      return [
        `Hey ${name},`,
        ``,
        `The most important thing about ${product} at this stage: you don't need to know everything.`,
        ``,
        `You need to know enough to answer the three most common questions people ask. ${tenantName} can tell you exactly what those are — they've had hundreds of these conversations.`,
        ``,
        `Ask them. That's your assignment for today.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "who_do_you_know":
      return [
        `Hey ${name},`,
        ``,
        `Day 7. Time for the list.`,
        ``,
        `"Who do you know?"`,
        ``,
        `Not: "Who do I think would be interested?" That's the wrong question and you'll pre-qualify everyone off the list.`,
        ``,
        `Just: who do you know? Friends, family, former colleagues, neighbors, people from your gym, church, school. All of them.`,
        ``,
        `Write the list. Send it to me if you want — I'll help you think through the approach for each person.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "three_per_day_rule":
      return [
        `Hey ${name},`,
        ``,
        `Here's the whole game in one rule: three quality conversations per day.`,
        ``,
        `Not three pitches. Not three closes. Three conversations. With real people. About something real.`,
        ``,
        `Do that consistently for 90 days and the math takes care of itself. ${tenantName} didn't build what they built by doing anything other than exactly this.`,
        ``,
        `Where are you on the list? How many people have you reached out to this week?`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "first_conversation_coaching":
      return [
        `Hey ${name},`,
        ``,
        `Week two. You've probably had a few conversations by now — maybe some went well, maybe some felt awkward.`,
        ``,
        `Here's the thing about first conversations: your job is NOT to convince anyone of anything. Your job is to find out if there's a reason to have a second conversation.`,
        ``,
        `Ask questions. Listen. The information they give you tells you whether to go further.`,
        ``,
        `If someone says "I'm not interested" — great. One fewer person on the list. If someone says "tell me more" — great. That's what you're looking for.`,
        ``,
        `How's it going?`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "checkin":
      return [
        `Hey ${name},`,
        ``,
        `Three weeks in. Quick check-in.`,
        ``,
        `Where are you? I'm not looking for a highlight reel — I want to know what's actually happening. Wins and stuck points are both useful.`,
        ``,
        `What's one thing going well? What's one thing you're not sure about?`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "who_do_you_know_followup":
      return [
        `Hey ${name},`,
        ``,
        `Coming back to the list. Four weeks in.`,
        ``,
        `Who made it onto your contact list? How many conversations have you had?`,
        ``,
        `If the answer is "not many" — that's okay and it's honest. Let's figure out what's in the way and fix it. That's what I'm here for.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "momentum_check":
      return [
        `Hey ${name},`,
        ``,
        `Day ${days}. You're past the 30-day mark. The people who make it through month one usually keep going.`,
        ``,
        `Give me the honest number: how many conversations per day, on average?`,
        ``,
        `No judgment. Just want to know where you are so I can tell you where you're likely going.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "win_or_struggle":
      return [
        `Hey ${name},`,
        ``,
        `One win. One struggle. That's all I want to know.`,
        ``,
        `What's one thing that's worked? What's one thing that's still frustrating?`,
        ``,
        `${tenantName} has been exactly where you are. They've probably hit both of those walls.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "thirty_day_review":
      return [
        `Hey ${name},`,
        ``,
        `Two months in — let's do a quick review.`,
        ``,
        `Total conversations started: (you tell me). Positive responses: (you tell me). Anything in active follow-up: (you tell me).`,
        ``,
        `This is how you build a picture of what's actually working. Numbers don't lie and they don't judge.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "activity_check":
      return [
        `Hey ${name},`,
        ``,
        `Day ${days} — just a pulse check.`,
        ``,
        `Are you still at three per day? Even at two? Even at one?`,
        ``,
        `Any activity beats no activity. If things have slowed down, let's talk about why.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "ninety_day_review":
      return [
        `Hey ${name},`,
        ``,
        `90 days.`,
        ``,
        `This is a real milestone. Whatever happened over these three months — you stuck around long enough to find out what this is.`,
        ``,
        `I'm flagging ${tenantName} for a personal conversation with you. They'll be in touch.`,
        ``,
        `And for what it's worth: the people who get to day 90 are the ones who figure it out.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "four_month_checkin":
    case "five_month_checkin":
    case "six_month_checkin": {
      const monthNum = type === "four_month_checkin" ? 4 : type === "five_month_checkin" ? 5 : 6;
      return [
        `Hey ${name},`,
        ``,
        `Month ${monthNum} check-in.`,
        ``,
        `You're in the ongoing phase now — no more onboarding, just momentum. What does the next month look like for you?`,
        ``,
        `${tenantName} wants to know how you're doing.`,
        ``,
        `— ${botName}`,
      ].join("\n");
    }

    default:
      return `Hey ${name}, checking in from ${botName}. How are things going?`;
  }
}

// ---------------------------------------------------------------------------
// Message generation — Track B (customer)
// ---------------------------------------------------------------------------

function buildCustomerMessage(
  type: CustomerTouchType,
  record: AftercareRecord,
  onboard: OnboardState
): string {
  const botName = onboard.botName ?? "your Tiger Claw bot";
  const tenantName = onboard.identity.name ?? "your operator";
  const product = onboard.identity.productOrOpportunity ?? "the product";
  const name = record.leadDisplayName;
  const tier = record.tier ?? "bronze";

  switch (type) {
    case "customer_welcome":
      return [
        `Welcome, ${name}!`,
        ``,
        `I'm ${botName}, here to make sure you have a great experience with ${product}.`,
        ``,
        `If you ever have a question, I'm here. If something isn't right, tell me and I'll get it sorted.`,
        ``,
        `${tenantName} is glad you're here.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "seven_day_checkin":
      return [
        `Hey ${name},`,
        ``,
        `One week in — how's ${product} treating you?`,
        ``,
        `Any questions? Anything not what you expected? Let me know.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "satisfaction_survey":
      return [
        `Hey ${name},`,
        ``,
        `Quick check-in — on a scale of 1-10, how satisfied are you with ${product} so far?`,
        ``,
        `And: is there anything that would make it a 10?`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "referral_ask":
      return [
        `Hey ${name},`,
        ``,
        `One quick thing — do you know anyone else who might benefit from ${product}?`,
        ``,
        `No pressure, just thought I'd ask. If someone comes to mind, feel free to share their name and I'll reach out on ${tenantName}'s behalf.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "monthly_checkin":
      return [
        `Hey ${name},`,
        ``,
        `Monthly check-in. Still doing well with ${product}?`,
        ``,
        `Let me know if you need anything.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "three_month_checkin":
      return [
        `Hey ${name},`,
        ``,
        `Three months with ${product}. How's the experience been overall?`,
        ``,
        `Any feedback is useful — good or bad.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "silver_welcome":
      return [
        `Hey ${name},`,
        ``,
        `You've been such a great part of ${tenantName}'s customer community that you've been moved to our Silver tier.`,
        ``,
        `That means more access, more support, and a few things coming your way over the next few weeks that Bronze customers don't get.`,
        ``,
        `Thank you for being here.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "referral_campaign_1":
      return [
        `Hey ${name},`,
        ``,
        `As a Silver member, you have access to our referral program.`,
        ``,
        `Do you know one or two people who might benefit from ${product}? If you introduce me to them, I'll handle the conversation — you just make the intro.`,
        ``,
        `Any names come to mind?`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "referral_campaign_2":
      return [
        `Hey ${name},`,
        ``,
        `Quick thought — the people who get the most from ${product} usually heard about it from someone they trust. That's you for your circle.`,
        ``,
        `Is there a friend or family member who's been dealing with a similar situation to what you had before?`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "referral_campaign_3":
      return [
        `Hey ${name},`,
        ``,
        `Just wanted to check — did anyone come to mind from last time? No pressure at all. If the timing isn't right, that's totally fine.`,
        ``,
        `Sometimes it's just a matter of "hey, this helped me, thought of you."`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "referral_campaign_4":
      return [
        `Hey ${name},`,
        ``,
        `Here's something ${tenantName} shared with me: the best referrals don't come from a pitch. They come from someone saying "this worked for me."`,
        ``,
        `If you've had a good experience, that's all you'd need to say. I'll take it from there.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "referral_campaign_5":
      return [
        `Hey ${name},`,
        ``,
        `People in your world — coworkers, gym friends, neighbors — some of them are probably dealing with the same thing you were before ${product}.`,
        ``,
        `Would you feel comfortable sharing my contact with just one of them? I'll be respectful and low-key.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "referral_campaign_6":
      return [
        `Hey ${name},`,
        ``,
        `Quick update from ${tenantName}: people who've been referred by friends like you tend to stick around longer and get better results. There's something about trust that makes the whole thing click.`,
        ``,
        `If anyone's mentioned something that ${product} could help with, let me know. Even just a first name and I can reach out gently.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "referral_campaign_7":
      return [
        `Hey ${name},`,
        ``,
        `Last check-in on this — I won't keep asking, I promise.`,
        ``,
        `If you've ever thought "so-and-so could use this," now's a great time. And if not, no worries at all. Your experience with ${product} is what matters most.`,
        ``,
        `Thanks for being part of this.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "upsell_intro":
      return [
        `Hey ${name},`,
        ``,
        `Based on how you've been using ${product}, I thought you might want to know about an option that gets you a better experience at a better price.`,
        ``,
        `Want me to share the details?`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "usage_report":
      return [
        `Hey ${name},`,
        ``,
        `Here's a quick usage summary for the past month. You're an active user — ${tenantName} appreciates that.`,
        ``,
        `If you've found things that work well, let me know. And if there's anything that could be better, I'm listening.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "upsell_followup":
      return [
        `Hey ${name},`,
        ``,
        `Following up on the upgrade option I mentioned. Happy to answer any questions if you have them.`,
        ``,
        `No pressure either way.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "gold_welcome":
      return [
        `Hey ${name},`,
        ``,
        `You've earned Gold status. That's the top tier — and you got there through your own engagement and loyalty.`,
        ``,
        `${tenantName} will be in touch personally. You're a VIP.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "annual_plan_offer":
      return [
        `Hey ${name},`,
        ``,
        `As a Gold member, you qualify for our annual plan — which saves you money long-term and locks in your current rate.`,
        ``,
        `Want details?`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "quarterly_review_schedule":
      return [
        `Hey ${name},`,
        ``,
        `Time for your quarterly review with ${tenantName}. These are for Gold members only — a real conversation about your experience, goals, and how we can serve you better.`,
        ``,
        `When works for you?`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "vip_early_access":
      return [
        `Hey ${name},`,
        ``,
        `As a Gold member, you get early access to something ${tenantName} is launching soon.`,
        ``,
        `I'll share details before they go public. Watch this space.`,
        ``,
        `— ${botName}`,
      ].join("\n");

    case "builder_upgrade_flag":
      // This goes to the TENANT, not the customer
      return [
        `🔔 Builder Signal Detected — ${name}`,
        ``,
        `${name} has given ${record.referralCount} referral${record.referralCount === 1 ? "" : "s"} and is showing enthusiasm typical of someone interested in the business side.`,
        ``,
        `Do you want me to start the opportunity conversation with them?`,
        ``,
        `Reply: yes | no | "I'll handle this personally"`,
        ``,
        `— ${botName}`,
      ].join("\n");

    default:
      return `Hey ${name}, checking in. How is ${product} working for you? — ${botName}`;
  }
}

// ---------------------------------------------------------------------------
// Schedule builder helpers
// ---------------------------------------------------------------------------

function buildBuilderTouches(record: AftercareRecord): AftercareTouchRecord[] {
  return BUILDER_TOUCHES.map((t, i) => ({
    touchNumber: i + 1,
    type: t.type,
    scheduledFor: dateAtDayOffset(record.enrolledAt, t.day),
  }));
}

function buildBronzeTouches(record: AftercareRecord): AftercareTouchRecord[] {
  return BRONZE_TOUCHES.map((t, i) => ({
    touchNumber: i + 1,
    type: t.type,
    scheduledFor: dateAtDayOffset(record.enrolledAt, t.day),
  }));
}

function buildSilverPromotionTouches(
  record: AftercareRecord,
  promotedAt: string
): AftercareTouchRecord[] {
  return SILVER_EXTRA_TOUCHES.map((t, i) => ({
    touchNumber: 100 + i, // High numbers to distinguish from Bronze
    type: t.type,
    scheduledFor: new Date(
      new Date(promotedAt).getTime() + t.dayOffset * 86400000
    ).toISOString(),
  }));
}

function buildGoldPromotionTouches(
  record: AftercareRecord,
  promotedAt: string
): AftercareTouchRecord[] {
  return GOLD_EXTRA_TOUCHES.map((t, i) => ({
    touchNumber: 200 + i,
    type: t.type,
    scheduledFor: new Date(
      new Date(promotedAt).getTime() + t.dayOffset * 86400000
    ).toISOString(),
  }));
}

function nextScheduledTouch(
  record: AftercareRecord
): AftercareTouchRecord | undefined {
  const allTouches = [...record.touchHistory, ...record.tierPromotionTouches];
  const now = new Date().toISOString();
  return allTouches
    .filter((t) => !t.sentAt && t.scheduledFor <= now)
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1))[0];
}

// ---------------------------------------------------------------------------
// Action: enroll
// ---------------------------------------------------------------------------

interface EnrollParams {
  action: "enroll";
  leadId: string;
  oar: "builder" | "customer";
  tier?: CustomerTier;
}

function handleEnroll(
  params: EnrollParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const onboard = loadJson<OnboardState>(path.join(workdir, "onboard_state.json"));
  if (!onboard || onboard.phase !== "complete") {
    return { ok: false, error: "Onboarding not complete." };
  }

  const leadsPath = path.join(workdir, "leads.json");
  const leads = loadJson<Record<string, { id: string; displayName: string; platform: string }>>(leadsPath) ?? {};
  const lead = leads[params.leadId];
  if (!lead) return { ok: false, error: `Lead ${params.leadId} not found.` };

  const storePath = path.join(workdir, "aftercare.json");
  const store = loadJson<AftercarStore>(storePath) ?? {};

  // Check for existing active aftercare
  const existing = Object.values(store).find(
    (r) => r.leadId === params.leadId && ["active", "inactive_flagged", "upgrade_flagged"].includes(r.status)
  );
  if (existing) {
    return {
      ok: true,
      output: `${lead.displayName} is already in aftercare (${existing.oar} track, status: ${existing.status}).`,
      data: { aftercareId: existing.id, skipped: true },
    };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const record: AftercareRecord = {
    id,
    leadId: params.leadId,
    leadDisplayName: lead.displayName,
    platform: lead.platform,
    oar: params.oar,
    enrolledAt: now,
    status: "active",
    currentTouchNumber: 0,
    touchHistory: [],
    consecutiveNoResponses: 0,
    positiveResponseCount: 0,
    tier: params.oar === "customer" ? (params.tier ?? "bronze") : undefined,
    tierHistory: params.oar === "customer"
      ? [{ tier: params.tier ?? "bronze", promotedAt: now, reason: "initial enrollment" }]
      : [],
    purchaseCount: 0,
    referralCount: 0,
    builderSignalCount: 0,
    tierPromotionTouches: [],
  };

  // Pre-build all touches
  if (params.oar === "builder") {
    record.touchHistory = buildBuilderTouches(record);
    record.phase = "welcome";
  } else {
    record.touchHistory = buildBronzeTouches(record);
    if (record.tier === "silver") {
      record.tierPromotionTouches = buildSilverPromotionTouches(record, now);
    } else if (record.tier === "gold") {
      record.tierPromotionTouches = [
        ...buildSilverPromotionTouches(record, now),
        ...buildGoldPromotionTouches(record, now),
      ];
    }
  }

  const firstTouch = record.touchHistory[0];
  record.currentTouchNumber = 1;
  record.nextTouchScheduledFor = firstTouch?.scheduledFor ?? now;

  store[id] = record;
  saveJson(storePath, store);

  logger.info("tiger_aftercare: enrolled", {
    aftercareId: id,
    leadDisplayName: lead.displayName,
    oar: params.oar,
    tier: record.tier,
    touchesScheduled: record.touchHistory.length,
  });

  const trackLabel =
    params.oar === "builder"
      ? `Track A (builder) — ${record.touchHistory.length} touches over 6 months`
      : `Track B (customer) — ${record.tier} tier, ${record.touchHistory.length} base touches`;

  return {
    ok: true,
    output: [
      `${lead.displayName} enrolled in aftercare.`,
      `${trackLabel}.`,
      `First touch (${firstTouch?.type}) due now.`,
      `Run tiger_aftercare check to surface it.`,
    ].join("\n"),
    data: {
      aftercareId: id,
      leadId: params.leadId,
      oar: params.oar,
      tier: record.tier,
      touchesScheduled: record.touchHistory.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Action: check (cron — daily)
// ---------------------------------------------------------------------------

function handleCheck(workdir: string, logger: ToolContext["logger"]): ToolResult {
  const storePath = path.join(workdir, "aftercare.json");
  const store = loadJson<AftercarStore>(storePath) ?? {};
  const onboard = loadJson<OnboardState>(path.join(workdir, "onboard_state.json"));
  if (!onboard) return { ok: false, error: "Onboard state not found." };

  const now = new Date().toISOString();

  const due: Array<{
    aftercareId: string;
    leadId: string;
    leadDisplayName: string;
    platform: string;
    oar: string;
    touchType: string;
    touchNumber: number;
    messageText: string;
    isTenantFacing: boolean;
  }> = [];

  for (const record of Object.values(store)) {
    if (!["active", "inactive_flagged", "upgrade_flagged"].includes(record.status)) continue;

    const touch = nextScheduledTouch(record);
    if (!touch) continue;

    const isTenantFacing = touch.type === "builder_upgrade_flag" || touch.type === "ninety_day_review";
    const messageText =
      record.oar === "builder"
        ? buildBuilderMessage(touch.type as BuilderTouchType, record, onboard)
        : buildCustomerMessage(touch.type as CustomerTouchType, record, onboard);

    due.push({
      aftercareId: record.id,
      leadId: record.leadId,
      leadDisplayName: record.leadDisplayName,
      platform: record.platform,
      oar: record.oar,
      touchType: touch.type,
      touchNumber: touch.touchNumber,
      messageText,
      isTenantFacing,
    });
  }

  logger.info("tiger_aftercare: check", { dueCount: due.length });

  if (due.length === 0) {
    return { ok: true, output: "No aftercare touches due today.", data: { due: [] } };
  }

  const lines = [`${due.length} aftercare touch(es) due:`];
  for (const d of due) {
    const dest = d.isTenantFacing ? "[→ TENANT]" : `[→ ${d.leadDisplayName}]`;
    lines.push(`  • ${d.oar} ${dest} — touch ${d.touchNumber} (${d.touchType})`);
  }
  lines.push(``, `For each: send message, then call mark_sent with aftercareId.`);

  return {
    ok: true,
    output: lines.join("\n"),
    data: { due },
  };
}

// ---------------------------------------------------------------------------
// Action: mark_sent
// ---------------------------------------------------------------------------

interface MarkSentParams {
  action: "mark_sent";
  aftercareId: string;
  touchNumber: number;
}

function handleMarkSent(
  params: MarkSentParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const storePath = path.join(workdir, "aftercare.json");
  const store = loadJson<AftercarStore>(storePath) ?? {};
  const record = store[params.aftercareId];
  if (!record) return { ok: false, error: `Aftercare record ${params.aftercareId} not found.` };

  const now = new Date().toISOString();

  // Find touch in both history arrays
  const allTouches = [...record.touchHistory, ...record.tierPromotionTouches];
  const touch = allTouches.find((t) => t.touchNumber === params.touchNumber);
  if (!touch) return { ok: false, error: `Touch ${params.touchNumber} not found in record.` };

  touch.sentAt = now;
  record.lastTouchSentAt = now;
  record.currentTouchNumber = params.touchNumber;

  // Update phase for builder track
  if (record.oar === "builder") {
    const def = BUILDER_TOUCHES[params.touchNumber - 1];
    if (def) record.phase = def.phase;
  }

  // Find next touch to set nextTouchScheduledFor
  const remaining = allTouches
    .filter((t) => !t.sentAt)
    .sort((a, b) => (a.scheduledFor < b.scheduledFor ? -1 : 1));
  record.nextTouchScheduledFor = remaining[0]?.scheduledFor;

  // Check if all touches complete
  if (remaining.length === 0) {
    record.status = "completed";
    record.completedAt = now;
  }

  store[params.aftercareId] = record;
  saveJson(storePath, store);

  logger.info("tiger_aftercare: mark_sent", {
    aftercareId: params.aftercareId,
    touchNumber: params.touchNumber,
    touchType: touch.type,
  });

  return {
    ok: true,
    output: `${record.leadDisplayName}: touch ${params.touchNumber} (${touch.type}) sent.${record.status === "completed" ? " Aftercare sequence complete." : ""}`,
    data: {
      aftercareId: params.aftercareId,
      touchNumber: params.touchNumber,
      touchType: touch.type,
      status: record.status,
      nextTouchScheduledFor: record.nextTouchScheduledFor,
    },
  };
}

// ---------------------------------------------------------------------------
// Action: record_signal
// ---------------------------------------------------------------------------

type SignalType =
  | "purchase"              // Track B: customer made another purchase
  | "referral"              // Track B: customer gave a referral name
  | "builder_signal"        // Track B: showed interest in the business side
  | "positive_response"     // Track A/B: engaged positively
  | "no_response"           // Track A/B: no response to a touch
  | "high_performer";       // Track A: consistent above-average activity

interface RecordSignalParams {
  action: "record_signal";
  aftercareId: string;
  signalType: SignalType;
  touchNumber?: number;
  notes?: string;
}

function handleRecordSignal(
  params: RecordSignalParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const storePath = path.join(workdir, "aftercare.json");
  const store = loadJson<AftercarStore>(storePath) ?? {};
  const onboard = loadJson<OnboardState>(path.join(workdir, "onboard_state.json"));
  const record = store[params.aftercareId];
  if (!record) return { ok: false, error: `Aftercare record ${params.aftercareId} not found.` };

  const now = new Date().toISOString();
  const results: string[] = [];

  // Update touch response if touchNumber provided
  if (params.touchNumber !== undefined) {
    const allTouches = [...record.touchHistory, ...record.tierPromotionTouches];
    const touch = allTouches.find((t) => t.touchNumber === params.touchNumber);
    if (touch) {
      touch.responseAt = now;
      if (params.signalType === "no_response") {
        touch.responseType = "no_response";
      } else if (["purchase", "referral", "positive_response", "high_performer"].includes(params.signalType)) {
        touch.responseType = "positive";
      } else {
        touch.responseType = "neutral";
      }
    }
  }

  // Process signal
  switch (params.signalType) {
    case "purchase":
      record.purchaseCount++;
      results.push(`Purchase recorded (total: ${record.purchaseCount}).`);
      break;

    case "referral":
      record.referralCount++;
      results.push(`Referral recorded (total: ${record.referralCount}).`);

      // Builder upgrade detection
      if (
        record.oar === "customer" &&
        record.referralCount >= BUILDER_UPGRADE_REFERRAL_THRESHOLD &&
        !record.flaggedForUpgradeAt
      ) {
        record.status = "upgrade_flagged";
        record.flaggedForUpgradeAt = now;
        record.builderSignalCount++;

        // Add flag touch to tier promotion touches
        const flagTouch: AftercareTouchRecord = {
          touchNumber: 999,
          type: "builder_upgrade_flag",
          scheduledFor: now,
        };
        record.tierPromotionTouches.push(flagTouch);
        results.push(
          `Builder upgrade flag triggered — ${record.referralCount} referrals. ` +
          `Run check to deliver the flag message to tenant.`
        );
      }
      break;

    case "builder_signal":
      record.builderSignalCount++;
      results.push(`Builder signal recorded (total: ${record.builderSignalCount}).`);

      if (record.oar === "customer" && !record.flaggedForUpgradeAt) {
        record.status = "upgrade_flagged";
        record.flaggedForUpgradeAt = now;
        const flagTouch: AftercareTouchRecord = {
          touchNumber: 999,
          type: "builder_upgrade_flag",
          scheduledFor: now,
        };
        record.tierPromotionTouches.push(flagTouch);
        results.push(`Builder upgrade flag triggered. Run check to deliver the flag message to tenant.`);
      }
      break;

    case "no_response":
      record.consecutiveNoResponses++;
      results.push(`No-response recorded (consecutive: ${record.consecutiveNoResponses}).`);

      if (record.consecutiveNoResponses >= INACTIVE_CONSECUTIVE_THRESHOLD && !record.flaggedInactiveAt) {
        record.status = "inactive_flagged";
        record.flaggedInactiveAt = now;
        results.push(
          `${record.leadDisplayName} flagged as inactive (${record.consecutiveNoResponses} consecutive no-responses). ` +
          `Notify tenant — they need to decide how to handle.`
        );
      }
      break;

    case "positive_response":
      record.consecutiveNoResponses = 0;
      record.positiveResponseCount++;
      results.push(`Positive response recorded (total: ${record.positiveResponseCount}).`);
      break;

    case "high_performer":
      record.positiveResponseCount++;
      record.flaggedHighPerformerAt = now;
      results.push(`${record.leadDisplayName} flagged as high performer. Notify tenant for recognition.`);
      break;
  }

  // Auto-promote tier if thresholds crossed
  if (record.oar === "customer") {
    const currentTier = record.tier ?? "bronze";

    if (
      currentTier === "bronze" &&
      (record.referralCount >= SILVER_REFERRAL_THRESHOLD || record.purchaseCount >= SILVER_PURCHASE_THRESHOLD)
    ) {
      record.tier = "silver";
      record.tierHistory.push({ tier: "silver", promotedAt: now, reason: `referrals: ${record.referralCount}, purchases: ${record.purchaseCount}` });
      const newTouches = buildSilverPromotionTouches(record, now);
      record.tierPromotionTouches.push(...newTouches);
      results.push(`${record.leadDisplayName} auto-promoted to SILVER tier. ${newTouches.length} new touches scheduled.`);
    } else if (
      currentTier === "silver" &&
      (record.referralCount >= GOLD_REFERRAL_THRESHOLD || record.purchaseCount >= GOLD_PURCHASE_THRESHOLD)
    ) {
      record.tier = "gold";
      record.tierHistory.push({ tier: "gold", promotedAt: now, reason: `referrals: ${record.referralCount}, purchases: ${record.purchaseCount}` });
      const newTouches = buildGoldPromotionTouches(record, now);
      record.tierPromotionTouches.push(...newTouches);
      results.push(`${record.leadDisplayName} auto-promoted to GOLD tier. ${newTouches.length} new touches scheduled.`);
    }
  }

  store[params.aftercareId] = record;
  saveJson(storePath, store);

  // Advance involvement level based on aftercare signals
  const leadsPath = path.join(workdir, "leads.json");
  const allLeads = loadJson<Record<string, { involvementLevel?: number }>>(leadsPath) ?? {};
  const theLead = allLeads[record.leadId];
  if (theLead) {
    const cur = theLead.involvementLevel ?? 2;
    let next = cur;
    if (record.purchaseCount >= 2 && cur < 3) next = 3;             // Repeat customer
    if (record.referralCount >= 1 && cur < 4) next = 4;             // Referral source
    if (record.status === "upgrade_flagged" && cur < 6) next = 6;   // Side hustle builder
    if (next > cur) {
      (theLead as Record<string, unknown>).involvementLevel = next;
      saveJson(leadsPath, allLeads);
    }
  }

  logger.info("tiger_aftercare: record_signal", {
    aftercareId: params.aftercareId,
    signalType: params.signalType,
    tier: record.tier,
    status: record.status,
  });

  return {
    ok: true,
    output: results.join("\n") || `Signal '${params.signalType}' recorded for ${record.leadDisplayName}.`,
    data: {
      aftercareId: params.aftercareId,
      signalType: params.signalType,
      tier: record.tier,
      status: record.status,
      referralCount: record.referralCount,
      purchaseCount: record.purchaseCount,
      builderSignalCount: record.builderSignalCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Action: set_tier (tenant override)
// ---------------------------------------------------------------------------

interface SetTierParams {
  action: "set_tier";
  aftercareId: string;
  tier: CustomerTier;
  reason?: string;
}

function handleSetTier(
  params: SetTierParams,
  workdir: string,
  logger: ToolContext["logger"]
): ToolResult {
  const storePath = path.join(workdir, "aftercare.json");
  const store = loadJson<AftercarStore>(storePath) ?? {};
  const record = store[params.aftercareId];
  if (!record) return { ok: false, error: `Aftercare record ${params.aftercareId} not found.` };
  if (record.oar !== "customer") return { ok: false, error: "Tier management is for customer oar only." };

  const previousTier = record.tier ?? "bronze";
  record.tier = params.tier;
  record.tierHistory.push({
    tier: params.tier,
    promotedAt: new Date().toISOString(),
    reason: params.reason ?? "manual tenant override",
  });

  // Add promotion touches if upgrading
  const now = new Date().toISOString();
  if (params.tier === "silver" && previousTier === "bronze") {
    const newTouches = buildSilverPromotionTouches(record, now);
    record.tierPromotionTouches.push(...newTouches);
  } else if (params.tier === "gold" && previousTier !== "gold") {
    const newTouches = buildGoldPromotionTouches(record, now);
    record.tierPromotionTouches.push(...newTouches);
  }

  store[params.aftercareId] = record;
  saveJson(storePath, store);

  logger.info("tiger_aftercare: set_tier", {
    aftercareId: params.aftercareId,
    previousTier,
    newTier: params.tier,
  });

  return {
    ok: true,
    output: `${record.leadDisplayName}: tier set to ${params.tier} (was ${previousTier}).`,
    data: { aftercareId: params.aftercareId, tier: params.tier, previousTier },
  };
}

// ---------------------------------------------------------------------------
// Action: list
// ---------------------------------------------------------------------------

function handleList(workdir: string): ToolResult {
  const storePath = path.join(workdir, "aftercare.json");
  const store = loadJson<AftercarStore>(storePath) ?? {};
  const all = Object.values(store);

  if (all.length === 0) return { ok: true, output: "No aftercare records yet.", data: { records: [] } };

  const byStatus: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  for (const r of all) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    if (r.tier) byTier[r.tier] = (byTier[r.tier] ?? 0) + 1;
  }

  const lines = [
    `Aftercare (${all.length} total):`,
    `  Status: ${Object.entries(byStatus).map(([s, n]) => `${s}: ${n}`).join(", ")}`,
    `  Tiers:  ${Object.entries(byTier).map(([t, n]) => `${t}: ${n}`).join(", ") || "—"}`,
    ``,
    `Active records:`,
    ...all
      .filter((r) => ["active", "inactive_flagged", "upgrade_flagged"].includes(r.status))
      .map((r) => {
        const day = daysFromEnrollment(r.enrolledAt);
        const tierLabel = r.tier ? ` [${r.tier}]` : "";
        const phase = r.phase ? ` (${r.phase})` : "";
        return `  • ${r.leadDisplayName}${tierLabel} — ${r.oar} Day ${day}${phase} — ${r.status}`;
      }),
  ];

  return {
    ok: true,
    output: lines.join("\n"),
    data: { total: all.length, byStatus, byTier },
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

  logger.info("tiger_aftercare called", { action });

  try {
    switch (action) {
      case "enroll":
        return handleEnroll(params as unknown as EnrollParams, workdir, logger);

      case "check":
        return handleCheck(workdir, logger);

      case "mark_sent":
        return handleMarkSent(params as unknown as MarkSentParams, workdir, logger);

      case "record_signal":
        return handleRecordSignal(params as unknown as RecordSignalParams, workdir, logger);

      case "set_tier":
        return handleSetTier(params as unknown as SetTierParams, workdir, logger);

      case "list":
        return handleList(workdir);

      default:
        return {
          ok: false,
          error: `Unknown action: "${action}". Valid: enroll | check | mark_sent | record_signal | set_tier | list`,
        };
    }
  } catch (err) {
    logger.error("tiger_aftercare error", { action, err: String(err) });
    return {
      ok: false,
      error: `tiger_aftercare error in action "${action}": ${String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// AgentTool export (OpenClaw interface)
// ---------------------------------------------------------------------------

export const tiger_aftercare = {
  name: "tiger_aftercare",
  description:
    "Stage 5 Retention & Aftercare. Two tracks. TRACK A (builder): 16 touches over 6 months — Day 1-7 welcome, Day 8-30 skill building, Day 31-90 momentum, then ongoing check-ins. Flags inactive (2 no-responses) and high performers to tenant. TRACK B (customer): Bronze → Silver → Gold auto-tiering. Bronze=welcome+referral ask. Silver=7-touch referral campaign+upsell. Gold=annual plan+quarterly review+VIP. Tier promotion auto-triggers on purchase/referral thresholds; tenant can override. Customer-to-builder upgrade detection: 3+ referrals or builder signals → flag to tenant. Cron calls check daily.",

  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["enroll", "check", "mark_sent", "record_signal", "set_tier", "list"],
        description:
          "enroll: start aftercare for a converted lead. check: cron daily — surfaces due touches. mark_sent: confirm touch delivered. record_signal: log purchase/referral/builder-signal/positive-response/no-response — triggers auto-tier promotion and upgrade flags. set_tier: tenant override for customer tier. list: show all aftercare.",
      },
      leadId: {
        type: "string",
        description: "Lead UUID. Required for enroll.",
      },
      oar: {
        type: "string",
        enum: ["builder", "customer"],
        description: "Which track to enroll in. Required for enroll.",
      },
      tier: {
        type: "string",
        enum: ["bronze", "silver", "gold"],
        description: "Starting tier for customer enroll, or target tier for set_tier. Defaults to bronze.",
      },
      aftercareId: {
        type: "string",
        description: "Aftercare record UUID. Required for mark_sent, record_signal, set_tier.",
      },
      touchNumber: {
        type: "number",
        description: "Touch sequence number. Required for mark_sent. Optional for record_signal (to log response against a specific touch).",
      },
      signalType: {
        type: "string",
        enum: ["purchase", "referral", "builder_signal", "positive_response", "no_response", "high_performer"],
        description:
          "purchase: customer bought again (Track B tier trigger). referral: gave a name (tier trigger + upgrade detection). builder_signal: asked about business side (upgrade detection). positive_response: engaged positively. no_response: no reply (inactive detection). high_performer: consistently active builder.",
      },
      notes: {
        type: "string",
        description: "Optional context note for the signal.",
      },
      reason: {
        type: "string",
        description: "Reason for manual tier change (set_tier).",
      },
    },
    required: ["action"],
  },

  execute,
};

export default tiger_aftercare;
