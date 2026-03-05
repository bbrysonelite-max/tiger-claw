"use client";

import { useState, useEffect } from "react";
import { Check, X, Shield, Cpu, ExternalLink, ArrowRight, Loader2, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { WizardState } from "../OnboardingModal";

interface AIConnectionProps {
    state: WizardState;
    updateState: (updates: Partial<WizardState>) => void;
    onNext: () => void;
}

const keyPatterns: Record<string, RegExp> = {
    openai: /^sk-[a-zA-Z0-9]{32,}$/,
    anthropic: /^sk-ant-[a-zA-Z0-9\-_]{90,}$/,
    google: /^AIza[a-zA-Z0-9\-_]{35}$/,
    xai: /^xai-[a-zA-Z0-9]{40,}$/
};

const providerModels: Record<string, string[]> = {
    openai: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"],
    anthropic: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-3-5-haiku-20241022"],
    google: ["gemini-2.0-flash", "gemini-1.5-pro"],
    xai: ["grok-3", "grok-2"]
};

export default function StepAIConnection({ state, updateState, onNext }: AIConnectionProps) {
    const [isValidating, setIsValidating] = useState(false);
    const [validationResult, setValidationResult] = useState<"success" | "error" | null>(null);
    const [errorMessage, setErrorMessage] = useState("");

    const handleProviderChange = (provider: string) => {
        updateState({
            aiProvider: provider,
            aiModel: providerModels[provider][0],
            apiKey: "" // Reset key on provider change
        });
        setValidationResult(null);
    };

    const handleKeyChange = (key: string) => {
        updateState({ apiKey: key });
        setValidationResult(null);
        setErrorMessage("");
    };

    // Debounced validation mock
    useEffect(() => {
        if (state.connectionType === "byok" && state.apiKey) {
            const pattern = keyPatterns[state.aiProvider];
            if (pattern && pattern.test(state.apiKey)) {
                setIsValidating(true);
                const timer = setTimeout(() => {
                    setIsValidating(false);
                    // In a real app, we'd hit /api/keys/validate here
                    setValidationResult("success");
                }, 800);
                return () => clearTimeout(timer);
            } else if (state.apiKey.length > 10) {
                setValidationResult("error");
                setErrorMessage("Format doesn't match expected pattern for this provider");
            }
        }
    }, [state.apiKey, state.aiProvider, state.connectionType]);

    const canProceed =
        state.connectionType === "tiger_credits" ||
        (state.connectionType === "byok" && validationResult === "success");

    return (
        <div className="flex flex-col h-full animate-fade-in">
            <div className="mb-6">
                <h3 className="text-2xl font-bold mb-2 text-white">AI Engine Connection</h3>
                <p className="text-white/50 text-base leading-relaxed">
                    Choose how you want to power your agent. Use our managed credits, or Bring Your Own Key (BYOK) for maximum privacy.
                </p>
            </div>

            <div className="space-y-4 flex-1">
                {/* Tiger Credits Option */}
                <button
                    onClick={() => { updateState({ connectionType: "tiger_credits" }); setValidationResult(null); }}
                    className={`w-full flex items-start p-5 rounded-2xl border text-left transition-all relative overflow-hidden ${state.connectionType === "tiger_credits"
                        ? "bg-primary/10 border-primary ring-1 ring-primary/50 text-white"
                        : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                        }`}
                >
                    <div className={`mt-1 h-5 w-5 rounded-full border flex items-center justify-center mr-4 flex-shrink-0 ${state.connectionType === "tiger_credits" ? "border-primary bg-primary text-black" : "border-white/30"
                        }`}>
                        {state.connectionType === "tiger_credits" && <Check className="h-3 w-3 font-bold" />}
                    </div>
                    <div>
                        <h4 className="font-semibold text-lg flex items-center gap-2">
                            <Zap className="h-4 w-4 text-primary" /> Tiger Claw Credits
                        </h4>
                        <p className="text-sm opacity-70 mt-1 leading-relaxed">
                            $97/mo includes ~$10 of AI usage. Additional usage billed at cost + 20%. Zero setup required.
                        </p>
                    </div>
                </button>

                {/* BYOK Option */}
                <div className={`w-full flex flex-col p-5 rounded-2xl border transition-all ${state.connectionType === "byok"
                    ? "bg-[#22c55e]/10 border-[#22c55e] ring-1 ring-[#22c55e]/50 text-white"
                    : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                    }`}>
                    <button
                        onClick={() => updateState({ connectionType: "byok" })}
                        className="flex items-start text-left w-full focus:outline-none"
                    >
                        <div className={`mt-1 h-5 w-5 rounded-full border flex items-center justify-center mr-4 flex-shrink-0 ${state.connectionType === "byok" ? "border-[#22c55e] bg-[#22c55e] text-black" : "border-white/30"
                            }`}>
                            {state.connectionType === "byok" && <Check className="h-3 w-3 font-bold" />}
                        </div>
                        <div className="flex-1 w-full">
                            <h4 className="font-semibold text-lg flex items-center gap-2">
                                <Shield className="h-4 w-4 text-[#22c55e]" /> Bring Your Own Key
                            </h4>
                            <p className="text-sm opacity-70 mt-1 leading-relaxed">
                                Use your own provider account. We encrypt your key Server-Side securely. No markup on usage.
                            </p>
                        </div>
                    </button>

                    <AnimatePresence>
                        {state.connectionType === "byok" && (
                            <motion.div
                                initial={{ height: 0, opacity: 0, marginTop: 0 }}
                                animate={{ height: "auto", opacity: 1, marginTop: 20 }}
                                exit={{ height: 0, opacity: 0, marginTop: 0 }}
                                className="overflow-hidden space-y-4 ml-9"
                            >
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-semibold text-white/50 mb-2 uppercase tracking-wider">Provider</label>
                                        <select
                                            className="w-full bg-black/50 border border-white/10 rounded-lg p-3 text-sm focus:border-[#22c55e] outline-none transition-colors max-h-40 overflow-y-auto z-50 appearance-none"
                                            value={state.aiProvider}
                                            onChange={(e) => handleProviderChange(e.target.value)}
                                        >
                                            <option value="openai">OpenAI</option>
                                            <option value="anthropic">Anthropic</option>
                                            <option value="google">Google</option>
                                            <option value="xai">xAI</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-white/50 mb-2 uppercase tracking-wider">Model</label>
                                        <select
                                            className="w-full bg-black/50 border border-white/10 rounded-lg p-3 text-sm focus:border-[#22c55e] outline-none transition-colors appearance-none"
                                            value={state.aiModel}
                                            onChange={(e) => updateState({ aiModel: e.target.value })}
                                        >
                                            {providerModels[state.aiProvider].map(model => (
                                                <option key={model} value={model}>{model}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>

                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <label className="block text-xs font-semibold text-white/50 uppercase tracking-wider">API Key</label>
                                        <a href="#" className="text-xs text-[#22c55e] hover:underline flex items-center gap-1 group relative z-10 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
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
                                            placeholder={`e.g. ${state.aiProvider === 'openai' ? 'sk-...' : 'sk-ant-...'}`}
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
                                            <Shield className="h-3 w-3" /> Valid Key — {state.aiModel} selected
                                        </p>
                                    )}
                                </div>

                                <p className="text-xs text-white/30 flex items-center gap-2 pt-2 border-t border-white/10">
                                    <Shield className="h-3 w-3" /> We encrypt keys with AES-256-GCM. Never logged, never shared.
                                </p>
                            </motion.div>
                        )}
                    </AnimatePresence>
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
