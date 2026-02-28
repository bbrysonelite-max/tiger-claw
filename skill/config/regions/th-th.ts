// Tiger Claw — Thailand Region Config (th-th)
// Thailand, Thai — TIGERCLAW-MASTER-SPEC-v2.md Block 2.4
//
// Primary channels: LINE, Telegram
// Discovery sources: Facebook Groups, LINE OpenChat, Telegram
// LINE channel auto-detects Thai language (built into OpenClaw)
// Compliance: PDPA (Personal Data Protection Act B.E. 2562)

import type { RegionalConfig } from "../types.js";

export const TH_TH_CONFIG: RegionalConfig = {
  code: "th-th",
  language: "th",
  languageName: "Thai",
  primaryChannels: ["line", "telegram"],

  discovery: {
    activeSources: ["facebook_groups", "line_openchat", "telegram"],
    dailyLeadTarget: 10,
    rateLimitPerSource: 20,
  },

  timingNorms: {
    businessHourStart: 9,
    businessHourEnd: 21,   // Thai communication norms allow slightly later evening contact
    preferredContactDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  },

  patternInterrupts: [
    {
      name: "The Wisdom of the Elephant",
      moments: ["stall", "pre_takeaway", "general"],
      storyTemplate: [
        `มีคำถามที่อยากให้คิดก่อนนะครับ/ค่ะ`,
        ``,
        `ช้างที่ถูกผูกด้วยเชือกเล็กๆ ตั้งแต่ยังเล็ก โตมาก็ไม่เคยพยายามหนี ทั้งที่ตอนนี้แข็งแรงพอจะดึงเสาทั้งต้นได้`,
        ``,
        `ทำไมน่ะหรือ? เพราะมันเชื่อว่าหนีไม่ได้ ตั้งแต่ยังเล็ก`,
        ``,
        `บางครั้งสิ่งที่กั้นเราไม่ใช่ความจริง แต่เป็นความเชื่อที่เราแบกมาโดยไม่รู้ตัว`,
        ``,
        `{tenantName} อยากให้คุณลองมองด้วยสายตาใหม่สักครั้งนึง`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Rice Paddy Principle",
      moments: ["stall", "general"],
      storyTemplate: [
        `{tenantName} เคยเล่าให้ฟังว่า...`,
        ``,
        `ชาวนาที่ปลูกข้าวไม่เคยยืนมองนาแล้วหวังว่าข้าวจะโต ต้องลงมือดำนา ใส่ปุ๋ย รดน้ำทุกวัน`,
        ``,
        `ธุรกิจนี้ก็เหมือนกัน ผลลัพธ์มาจากการลงมือทำทุกวัน ไม่ใช่จากการรอเวลา`,
        ``,
        `คุณพร้อมจะลงมือหรือยัง?`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
  ],

  complianceNotes: [
    "PDPA (พ.ร.บ. คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562): ต้องได้รับความยินยอมในการเก็บและใช้ข้อมูลส่วนบุคคล",
    "PDPA: Data subjects have the right to erasure (right to be forgotten).",
    "No collecting sensitive personal data (health, financial) without explicit consent.",
    "Agent identifies as AI — not a human. Always. (LOCKED.)",
    "Opt-out responses result in permanent no-contact flag and data deletion on request.",
  ],

  culturalNotes: [
    "Thai communication norms: relationship-first, face-saving, indirect refusal is common.",
    "Respect hierarchy — address with appropriate particles (ครับ/ค่ะ). The bot should adapt.",
    "Sanuk (สนุก) principle: interactions should feel light and enjoyable, not pressured.",
    "Family and community references land well. 'Taking care of your family' framing resonates.",
    "Hard sells feel aggressive. Gentle persistence, warmth, and patience are more effective.",
    "LINE is the dominant platform. Stickers and casual tone are acceptable on LINE.",
    "Buddhist cultural context: karma, merit, long-term thinking are resonant frames.",
  ].join(" "),
};
