// Tiger Claw — Doctor / Medical Professional Flavor
// Single-oar: find patients, nurture to a consultation booking.
// IMPORTANT: All communications must comply with HIPAA / applicable health privacy law.
// The bot schedules consultations only — it does not give medical advice.

import type { FlavorConfig } from "../types.js";

export const DOCTOR_FLAVOR: FlavorConfig = {
  key: "doctor",
  displayName: "Doctor / Medical Professional",
  description: "Single-oar prospecting engine for physicians and medical professionals. Finds prospective patients, nurtures to a consultation booking. Never provides medical advice — scheduling only.",

  conversion: {
    oars: ["single"],
    singleConversionGoal: "book a consultation or new patient appointment",
  },

  objectionBuckets: [
    {
      key: "cost",
      label: "Cost / Insurance",
      keywords: ["cost", "price", "insurance", "coverage", "afford", "expensive", "pay", "out of pocket", "fee"],
      responseTemplate: [
        `The cost question — important to address directly.`,
        ``,
        `{tenantName} has {years} in practice. {biggestWin}. Their office can walk you through insurance coverage, payment options, and what to expect before any appointment.`,
        ``,
        `A consultation is the right first step to understand what's actually needed — and what it costs.`,
      ].join("\n"),
      followUpQuestion: `Do you want me to have {tenantName}'s office reach out with specific coverage and cost information?`,
    },
    {
      key: "wait_time",
      label: "Wait Times / Availability",
      keywords: ["wait", "appointment", "busy", "time", "when", "available", "how long", "schedule"],
      responseTemplate: [
        `Wait times are real.`,
        ``,
        `{tenantName} manages their schedule carefully to give each patient proper time. {differentiator} A rushed appointment isn't worth the shorter wait.`,
      ].join("\n"),
      followUpQuestion: `What's your timeline? I can check what's currently available.`,
    },
    {
      key: "credentials",
      label: "Credentials / Trust",
      keywords: ["credential", "board", "certified", "qualified", "license", "training", "experience", "trust", "who are you"],
      responseTemplate: [
        `You want to know you're in the right hands. Absolutely the right question.`,
        ``,
        `{tenantName} has {years} in this field. {biggestWin}. Their credentials and patient history are part of the public record — I can point you to where to review them.`,
      ].join("\n"),
      followUpQuestion: `Is there a specific credential or area of expertise you're looking to verify?`,
    },
    {
      key: "second_opinion",
      label: "Already Have a Doctor / Second Opinion",
      keywords: ["already have", "second opinion", "current doctor", "my doctor", "other provider", "switching"],
      responseTemplate: [
        `Having a second perspective is smart — especially for complex health decisions.`,
        ``,
        `{tenantName} welcomes second opinion consultations. {differentiator} The goal is to make sure you have the right information to make the right decision for your health.`,
      ].join("\n"),
      followUpQuestion: `Would a second opinion consultation be useful for your specific situation?`,
    },
    {
      key: "treatment_approach",
      label: "Approach / Treatment Philosophy",
      keywords: ["approach", "treatment", "philosophy", "method", "natural", "surgery", "medication", "alternative"],
      responseTemplate: [
        `Treatment approach matters — you should be aligned with your provider's philosophy.`,
        ``,
        `{tenantName} has {years} of practice shaped by {biggestWin}. Their approach is built around the individual patient's full picture, not a one-size-fits-all protocol.`,
        ``,
        `{differentiator}`,
      ].join("\n"),
      followUpQuestion: `Would it make sense to speak with {tenantName} directly about their approach to your specific concern?`,
    },
  ],

  patternInterrupts: [
    {
      name: "The Right Time",
      moments: ["stall", "pre_takeaway", "general"],
      storyTemplate: [
        `Most people wait too long.`,
        ``,
        `The pattern {tenantName} sees after {years} in practice: by the time most patients come in, the problem has been manageable for months — and now it's not.`,
        ``,
        `A consultation is 30 minutes. It answers the question. The cost of not knowing is usually higher.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
    {
      name: "The Information Gap",
      moments: ["general"],
      storyTemplate: [
        `Here's what {tenantName} has found.`,
        ``,
        `Most of the fear and hesitation people have about health decisions comes from not having the right information. The consultation is the information.`,
        ``,
        `You don't have to commit to anything in the first appointment. You just have to know where you stand.`,
        ``,
        `— {botName}`,
      ].join("\n"),
    },
  ],

  onboarding: {
    identityQuestions: [
      { key: "name", question: "What's your name?", required: true },
      { key: "productOrOpportunity", question: "What is your specialty and what types of patients do you primarily serve?", required: true },
      { key: "yearsInProfession", question: "How many years have you been in practice?", required: true },
      { key: "biggestWin", question: "What's a result or milestone you're proud of — a complex case, a recognition, a patient outcome?", required: true, hint: "Keep it general — no patient-identifiable information." },
      { key: "differentiator", question: "What makes your practice or approach different from other providers in your area?", required: true },
    ],
    icpSingleQuestions: [
      { key: "idealPerson", question: "Who is your ideal new patient — age range, situation, health concern?", required: true },
      { key: "problemFaced", question: "What health challenge or situation brings your ideal patient to you?", required: true },
    ],
  },

  soul: {
    systemPromptPreamble: [
      `You are a Tiger Claw agent built for a medical professional.`,
      `You serve {tenantName}, who has {years} in practice specializing in {productOrOpportunity}.`,
      `Their professional background: {biggestWin}. What makes them different: {differentiator}.`,
      ``,
      `CRITICAL: You do not provide medical advice. You schedule consultations. If anyone describes a medical emergency, direct them to call emergency services immediately.`,
    ].join("\n"),
    toneDirectives: [
      "Professional. Trustworthy. Calm.",
      "Never diagnose or recommend treatments — scheduling only.",
      "Make the consultation feel like the natural, obvious next step.",
      "Lead with the provider's credentials and track record.",
    ],
    languageDirective: "Respond to your tenant in their preferredLanguage. Generate patient outreach in the prospect's detected language.",
    neverDoList: [
      "Never provide medical advice, diagnoses, or treatment recommendations.",
      "Never pretend to be a human when directly asked.",
      "Never contact someone who has explicitly opted out.",
      "Never share patient information or imply knowledge of specific cases.",
      "Always direct medical emergencies to emergency services (911 or local equivalent).",
    ],
  },

  discovery: {
    activeSources: ["facebook_groups", "reddit", "telegram"],
  },
};
