"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
    Bot, MessageCircle, Shield, Settings, ExternalLink,
    Activity, Zap, Globe, ArrowRight, Loader2, AlertCircle,
    CheckCircle2, XCircle, Clock,
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
    channels: {
        telegram: { enabled: boolean; botUsername: string | null };
        whatsapp: { enabled: boolean };
        line: { configured: boolean };
    };
    subscription: {
        plan: string;
        status: string;
    };
}

export default function DashboardPage() {
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    // Get slug from URL path or query
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
                        value="Google Gemini"
                        subtitle="gemini-2.5-flash · BYOK Encrypted"
                    />
                    <StatCard
                        icon={<Zap className="h-5 w-5 text-amber-400" />}
                        title="Subscription"
                        value="$47/mo"
                        subtitle={`${data.subscription.status === "active" ? "Active" : data.subscription.status} · BYOK Basic`}
                    />
                </div>

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
                            detail={data.channels.whatsapp.enabled ? "Enabled" : "Not configured"}
                        />
                        <ChannelCard
                            name="LINE"
                            emoji="🟢"
                            enabled={data.channels.line.configured}
                            detail={data.channels.line.configured ? "Configured" : "Not configured"}
                        />
                    </div>
                </motion.div>

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
                            href={`/wizard/${data.tenant.slug}`}
                            icon={<Globe className="h-5 w-5" />}
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

                {/* Footer Info */}
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

// --- Sub-components ---

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

function ChannelCard({ name, emoji, enabled, detail }: {
    name: string;
    emoji: string;
    enabled: boolean;
    detail: string;
}) {
    return (
        <div className={`rounded-2xl p-5 border transition-colors ${enabled
                ? "bg-[#22c55e]/5 border-[#22c55e]/20"
                : "bg-zinc-900/50 border-white/5"
            }`}>
            <div className="flex items-center justify-between mb-2">
                <span className="text-lg">{emoji} {name}</span>
                <span className={`text-xs font-semibold uppercase tracking-wider ${enabled ? "text-[#22c55e]" : "text-white/30"
                    }`}>
                    {enabled ? "Active" : "Off"}
                </span>
            </div>
            <p className="text-white/50 text-sm">{detail}</p>
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
    const Tag = external ? "a" : "a";
    return (
        <Tag
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
        </Tag>
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
