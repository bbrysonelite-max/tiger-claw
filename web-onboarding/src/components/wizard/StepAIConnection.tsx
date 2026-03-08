"use client";

import { useState } from "react";
import { Check, X, Shield, ExternalLink, ArrowRight, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { WizardState } from "../OnboardingModal";

interface AIConnectionProps {
    state: WizardState;
    updateState: (updates: Partial<WizardState>) => void;
    onNext: () => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function StepAIConnection({ state, updateState, onNext }: AIConnectionProps) {
    const [isValidating, setIsValidating] = useState(false);
    const [validationResult, setValidationResult] = useState<"success" | "error" | null>(null);
    const [errorMessage, setErrorMessage] = useState("");

    const handleKeyChange = (key: string) => {
        updateState({ apiKey: key });
        setValidationResult(null);
        setErrorMessage("");
    };

    const validateKey = async () => {
        if (!state.apiKey) return;

        setIsValidating(true);
        setValidationResult(null);
        setErrorMessage("");

        try {
            const res = await fetch(`${API_BASE}/wizard/validate-key`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    provider: "google",
                    key: state.apiKey,
                    botId: state.botId ?? "pending", // Will be assigned after checkout
                }),
            });

            const data = await res.json();

            if (data.valid) {
                setValidationResult("success");
            } else {
                setValidationResult("error");
                setErrorMessage(data.error ?? "Key validation failed. Please try again.");
            }
        } catch (err: any) {
            setValidationResult("error");
            setErrorMessage("Network error — could not reach the server. Try again.");
        } finally {
            setIsValidating(false);
        }
    };

    const canProceed = validationResult === "success";

    return (
        <div className="flex flex-col h-full animate-fade-in">
            <div className="mb-6">
                <h3 className="text-2xl font-bold mb-2 text-white">Connect Your AI Engine</h3>
                <p className="text-white/50 text-base leading-relaxed">
                    Tiger Claw runs on Google Gemini. Paste your Google API key below — we encrypt it with AES-256-GCM and never store or log it in plaintext.
                </p>
            </div>

            <div className="space-y-4 flex-1">
                {/* BYOK — Google Only */}
                <div className="w-full flex flex-col p-5 rounded-2xl border bg-[#22c55e]/10 border-[#22c55e] ring-1 ring-[#22c55e]/50 text-white">
                    <div className="flex items-start text-left w-full">
                        <div className="mt-1 h-5 w-5 rounded-full border border-[#22c55e] bg-[#22c55e] text-black flex items-center justify-center mr-4 flex-shrink-0">
                            <Check className="h-3 w-3 font-bold" />
                        </div>
                        <div className="flex-1 w-full">
                            <h4 className="font-semibold text-lg flex items-center gap-2">
                                <Shield className="h-4 w-4 text-[#22c55e]" /> Bring Your Own Key (BYOK)
                            </h4>
                            <p className="text-sm opacity-70 mt-1 leading-relaxed">
                                Use your own Google API key. We encrypt it server-side. No markup on usage.
                            </p>
                        </div>
                    </div>

                    <motion.div
                        initial={{ height: 0, opacity: 0, marginTop: 0 }}
                        animate={{ height: "auto", opacity: 1, marginTop: 20 }}
                        className="overflow-hidden space-y-4 ml-9"
                    >
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-white/50 mb-2 uppercase tracking-wider">Provider</label>
                                <div className="w-full bg-black/50 border border-white/10 rounded-lg p-3 text-sm text-white/80">
                                    Google Gemini
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-white/50 mb-2 uppercase tracking-wider">Model</label>
                                <div className="w-full bg-black/50 border border-white/10 rounded-lg p-3 text-sm text-white/80">
                                    gemini-2.5-flash
                                </div>
                            </div>
                        </div>

                        <div>
                            <div className="flex justify-between items-center mb-2">
                                <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider">Google API Key</label>
                                <a
                                    href="https://aistudio.google.com/apikey"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-[#22c55e] hover:underline flex items-center gap-1 group relative z-10 pointer-events-auto"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    Get API Key <ExternalLink className="h-3 w-3 group-hover:translate-x-[1px] transition-transform" />
                                </a>
                            </div>
                            <div className="relative">
                                <input
                                    type="password"
                                    className={`w-full bg-black/50 border rounded-lg p-3 text-sm pr-10 outline-none transition-colors font-mono tracking-wider relative z-10 pointer-events-auto ${validationResult === 'error' ? 'border-red-500 focus:border-red-500' :
                                        validationResult === 'success' ? 'border-[#22c55e] focus:border-[#22c55e]' :
                                            'border-white/10 focus:border-[#22c55e]'
                                        }`}
                                    placeholder="AIza..."
                                    value={state.apiKey}
                                    onChange={(e) => handleKeyChange(e.target.value)}
                                    autoComplete="off"
                                    spellCheck="false"
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none z-20">
                                    {isValidating && <Loader2 className="h-4 w-4 animate-spin text-[#22c55e]" />}
                                    {validationResult === "success" && !isValidating && <Check className="h-4 w-4 text-[#22c55e]" />}
                                    {validationResult === "error" && !isValidating && <X className="h-4 w-4 text-red-500" />}
                                </div>
                            </div>
                            {validationResult === "error" && (
                                <p className="text-xs text-red-500 mt-2">{errorMessage}</p>
                            )}
                            {validationResult === "success" && (
                                <p className="text-xs text-[#22c55e] mt-2 flex items-center gap-1">
                                    <Shield className="h-3 w-3" /> Key validated — encrypted and stored securely
                                </p>
                            )}
                            {!validationResult && state.apiKey.length > 5 && !isValidating && (
                                <button
                                    onClick={validateKey}
                                    className="mt-2 text-xs text-[#22c55e] hover:underline font-semibold"
                                >
                                    Validate Key →
                                </button>
                            )}
                        </div>

                        <p className="text-xs text-white/30 flex items-center gap-2 pt-2 border-t border-white/10">
                            <Shield className="h-3 w-3" /> We encrypt keys with AES-256-GCM. Never logged, never shared.
                        </p>
                    </motion.div>
                </div>
            </div>

            <div className="mt-8 flex justify-end">
                <button
                    onClick={onNext}
                    disabled={!canProceed}
                    className="group relative inline-flex h-12 items-center justify-center overflow-hidden rounded-full font-bold px-8 bg-primary text-black transition-all disabled:opacity-50 disabled:cursor-not-allowed hover:scale-105 active:scale-95"
                >
                    <span className="relative z-10 flex items-center gap-2">
                        Continue <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </span>
                </button>
            </div>
        </div>
    );
}
