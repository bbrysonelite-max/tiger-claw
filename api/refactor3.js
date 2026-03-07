const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src/tools');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'flavorConfig.ts');

for (const file of files) {
    const fullPath = path.join(dir, file);
    let content = fs.readFileSync(fullPath, 'utf8');

    // Add context.storage type to ToolContext if lacking
    if (content.includes('interface ToolContext {') && !content.includes('storage: {')) {
        content = content.replace(
            /(interface ToolContext \{[\s\S]*?)(\})/,
            '$1  storage: {\n    get: (key: string) => Promise<any>;\n    set: (key: string, value: any) => Promise<void>;\n  };\n$2'
        );
    }

    // 1. Rewrite function definitions
    const functionLines = content.split('\n');
    let insideKillBlock = false;
    let newContentLines = [];

    // We will extract functions
    let currentFuncName = null;
    let currentFuncType = null;
    let currentFuncArg2 = null;
    let currentFuncArg2Type = null;
    let currentKey = null;
    let currentIsLoad = false;
    let currentTemplate = "";

    for (let i = 0; i < functionLines.length; i++) {
        let line = functionLines[i];

        // Check if we are starting a loadX or saveX function
        const loadMatch = line.match(/^function\s+(load[a-zA-Z0-9_]+)(<[A-Za-z0-9_]+>)?\s*\(\s*(workdir|filePath|tenantId)\s*:\s*string\s*\)\s*:\s*(.+?)\s*\{/);
        const saveMatch = line.match(/^function\s+(save[a-zA-Z0-9_]+)\s*\(\s*(workdir|filePath|tenantId)\s*:\s*string\s*,\s*([a-zA-Z0-9_]+)\s*:\s*(.+?)\s*\)\s*:\s*(void|Promise<void>)\s*\{/);

        if (loadMatch && loadMatch[1] !== "loadFlavorConfig") {
            insideKillBlock = true;
            currentFuncName = loadMatch[1];
            currentTemplate = loadMatch[2] || "";
            let arg1Name = loadMatch[3];
            let typeStr = loadMatch[4].trim();
            if (typeStr.startsWith("Promise<")) {
                typeStr = typeStr.slice(8, -1);
            }
            currentFuncType = typeStr;
            currentIsLoad = true;
            currentKey = currentFuncName.replace('load', '').replace('save', '').toLowerCase() + '.json';

            if (currentFuncName.includes("Contact")) currentKey = "contacts.json";
            else if (currentFuncName.includes("Lead")) currentKey = "leads.json";
            else if (currentFuncName.includes("Nurture")) currentKey = "nurture.json";
            else if (currentFuncName.includes("Setting")) currentKey = "settings.json";
            else if (currentFuncName.includes("Cache")) currentKey = "cache.json";
            else if (currentFuncName.includes("Store")) currentKey = "store.json";
            else if (currentFuncName.includes("Onboard") || currentFuncName.includes("State")) currentKey = "onboard_state.json";
            else if (currentFuncName.includes("Key")) currentKey = "key_state.json";

            // Special cases
            if (arg1Name === "filePath") {
                newContentLines.push(`async function ${currentFuncName}${currentTemplate}(context: ToolContext, key: string): Promise<${currentFuncType} | null> {`);
                newContentLines.push(`  const data = await context.storage.get(key);`);
                newContentLines.push(`  return data ?? null;`);
                newContentLines.push(`}`);
            } else if (arg1Name === "tenantId" && file === 'tiger_onboard.ts') {
                // Skip rewriting tiger_onboard's loadState body this way, we'll keep it as is, because it uses db.js directly.
                insideKillBlock = false;
                newContentLines.push(line);
            } else {
                newContentLines.push(`async function ${currentFuncName}${currentTemplate}(context: ToolContext): Promise<${currentFuncType}> {`);
                newContentLines.push(`  const data = await context.storage.get("${currentKey}");`);
                if (currentFuncType.includes("null")) {
                    newContentLines.push(`  return data ?? null;`);
                } else if (currentFuncType.includes("Record")) {
                    newContentLines.push(`  return data ?? ({} as any);`);
                } else {
                    newContentLines.push(`  return data ?? ({} as any);`);
                }
                newContentLines.push(`}`);
            }
            continue;
        } else if (saveMatch) {
            insideKillBlock = true;
            currentFuncName = saveMatch[1];
            currentTemplate = "";
            let arg1Name = saveMatch[2];
            currentFuncArg2 = saveMatch[3];
            currentFuncArg2Type = saveMatch[4];
            currentIsLoad = false;
            currentKey = currentFuncName.replace('save', '').toLowerCase() + '.json';

            if (currentFuncName.includes("Contact")) currentKey = "contacts.json";
            else if (currentFuncName.includes("Lead")) currentKey = "leads.json";
            else if (currentFuncName.includes("Nurture")) currentKey = "nurture.json";
            else if (currentFuncName.includes("Setting")) currentKey = "settings.json";
            else if (currentFuncName.includes("Cache")) currentKey = "cache.json";
            else if (currentFuncName.includes("Store")) currentKey = "store.json";
            else if (currentFuncName.includes("Onboard") || currentFuncName.includes("State")) currentKey = "onboard_state.json";
            else if (currentFuncName.includes("Key")) currentKey = "key_state.json";

            if (arg1Name === "filePath") {
                newContentLines.push(`async function ${currentFuncName}(context: ToolContext, key: string, ${currentFuncArg2}: ${currentFuncArg2Type}): Promise<void> {`);
                newContentLines.push(`  await context.storage.set(key, ${currentFuncArg2});`);
                newContentLines.push(`}`);
            } else if (arg1Name === "tenantId" && file === 'tiger_onboard.ts') {
                insideKillBlock = false;
                newContentLines.push(line);
            } else {
                newContentLines.push(`async function ${currentFuncName}(context: ToolContext, ${currentFuncArg2}: ${currentFuncArg2Type}): Promise<void> {`);
                newContentLines.push(`  await context.storage.set("${currentKey}", ${currentFuncArg2});`);
                newContentLines.push(`}`);
            }
            continue;
        }

        if (insideKillBlock) {
            if (line.match(/^}/)) {
                insideKillBlock = false;
            }
            continue;
        }

        newContentLines.push(line);
    }

    content = newContentLines.join('\n');

    // Replace callers
    // This is safe because `workdir` isn't used as function defs anymore.
    const callRegexLoad = /\b(load[a-zA-Z0-9_]+)(?:<([a-zA-Z0-9_]+)>)?\s*\(\s*(workdir|filePath|tenantId)\s*\)/g;
    content = content.replace(callRegexLoad, (match, funcName, tmpl, argName) => {
        if (argName === "tenantId" && file === 'tiger_onboard.ts') return match; // Leave as `loadState(tenantId)`

        let prefix = "await ";
        // if preceded by await, we will handle that later via regex or assume it's not
        // safe way: we'll clean up duplicate awaits after
        let args = "context";
        if (argName === "filePath") {
            // In tigers doing loadJson(filePath) what is `filePath`? 
            // Usually it's something like const filePath = path.join(...)
            // Actually, `loadJson(path.join(workdir, "leads.json"))` won't match this regex.
        }
        return `${prefix}${funcName}${tmpl ? `<${tmpl}>` : ''}(context)`;
    });

    const callRegexLoadComplex = /\b(load[a-zA-Z0-9_]+)(?:<([a-zA-Z0-9_]+)>)?\s*\(\s*(path\.join\([^)]+\))\s*\)/g;
    content = content.replace(callRegexLoadComplex, (match, funcName, tmpl, pathJoin) => {
        const m = pathJoin.match(/["']([^"']+\.json)["']/);
        const key = m ? `"${m[1]}"` : '"unknown.json"';
        return `await ${funcName}${tmpl ? `<${tmpl}>` : ''}(context, ${key})`;
    });

    const callRegexSave = /\b(save[a-zA-Z0-9_]+)\s*\(\s*(workdir|filePath|tenantId)\s*,\s*([^)]+)\s*\)/g;
    content = content.replace(callRegexSave, (match, funcName, arg1, arg2) => {
        if (arg1 === "tenantId" && file === 'tiger_onboard.ts') return match;
        return `await ${funcName}(context, ${arg2})`;
    });

    const callRegexSaveComplex = /\b(save[a-zA-Z0-9_]+)\s*\(\s*(path\.join\([^)]+\))\s*,\s*([^)]+)\s*\)/g;
    content = content.replace(callRegexSaveComplex, (match, funcName, pathJoin, arg2) => {
        const m = pathJoin.match(/["']([^"']+\.json)["']/);
        const key = m ? `"${m[1]}"` : '"unknown.json"';
        return `await ${funcName}(context, ${key}, ${arg2})`;
    });

    // Clean duplicate awaits
    content = content.replace(/await\s+await\s+/g, 'await ');

    // Add context to tiger_import and such where execute passes things manually
    // If not done, it will become obvious in tsc

    fs.writeFileSync(fullPath, content, 'utf8');
}
console.log('done running script JS');
