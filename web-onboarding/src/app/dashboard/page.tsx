"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
    Bot, MessageCircle, Shield, Settings, ExternalLink,
    Activity, Zap, Globe, ArrowRight, Loader2, AlertCircle,
    CheckCircle2, XCircle, Clock, Key, RefreshCw, Copy, Check,
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

interface DashboardData {
    tenant: {
        id: string;
        slug: string;
        name: string;
        status: string;
        flavor: string;
        region: string;
        language: string;
        preferredChannel: string;
        createdAt: string;
        lastActivityAt: string | null;
    };
    bot: {
        username: string | null;
        telegramLink: string | null;
        isLive: boolean;
    };
    apiKey: {
        configured: boolean;
        provider: string | null;
        model: string | null;
        keyPreview: string | null;
        connectionType: string | null;
        lastUpdated: string | null;
    };
    channels: {
        telegram: { enabled: boolean; botUsername: string | null };
        whatsapp: { enabled: boolean };
        line: { configured: boolean; webhookUrl: string };
    };
    subscription: {
        plan: string;
        status: string;
    };
    wizardUrl: string;
    channelConfigUrl: string;
}

export default function DashboardPage() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [lineWizardOpen, setLineWizardOpen] = useState(false);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const slug = params.get("slug") ?? params.get("s");

        if (!slug) {
            setError("Missing slug parameter. Access your dashboard via /dashboard?slug=your-slug");
            setLoading(false);
            return;
        }

        fetch(`${API_BASE}/dashboard/${slug}`)
            .then((r) => r.json())
            .then((d) => {
                if (d.error) {
                    setError(d.error);
                } else {
                    setData(d);
                }
            })
            .catch((e) => setError(`Could not reach server: ${e.message}`))
            .finally(() => setLoading(false));
    }, []);

    if (loading) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (error || !data) {
        return (
            <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4">
                <div className="bg-red-500/10 border border-red-500/30 rounded-2xl p-8 max-w-md text-center">
                    <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-white mb-2">Dashboard Error</h2>
                    <p className="text-red-400 text-sm">{error}</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-zinc-950 text-white">
            {/* Header */}
            <header className="border-b border-white/10 bg-zinc-950/80 backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-primary/20 flex items-center justify-center border border-primary/30">
                            <Bot className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                            <h1 className="font-bold text-lg">{data.tenant.name}</h1>
                            <p className="text-white/40 text-xs">{data.tenant.slug}</p>
                        </div>
                    </div>
                    <StatusBadge status={data.tenant.status} />
                </div>
            </header>

            <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
                {/* Bot Status Hero */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-gradient-to-br from-zinc-900 to-zinc-950 border border-white/10 rounded-2xl p-8 relative overflow-hidden"
                >
                    <div className="absolute top-0 right-0 w-48 h-48 bg-primary/10 rounded-full blur-[80px] pointer-events-none" />

                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
                        <div className="flex items-center gap-5">
                            <div className={`h-16 w-16 rounded-2xl flex items-center justify-center border ${data.bot.isLive
                                ? "bg-[#22c55e]/10 border-[#22c55e]/30"
                                : "bg-white/5 border-white/10"
                                }`}>
                                <Bot className={`h-8 w-8 ${data.bot.isLive ? "text-[#22c55e]" : "text-white/30"}`} />
                            </div>
                            <div>
                                <h2 className="text-2xl font-bold flex items-center gap-3">
                                    {data.bot.username ?? "Pending Assignment"}
                                    {data.bot.isLive && (
                                        <span className="relative flex h-3 w-3">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#22c55e] opacity-75" />
                                            <span className="relative inline-flex rounded-full h-3 w-3 bg-[#22c55e]" />
                                        </span>
                                    )}
                                </h2>
                                <p className="text-white/50 mt-1">
                                    {data.tenant.flavor.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())} Agent
                                    · {data.tenant.region.toUpperCase()}
                                </p>
                            </div>
                        </div>

                        {data.bot.telegramLink && (
                            <a
                                href={data.bot.telegramLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#22c55e]/10 border border-[#22c55e]/30 text-[#22c55e] font-semibold hover:bg-[#22c55e]/20 transition-colors"
                            >
                                <MessageCircle className="h-5 w-5" />
                                Open in Telegram
                                <ExternalLink className="h-4 w-4" />
                            </a>
                        )}
                    </div>
                </motion.div>

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <StatCard
                        icon={<Activity className="h-5 w-5 text-primary" />}
                        title="Status"
                        value={data.tenant.status.charAt(0).toUpperCase() + data.tenant.status.slice(1)}
                        subtitle={data.tenant.lastActivityAt
                            ? `Last active ${timeAgo(data.tenant.lastActivityAt)}`
                            : "Awaiting first message"
                        }
                    />
                    <StatCard
                        icon={<Shield className="h-5 w-5 text-[#22c55e]" />}
                        title="AI Engine"
                        value={data.apiKey.provider
                            ? `${data.apiKey.provider.charAt(0).toUpperCase() + data.apiKey.provider.slice(1)} Gemini`
                            : "Google Gemini"
                        }
                        subtitle={data.apiKey.model ?? "gemini-2.5-flash"}
                    />
                    <StatCard
                        icon={<Zap className="h-5 w-5 text-amber-400" />}
                        title="Subscription"
                        value="$47/mo"
                        subtitle={`${data.subscription.status === "active" ? "Active" : data.subscription.status} · BYOK Basic`}
                    />
                </div>

                {/* API Key Status */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 }}
                >
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                        <Key className="h-5 w-5 text-white/50" />
                        API Key
                    </h3>
                    <div className={`rounded-2xl p-6 border ${data.apiKey.configured
                        ? "bg-[#22c55e]/5 border-[#22c55e]/20"
                        : "bg-amber-500/5 border-amber-500/20"
                        }`}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                                <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${data.apiKey.configured
                                    ? "bg-[#22c55e]/10 border border-[#22c55e]/20"
                                    : "bg-amber-500/10 border border-amber-500/20"
                                    }`}>
                                    {data.apiKey.configured
                                        ? <CheckCircle2 className="h-5 w-5 text-[#22c55e]" />
                                        : <AlertCircle className="h-5 w-5 text-amber-400" />
                                    }
                                </div>
                                <div>
                                    <p className="font-semibold text-white">
                                        {data.apiKey.configured ? "Key Active & Encrypted" : "No API Key Configured"}
                                    </p>
                                    <p className="text-white/40 text-sm">
                                        {data.apiKey.configured
                                            ? `${data.apiKey.keyPreview ?? "***"} · AES-256-GCM encrypted · ${data.apiKey.lastUpdated ? `Updated ${timeAgo(data.apiKey.lastUpdated)}` : ""
                                            }`
                                            : "Your agent is using the platform onboarding key (limited). Add your own key for unlimited usage."
                                        }
                                    </p>
                                </div>
                            </div>
                            {!data.apiKey.configured && (
                                <a
                                    href="https://aistudio.google.com/apikey"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-amber-400 text-sm font-semibold hover:underline whitespace-nowrap"
                                >
                                    Get API Key <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
                        </div>
                    </div>
                </motion.div>

                {/* Channels */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                        <Globe className="h-5 w-5 text-white/50" />
                        Channels
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <ChannelCard
                            name="Telegram"
                            emoji="✈️"
                            enabled={data.channels.telegram.enabled}
                            detail={data.channels.telegram.botUsername
                                ? `@${data.channels.telegram.botUsername}`
                                : "Pending"
                            }
                        />
                        <ChannelCard
                            name="WhatsApp"
                            emoji="💬"
                            enabled={data.channels.whatsapp.enabled}
                            detail={data.channels.whatsapp.enabled ? "Enabled" : "Coming soon"}
                        />
                        <button
                            onClick={() => setLineWizardOpen(true)}
                            className="text-left w-full"
                        >
                            <ChannelCard
                                name="LINE"
                                emoji="🟢"
                                enabled={data.channels.line.configured}
                                detail={data.channels.line.configured ? "Configured" : "Set up now →"}
                                clickable
                            />
                        </button>
                    </div>
                </motion.div>

                {/* LINE Wizard Modal */}
                {lineWizardOpen && data && (
                    <LineWizardModal
                        slug={data.tenant.slug}
                        webhookUrl={data.channels.line.webhookUrl}
                        configured={data.channels.line.configured}
                        onClose={() => setLineWizardOpen(false)}
                        botTelegramLink={data.bot.telegramLink}
                    />
                )}

                {/* Quick Actions */}
                <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                >
                    <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                        <Settings className="h-5 w-5 text-white/50" />
                        Quick Actions
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <ActionCard
                            title="Channel Configuration"
                            description="Configure WhatsApp, LINE, and other channels"
                            href={data.channelConfigUrl}
                            icon={<Globe className="h-5 w-5" />}
                            external
                        />
                        <ActionCard
                            title="Talk to Your Bot"
                            description="Send a message to start a conversation"
                            href={data.bot.telegramLink ?? "#"}
                            icon={<MessageCircle className="h-5 w-5" />}
                            external
                        />
                    </div>
                </motion.div>

                {/* Footer */}
                <div className="border-t border-white/5 pt-6 pb-8">
                    <p className="text-white/20 text-xs text-center">
                        Agent created {new Date(data.tenant.createdAt).toLocaleDateString()} ·
                        Flavor: {data.tenant.flavor} ·
                        Region: {data.tenant.region} ·
                        Tiger Claw v4
                    </p>
                </div>
            </main>
        </div>
    );
}

// =============================================================================
// LINE Wizard Modal — 5-step guided setup (Locked Decision #15: HIGH PRIORITY)
// =============================================================================

function LineWizardModal({ slug, webhookUrl, configured, onClose, botTelegramLink }: {
    slug: string;
    webhookUrl: string;
    configured: boolean;
    onClose: () => void;
    botTelegramLink: string | null;
}) {
    const [step, setStep] = useState(1);
    const [channelSecret, setChannelSecret] = useState("");
    const [accessToken, setAccessToken] = useState("");
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState("");
    const [copied, setCopied] = useState(false);

    const totalSteps = 5;

    const copyWebhook = () => {
        navigator.clipboard.writeText(webhookUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const saveConfig = async () => {
        setSaving(true);
        setError("");
        try {
            const res = await fetch(`${API_BASE}/wizard/${slug}/save`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lineChannelSecret: channelSecret, lineChannelAccessToken: accessToken }),
            });
            const data = await res.json();
            if (data.ok) {
                setSaved(true);
                setStep(5);
            } else {
                setError(data.error ?? "Failed to save configuration");
            }
        } catch (e) {
            setError("Network error");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full max-w-lg bg-zinc-950 border border-white/10 rounded-3xl overflow-hidden shadow-2xl"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-6 border-b border-white/10">
                    <div>
                        <h2 className="font-bold text-lg">🟢 LINE Channel Setup</h2>
                        <p className="text-white/40 text-xs mt-1">Step {step} of {totalSteps}</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-white/50 hover:text-white transition-colors">
                        <XCircle className="h-5 w-5" />
                    </button>
                </div>

                {/* Progress */}
                <div className="w-full bg-white/5 h-1">
                    <div className="h-full bg-[#06C755] transition-all duration-300" style={{ width: `${(step / totalSteps) * 100}%` }} />
                </div>

                {/* Content */}
                <div className="p-6 min-h-[280px]">
                    {step === 1 && (
                        <StepContent
                            title="Open LINE Developers"
                            body="Go to the LINE Developers Console and sign in with your LINE account."
                        >
                            <a
                                href="https://developers.line.biz/console/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#06C755] text-white font-semibold hover:bg-[#06C755]/90 transition-colors text-sm"
                            >
                                Open LINE Developers <ExternalLink className="h-4 w-4" />
                            </a>
                        </StepContent>
                    )}

                    {step === 2 && (
                        <StepContent
                            title="Create Provider & Channel"
                            body="Create a new Provider (your business name), then create a Messaging API Channel under it."
                        >
                            <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white/60 space-y-2">
                                <p>1. Click <strong className="text-white">Create New Provider</strong></p>
                                <p>2. Enter your business name</p>
                                <p>3. Click <strong className="text-white">Create a Messaging API channel</strong></p>
                                <p>4. Fill in Channel name, description, and category</p>
                            </div>
                        </StepContent>
                    )}

                    {step === 3 && (
                        <StepContent
                            title="Enter Credentials"
                            body="Copy the Channel Secret and Channel Access Token from the LINE Developers Console."
                        >
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wider">Channel Secret</label>
                                    <input
                                        type="password"
                                        value={channelSecret}
                                        onChange={(e) => setChannelSecret(e.target.value)}
                                        placeholder="Found in Basic Settings tab"
                                        className="w-full bg-black/50 border border-white/10 rounded-lg p-3 text-sm font-mono outline-none focus:border-[#06C755] transition-colors"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-white/50 mb-1.5 uppercase tracking-wider">Channel Access Token</label>
                                    <input
                                        type="password"
                                        value={accessToken}
                                        onChange={(e) => setAccessToken(e.target.value)}
                                        placeholder="Click Issue in Messaging API tab"
                                        className="w-full bg-black/50 border border-white/10 rounded-lg p-3 text-sm font-mono outline-none focus:border-[#06C755] transition-colors"
                                    />
                                </div>
                            </div>
                        </StepContent>
                    )}

                    {step === 4 && (
                        <StepContent
                            title="Set Webhook URL"
                            body="In the LINE Developers Console, go to Messaging API → Webhook URL and paste this URL:"
                        >
                            <div className="bg-black/50 border border-white/10 rounded-xl p-4 flex items-center gap-3">
                                <code className="text-xs text-[#06C755] font-mono flex-1 break-all">{webhookUrl}</code>
                                <button
                                    onClick={copyWebhook}
                                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors flex-shrink-0"
                                >
                                    {copied ? <Check className="h-4 w-4 text-[#06C755]" /> : <Copy className="h-4 w-4 text-white/50" />}
                                </button>
                            </div>
                            <p className="text-white/30 text-xs mt-3">
                                Then click <strong className="text-white/60">Verify</strong> in the LINE console and enable <strong className="text-white/60">Use webhook</strong>.
                            </p>
                            {!saved && channelSecret && accessToken && (
                                <button
                                    onClick={saveConfig}
                                    disabled={saving}
                                    className="mt-4 w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#06C755] text-white font-semibold hover:bg-[#06C755]/90 transition-colors disabled:opacity-50"
                                >
                                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
                                    {saving ? "Saving..." : "Save & Encrypt Credentials"}
                                </button>
                            )}
                            {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
                        </StepContent>
                    )}

                    {step === 5 && (
                        <StepContent
                            title="LINE Connected! ✅"
                            body="Your agent is now listening on LINE. Send a message to your LINE Official Account to test."
                        >
                            <div className="bg-[#06C755]/10 border border-[#06C755]/20 rounded-xl p-4 text-center">
                                <p className="text-[#06C755] font-semibold text-lg mb-2">🎉 Setup Complete</p>
                                <p className="text-white/50 text-sm">
                                    Your Tiger Claw agent is now connected to LINE and Telegram simultaneously.
                                </p>
                            </div>
                            {botTelegramLink && (
                                <p className="text-white/30 text-xs mt-3 text-center">
                                    Need help? <a href={botTelegramLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Ask your agent on Telegram</a>
                                </p>
                            )}
                        </StepContent>
                    )}
                </div>

                {/* Footer Nav */}
                <div className="px-6 pb-6 flex justify-between items-center">
                    {step > 1 && step < 5 ? (
                        <button onClick={() => setStep(step - 1)} className="text-white/40 hover:text-white text-sm font-semibold transition-colors">
                            ← Back
                        </button>
                    ) : <div />}
                    {step < 4 && (
                        <button
                            onClick={() => setStep(step + 1)}
                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-sm transition-colors"
                        >
                            Next <ArrowRight className="h-4 w-4" />
                        </button>
                    )}
                    {step === 5 && (
                        <button
                            onClick={onClose}
                            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-black font-semibold text-sm hover:bg-primary/90 transition-colors"
                        >
                            Done <CheckCircle2 className="h-4 w-4" />
                        </button>
                    )}
                </div>
            </motion.div>
        </div>
    );
}

function StepContent({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
    return (
        <div className="space-y-4">
            <h3 className="text-xl font-bold text-white">{title}</h3>
            <p className="text-white/50 text-sm leading-relaxed">{body}</p>
            {children}
        </div>
    );
}

// =============================================================================
// Sub-components
// =============================================================================

function StatusBadge({ status }: { status: string }) {
    const colors: Record<string, string> = {
        active: "bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/30",
        onboarding: "bg-amber-500/10 text-amber-400 border-amber-500/30",
        suspended: "bg-red-500/10 text-red-400 border-red-500/30",
        pending: "bg-white/5 text-white/50 border-white/10",
    };
    const icons: Record<string, React.ReactNode> = {
        active: <CheckCircle2 className="h-3 w-3" />,
        onboarding: <Clock className="h-3 w-3" />,
        suspended: <XCircle className="h-3 w-3" />,
        pending: <Clock className="h-3 w-3" />,
    };

    return (
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border ${colors[status] ?? colors.pending}`}>
            {icons[status] ?? icons.pending}
            {status}
        </span>
    );
}

function StatCard({ icon, title, value, subtitle }: {
    icon: React.ReactNode;
    title: string;
    value: string;
    subtitle: string;
}) {
    return (
        <div className="bg-zinc-900/50 border border-white/5 rounded-2xl p-5 hover:border-white/10 transition-colors">
            <div className="flex items-center gap-2 mb-3">
                {icon}
                <span className="text-white/50 text-xs font-semibold uppercase tracking-wider">{title}</span>
            </div>
            <div className="text-xl font-bold text-white">{value}</div>
            <div className="text-white/40 text-xs mt-1">{subtitle}</div>
        </div>
    );
}

function ChannelCard({ name, emoji, enabled, detail, clickable }: {
    name: string;
    emoji: string;
    enabled: boolean;
    detail: string;
    clickable?: boolean;
}) {
    return (
        <div className={`rounded-2xl p-5 border transition-colors ${enabled
            ? "bg-[#22c55e]/5 border-[#22c55e]/20"
            : clickable
                ? "bg-zinc-900/50 border-white/5 hover:border-primary/30 hover:bg-primary/5 cursor-pointer"
                : "bg-zinc-900/50 border-white/5"
            }`}>
            <div className="flex items-center justify-between mb-2">
                <span className="text-lg">{emoji} {name}</span>
                <span className={`text-xs font-semibold uppercase tracking-wider ${enabled ? "text-[#22c55e]" : "text-white/30"
                    }`}>
                    {enabled ? "Active" : clickable ? "Setup" : "Off"}
                </span>
            </div>
            <p className={`text-sm ${clickable && !enabled ? "text-primary" : "text-white/50"}`}>{detail}</p>
        </div>
    );
}

function ActionCard({ title, description, href, icon, external }: {
    title: string;
    description: string;
    href: string;
    icon: React.ReactNode;
    external?: boolean;
}) {
    return (
        <a
            href={href}
            target={external ? "_blank" : undefined}
            rel={external ? "noopener noreferrer" : undefined}
            className="group bg-zinc-900/50 border border-white/5 rounded-2xl p-5 hover:border-primary/30 hover:bg-primary/5 transition-all flex items-center gap-4 cursor-pointer"
        >
            <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                {icon}
            </div>
            <div className="flex-1">
                <h4 className="font-semibold text-white group-hover:text-primary transition-colors">{title}</h4>
                <p className="text-white/40 text-sm">{description}</p>
            </div>
            <ArrowRight className="h-5 w-5 text-white/20 group-hover:text-primary group-hover:translate-x-1 transition-all" />
        </a>
    );
}

function timeAgo(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}
