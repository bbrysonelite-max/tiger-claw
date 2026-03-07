const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src/tools');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'flavorConfig.ts');

for (const file of files) {
    const fullPath = path.join(dir, file);
    let content = fs.readFileSync(fullPath, 'utf8');

    // 1. ToolContext Interface adding storage
    if (content.includes('interface ToolContext {') && !content.includes('storage: {')) {
        content = content.replace(
            /interface ToolContext\s*\{/,
            'interface ToolContext {\n  storage: {\n    get: (key: string) => Promise<any>;\n    set: (key: string, value: any) => Promise<void>;\n  };'
        );
    }

    // Identify all load* and save* functions before messing with them
    const loadSaveMatches = [...content.matchAll(/(?:export\s+)?function\s+((?:load|save)[a-zA-Z0-9_]+)(?:<[a-zA-Z0-9_]+>)?\s*\(\s*(workdir|filePath|tenantId)\s*:\s*string/g)];
    const functionNames = loadSaveMatches.map(m => m[1]).filter(name => name !== "loadFlavorConfig");

    // 2. Rewrite load* and save* function definitions
    for (const funcName of functionNames) {
        if (funcName === "saveState" && file === "tiger_onboard.ts") continue; // keep as-is because it delegates to db.ts directly
        if (funcName === "loadState" && file === "tiger_onboard.ts") continue;

        let key = funcName.toLowerCase().replace('load', '').replace('save', '') + '.json';
        if (funcName.includes("Contact")) key = "contacts.json";
        else if (funcName.includes("Lead")) key = "leads.json";
        else if (funcName.includes("Nurture")) key = "nurture.json";
        else if (funcName.includes("Setting")) key = "settings.json";
        else if (funcName.includes("Cache")) key = "cache.json";
        else if (funcName.includes("Store")) key = "store.json";
        else if (funcName.includes("Onboard") || funcName.includes("State")) key = "onboard_state.json";
        else if (funcName.includes("Key")) key = "key_state.json";

        if (funcName.startsWith("load")) {
            // function loadLeads(workdir: string): Record<string, LeadRecord> { ... }
            const regex = new RegExp(`(?:export\\s+)?function\\s+${funcName}(<[a-zA-Z0-9_]+>)?\\s*\\(\\s*(workdir|filePath|tenantId)\\s*:\\s*string\\s*\\)\\s*:\\s*([^\\{]+?)\\s*\\{[\\s\\S]*?return\\s+(.*?);\\n?\\s*\\}`, 'g');
            content = content.replace(regex, (match, tmpl, arg, retType, returnVal) => {
                let cleanType = retType.trim();
                let emptyVal = "{} as any";
                if (returnVal.includes("null")) emptyVal = "null";
                else if (returnVal.includes("[]")) emptyVal = "[]";

                if (arg === "filePath") {
                    return `export async function ${funcName}${tmpl || ""}(context: ToolContext, key: string): Promise<${cleanType} | null> {\n  const data = await context.storage.get(key);\n  return data ?? null;\n}`;
                }

                return `async function ${funcName}${tmpl || ""}(context: ToolContext): Promise<${cleanType}> {\n  const data = await context.storage.get("${key}");\n  return data ?? (${emptyVal});\n}`;
            });
        } else if (funcName.startsWith("save")) {
            // function saveLeads(workdir: string, data: Record<string, LeadRecord>): void { ... }
            const regex = new RegExp(`(?:export\\s+)?function\\s+${funcName}\\s*\\(\\s*(workdir|filePath|tenantId)\\s*:\\s*string\\s*,\\s*([a-zA-Z0-9_]+)\\s*:\\s*([^\\)]+?)\\s*\\)\\s*:\\s*(?:void|Promise<void>)\\s*\\{[\\s\\S]*?\\}`, 'g');
            content = content.replace(regex, (match, arg, dataArg, dataType) => {
                if (arg === "filePath") {
                    return `export async function ${funcName}(context: ToolContext, key: string, ${dataArg}: ${dataType.trim()}): Promise<void> {\n  await context.storage.set(key, ${dataArg});\n}`;
                }
                return `async function ${funcName}(context: ToolContext, ${dataArg}: ${dataType.trim()}): Promise<void> {\n  await context.storage.set("${key}", ${dataArg});\n}`;
            });
        }
    }

    // 3. Make handle* functions async and take context
    const handleRegex = /function\s+(handle[a-zA-Z0-9_]+|derive[a-zA-Z0-9_]+|check[a-zA-Z0-9_]+|run[a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*:/g;
    content = content.replace(handleRegex, (match, fn, args) => {
        let newArgs = args;
        if (args.includes("workdir: string")) {
            newArgs = args.replace(/workdir\s*:\s*string/g, "context: ToolContext");
        }
        return `async function ${fn}(${newArgs}): Promise<`; // Wait, what about the return type?
    });

    // Actually, correctly changing signature return types:
    // function handleGet(workdir: string): ToolResult { -> async function handleGet(context: ToolContext): Promise<ToolResult> {
    const signatureRegex = /function\s+([a-zA-Z0-9_]+)\s*\(([^)]*)\)\s*:\s*([^{]+)\s*\{/g;
    content = content.replace(signatureRegex, (match, fn, args, retType) => {
        if (fn === "execute") return match; // skip execute
        if (fn === "defaultSettings" || fn === "validateValue" || fn === "apiPost" || fn === "settingImpactNote") return match;

        let isHandle = fn.startsWith("handle") || fn.startsWith("derive") || fn.startsWith("check") || fn.startsWith("run");
        let isLoadSave = fn.startsWith("load") || fn.startsWith("save");

        if (!isHandle && !isLoadSave) return match;
        if (fn === "loadFlavorConfig") return match;

        // This regex could accidentally match inside bodies. Since we already replaced load/save, this mostly hits handle*
        let newArgs = args;
        if (args.includes("workdir")) {
            newArgs = args.replace(/\bworkdir(\s*:\s*string)?/g, "context: ToolContext").replace(/context:\s*ToolContext:\s*ToolContext/g, "context: ToolContext");
        }

        let newRet = retType.trim();
        if (!newRet.startsWith("Promise<")) {
            if (newRet === "void") newRet = "Promise<void>";
            else newRet = `Promise<${newRet}>`;
        }
        return `async function ${fn}(${newArgs}): ${newRet} {`;
    });

    // 4. Update function calls to await and pass context
    const callRegex = /(?<!function\s+)(?<!async\s+function\s+)(?<!await\s+)\b(load[a-zA-Z0-9_]+|save[a-zA-Z0-9_]+|handle[a-zA-Z0-9_]+|derive[a-zA-Z0-9_]+|run[a-zA-Z0-9_]+|check[a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;
    content = content.replace(callRegex, (match, fn, args) => {
        if (fn === "loadFlavorConfig") return match;
        if (fn === "saveState" && file === "tiger_onboard.ts") return match;
        if (fn === "loadState" && file === "tiger_onboard.ts") return match;

        let newArgs = args;
        if (args.includes("path.join")) {
            const m = args.match(/["']([^"']+\.json)["']/);
            const key = m ? `"${m[1]}"` : '"unknown.json"';
            newArgs = args.replace(/path\.join\([^)]+\)/, key);
        }
        if (newArgs.includes("workdir")) {
            newArgs = newArgs.replace(/\bworkdir\b/g, "context");
        }

        return `await ${fn}(${newArgs})`;
    });

    // Handle `workdir` param in exact call: handleCheck(workdir) -> await handleCheck(context)
    content = content.replace(/\b(handle[a-zA-Z0-9_]+)\s*\(\s*workdir/, "await $1(context");

    // Remove double awaits
    content = content.replace(/await\s+await\s+/g, 'await ');

    // 5. Check if execute destructures workdir and injects context manually if needed
    // In execute(params, context) people destructure: const { workdir, logger } = context;
    // That's fine, workdir isn't passed anymore but it might be used inside for path.resolve if there are other files (like CSVs).
    // Actually, if we changed `handleGet(workdir)` into `await handleGet(context)`, execute needs `context`!
    // So in execute, if we replaced `workdir` with `context`, we are good because `context` is already an argument of `execute`.

    fs.writeFileSync(fullPath, content, 'utf8');
}
console.log('regex script completed');
