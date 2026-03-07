const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src/tools');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'flavorConfig.ts');

function getBlock(content, startIndex) {
    let braceCount = 0;
    let inBlock = false;
    for (let i = startIndex; i < content.length; i++) {
        if (content[i] === '{') {
            braceCount++;
            inBlock = true;
        } else if (content[i] === '}') {
            braceCount--;
            if (inBlock && braceCount === 0) {
                return { end: i + 1, block: content.substring(startIndex, i + 1) };
            }
        }
    }
    return { end: startIndex, block: '' };
}

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

    // Replace load/save functions using a custom matched regex and brace parsing
    let match;
    const funcRegex = /(export\s+)?function\s+(load[a-zA-Z0-9_]+|save[a-zA-Z0-9_]+)(<[^>]+>)?\s*\([^)]*\)\s*:\s*([^;{]+)\s*\{/g;

    let lastIndex = 0;
    let newContent = '';

    while ((match = funcRegex.exec(content)) !== null) {
        const start = match.index;
        const signature = match[0];
        const funcName = match[2];
        const tmpl = match[3] || "";
        const retType = match[4].trim();

        const isLoad = funcName.startsWith("load");
        const isSave = funcName.startsWith("save");

        let key = funcName.toLowerCase().replace('load', '').replace('save', '') + '.json';
        if (funcName.includes("Contact")) key = "contacts.json";
        else if (funcName.includes("Lead")) key = "leads.json";
        else if (funcName.includes("Nurture")) key = "nurture.json";
        else if (funcName.includes("Setting")) key = "settings.json";
        else if (funcName.includes("Cache")) key = "cache.json";
        else if (funcName.includes("Store")) key = "store.json";
        else if (funcName.includes("Onboard") || funcName.includes("State")) key = "onboard_state.json";
        else if (funcName.includes("Key")) key = "key_state.json";

        newContent += content.substring(lastIndex, start);

        const blockStart = start + signature.length - 1; // index of `{`
        const { end, block } = getBlock(content, blockStart);
        lastIndex = end;

        if (funcName === "loadFlavorConfig" || (file === "tiger_onboard.ts" && (funcName === "saveState" || funcName === "loadState"))) {
            newContent += content.substring(start, end);
            continue;
        }

        // We determine arguments dynamically
        const argsStrMatch = signature.match(/\(([^)]*)\)/);
        const argsStr = argsStrMatch ? argsStrMatch[1] : "";
        const isFilePath = argsStr.includes("filePath");

        let cleanType = retType;
        if (cleanType.startsWith("Promise<")) cleanType = cleanType.substring(8, cleanType.length - 1);

        if (isLoad) {
            let emptyVal = "{} as any";
            if (block.includes("return null")) emptyVal = "null";
            else if (block.includes("[]")) emptyVal = "[]";
            else if (block.includes("defaultSettings()")) emptyVal = "defaultSettings()";

            if (isFilePath) {
                newContent += `export async function ${funcName}${tmpl}(context: ToolContext, key: string): Promise<${cleanType} | null> {\n  const data = await context.storage.get(key);\n  return data ?? null;\n}`;
            } else {
                newContent += `async function ${funcName}${tmpl}(context: ToolContext): Promise<${cleanType}> {\n  const data = await context.storage.get("${key}");\n  return data ?? (${emptyVal});\n}`;
            }
        } else if (isSave) {
            // extract second parameter type
            const parts = argsStr.split(",");
            const secondArg = parts.length > 1 ? parts[1].trim() : "data: any";
            const dataName = secondArg.split(":")[0].trim();
            const dataType = secondArg.split(":").slice(1).join(":").trim() || "any";

            if (isFilePath) {
                newContent += `async function ${funcName}(context: ToolContext, key: string, ${dataName}: ${dataType}): Promise<void> {\n  await context.storage.set(key, ${dataName});\n}`;
            } else {
                newContent += `async function ${funcName}(context: ToolContext, ${dataName}: ${dataType}): Promise<void> {\n  await context.storage.set("${key}", ${dataName});\n}`;
            }
        }
    }
    content = newContent + content.substring(lastIndex);

    // Now make handle* async
    const handleRegex = /function\s+(handle[a-zA-Z0-9_]+|derive[a-zA-Z0-9_]+|check[a-zA-Z0-9_]+|run[a-zA-Z0-9_]+|get[A-Z][a-zA-Z0-9_]*)\s*\([^)]*\)\s*:\s*([^;{]+)\s*\{/g;
    content = content.replace(handleRegex, (match, fn, retType) => {
        if (fn === "defaultSettings" || fn === "validateValue" || fn === "apiPost" || fn === "settingImpactNote") return match;
        // make sure not to prepend async if it already is
        let cleanType = retType.trim();
        if (cleanType === "void") cleanType = "Promise<void>";
        else if (!cleanType.startsWith("Promise<")) cleanType = `Promise<${cleanType}>`;

        return match.replace(/function\s+/, `async function `).replace(retType, cleanType);
    });

    // Replace workdir parameter signatures to context: ToolContext for everything except execute
    content = content.replace(/(?<!async\s+function\s+execute\([^)]*)(\bworkdir\b\s*:\s*string)/g, "context: ToolContext");

    // Update calls to load/save/handle passing workdir -> context, and prepend await
    content = content.replace(/(^|\s|[^\w])(load[a-zA-Z0-9_]+|save[a-zA-Z0-9_]+|handle[a-zA-Z0-9_]+|derive[a-zA-Z0-9_]+|run[a-zA-Z0-9_]+|check[a-zA-Z0-9_]+)\s*\(([^)]*)\)/g, (match, prefix, fn, args) => {
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

        if (prefix.match(/function\s*$/)) return match; // avoid matching declarations
        if (prefix.match(/await\s*$/)) return `${prefix}${fn}(${newArgs})`;

        return `${prefix}await ${fn}(${newArgs})`;
    });

    // Strip double awaits in case we added one next to an existing one
    content = content.replace(/await\s+await\s+/g, 'await ');

    fs.writeFileSync(fullPath, content, 'utf8');
}
console.log("refactor done directly");
