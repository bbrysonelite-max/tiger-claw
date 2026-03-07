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

    // Replace load/save function signatures
    content = content.replace(/function\s+(load|save)([a-zA-Z0-9_]+)(<[A-Za-z0-9_]+>)?\s*\(\s*(workdir|filePath|tenantId)\s*:\s*string/g, (match, op, name, tmpl, argName) => {
        if (argName === "tenantId" && file === "tiger_onboard.ts") return match;
        return `async function ${op}${name}${tmpl || ""}(context: ToolContext`;
    });

    // Replace helper function signatures that take `workdir`
    content = content.replace(/(function\s+[a-zA-Z0-9_]+\s*\([^)]*)workdir\s*:\s*string/g, '$1context: ToolContext');
    content = content.replace(/(function\s+[a-zA-Z0-9_]+\s*\([^)]*),\s*workdir\s*:\s*string/g, '$1, context: ToolContext');

    // Replace function calls passing `workdir`
    // We only replace `workdir` passed to load/save/handle/derive functions.
    // E.g. `loadLeads(workdir)` -> `await loadLeads(context)`

    // Replace `workdir` parameter in function calls inside helpers or execute
    // Actually, `workdir` is just a variable. Let's just rename all `workdir` identifiers that are arguments to `context`.
    content = content.replace(/\b(load|save|handle|derive|check|get)[a-zA-Z0-9_]*\s*\([^)]*\b(workdir)\b[^)]*\)/g, (match) => {
        return match.replace(/\bworkdir\b/g, 'context');
    });

    // Special case for tiger_settings.handleReset(...)
    content = content.replace(/\b(handle[a-zA-Z0-9_]*)\s*\([^)]*\b(workdir)\b[^)]*\)/g, match => match.replace(/\bworkdir\b/g, 'context'));

    // Now, let's rewrite the bodies of loadX and saveX safely without breaking anything else.
    // For 'loadX' where arg is context:
    const loadRegex = /async function\s+(load[a-zA-Z0-9_]+)(<[A-Za-z0-9_]+>)?\s*\(\s*context:\s*ToolContext\s*\)\s*:\s*([^\{]+?)\s*\{[\s\S]*?return\s*(.*?);\n\s*\}/g;
    content = content.replace(loadRegex, (match, funcName, tmpl, retType, retVal) => {
        let key = funcName.replace('load', '').toLowerCase() + '.json';
        if (funcName.includes("Contact")) key = "contacts.json";
        else if (funcName.includes("Lead")) key = "leads.json";
        else if (funcName.includes("Nurture")) key = "nurture.json";
        else if (funcName.includes("Setting")) key = "settings.json";
        else if (funcName.includes("Cache")) key = "cache.json";
        else if (funcName.includes("Store")) key = "store.json";
        else if (funcName.includes("Onboard") || funcName.includes("State")) key = "onboard_state.json";
        else if (funcName.includes("Key")) key = "key_state.json";

        let cleanType = retType.trim();
        if (cleanType.startsWith('Promise<')) cleanType = cleanType.slice(8, -1);

        let emptyVal = "{} as any";
        if (retVal.includes("null")) emptyVal = "null";
        else if (retVal.includes("[]")) emptyVal = "[]";

        return `async function ${funcName}${tmpl || ""}(context: ToolContext): Promise<${cleanType}> {\n  const data = await context.storage.get("${key}");\n  return data ?? ${emptyVal};\n}`;
    });

    // For 'saveX' where arg is context:
    const saveRegex = /async function\s+(save[a-zA-Z0-9_]+)\s*\(\s*context:\s*ToolContext\s*,\s*([a-zA-Z0-9_]+)\s*:\s*([^)]+)\s*\)\s*:\s*(?:void|Promise<void>)\s*\{[\s\S]*?writeFileSync[\s\S]*?\n\s*\}/g;
    content = content.replace(saveRegex, (match, funcName, arg2, arg2Type) => {
        let key = funcName.replace('save', '').toLowerCase() + '.json';
        if (funcName.includes("Contact")) key = "contacts.json";
        else if (funcName.includes("Lead")) key = "leads.json";
        else if (funcName.includes("Nurture")) key = "nurture.json";
        else if (funcName.includes("Setting")) key = "settings.json";
        else if (funcName.includes("Cache")) key = "cache.json";
        else if (funcName.includes("Store")) key = "store.json";
        else if (funcName.includes("Onboard") || funcName.includes("State")) key = "onboard_state.json";
        else if (funcName.includes("Key")) key = "key_state.json";

        return `async function ${funcName}(context: ToolContext, ${arg2}: ${arg2Type.trim()}): Promise<void> {\n  await context.storage.set("${key}", ${arg2});\n}`;
    });

    // Also loadJson / saveJson which take 'filePath' -> rewritten to 'key'
    const loadJsonRegex = /async function\s+(loadJSON|loadJson)<T>\s*\(\s*context:\s*ToolContext\s*,\s*key:\s*string\s*\)\s*:\s*([^\{]+?)\s*\{[\s\S]*?return\s*(.*?);\n\s*\}/g;
    content = content.replace(loadJsonRegex, (match, f, ret) => `async function ${f}<T>(context: ToolContext, key: string): Promise<T | null> {\n  const data = await context.storage.get(key);\n  return data ?? null;\n}`);
    const saveJsonRegex = /async function\s+(saveJSON|saveJson)\s*\(\s*context:\s*ToolContext\s*,\s*key:\s*string\s*,\s*([a-zA-Z0-9_]+)\s*:\s*([^)]+)\s*\)\s*:\s*(?:void|Promise<void>)\s*\{[\s\S]*?writeFileSync[\s\S]*?\n\s*\}/g;
    content = content.replace(saveJsonRegex, (match, f, arg2, arg2Type) => `async function ${f}(context: ToolContext, key: string, ${arg2}: ${arg2Type.trim()}): Promise<void> {\n  await context.storage.set(key, ${arg2});\n}`);

    // Update callers to await the load/save
    content = content.replace(/(?<!await\s+)\b(load[a-zA-Z0-9_]+|save[a-zA-Z0-9_]+)\s*\(([^)]*)\)/g, (match, fn, args) => {
        if (fn === "loadFlavorConfig") return match;
        if (file === "tiger_onboard.ts" && fn === "saveState" && args.includes("tenantId")) return match; // skip explicit tenantId ones we avoided

        let newArgs = args;
        if ((fn === "loadJson" || fn === "loadJSON" || fn === "saveJson" || fn === "saveJSON") && args.includes("path.join")) {
            const m = args.match(/["']([^"']+\.json)["']/);
            const key = m ? `"${m[1]}"` : '"unknown.json"';
            newArgs = args.replace(/path\.join\([^)]+\)/, key);
        }
        return `await ${fn}(${newArgs})`;
    });

    // Clean duplicate awaits
    content = content.replace(/await\s+await\s+/g, 'await ');

    fs.writeFileSync(fullPath, content, 'utf8');
}
console.log('first pass done');
