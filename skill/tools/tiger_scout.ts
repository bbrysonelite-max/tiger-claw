// Tiger Claw — Scout Tool (Prospect Discovery)
// See specs/tiger-claw/TIGERCLAW-MASTER-SPEC-v2.md Block 3.4 for requirements
//
// This tool:
// - Searches configured discovery sources (Reddit, Facebook, LINE OpenChat, Telegram)
// - Sources determined by regional config
// - Scores each prospect against tenant's ICP
// - Only saves leads scoring 80+ (LOCKED threshold)
// - Deduplicates against last 30 days
// - Runs on cron (5 AM tenant timezone) AND on-demand
//
// TODO: Implement
export {};
