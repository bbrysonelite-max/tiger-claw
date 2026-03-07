const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src/tools');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'flavorConfig.ts');

for (const file of files) {
    const fullPath = path.join(dir, file);
    let content = fs.readFileSync(fullPath, 'utf8');

    // Rename workdir inside execute arguments
    content = content.replace(/(async function execute\([^)]*context:\s*ToolContext[^)]*\)\s*\{[\s\S]*?)(const {[^}]*workdir[^}]*} = context;)/g, (match, prefix, destruct) => {
        // we keep the destructuring because it's still needed if workdir is used inside execute
        return match;
    });

    // Replace callers `loadX(context, ...)` -> `await loadX(context, ...)`
    // Using RegExp that prevents replacing function definitions and already awaited calls.
    // In Node.js, V8 supports infinite lookbehind length, but we can just use multiple fixed lookbehinds.

    // Replace calls without exact regex magic by using a replacer function:
    const callRegex = /(function\s+([a-zA-Z0-9_]+)[\s\S]*?\{)|(await\s+)?\b(load[a-zA-Z0-9_]+|save[a-zA-Z0-9_]+)\s*\(([^)]*)\)/g;

    // To properly avoid function blocks, we could just do a simple replace:
    content = content.replace(/(^|\s|[^a-zA-Z0-9_])(load[a-zA-Z0-9_]+|save[a-zA-Z0-9_]+)\s*\(([^)]*)\)/g, (match, prefix, fn, args) => {
        if (fn === "loadFlavorConfig") return match;
        // Check if prefix contains function or await
        if (prefix.match(/function\s*$/)) return match;
        if (prefix.match(/await\s*$/)) return match;

        let newArgs = args;
        if (args.includes("path.join")) {
            const m = args.match(/["']([^"']+\.json)["']/);
            const key = m ? `"${m[1]}"` : '"unknown.json"';
            newArgs = args.replace(/path\.join\([^)]+\)/, key);
        } else if (args.includes("workdir")) {
            newArgs = args.replace(/\bworkdir\b/g, "context");
        }

        return `${prefix}await ${fn}(${newArgs})`;
    });

    // Also need to push await to helper functions `handle...`
    // Step 1: find all functions to be async
    // Replace helpers handleXXX(workdir) -> handleXXX(context)
    content = content.replace(/(^|\s|[^a-zA-Z0-9_])(handle[a-zA-Z0-9_]+|derive[a-zA-Z0-9_]+|check[a-zA-Z0-9_]+)\s*\(([^)]*)\)/g, (match, prefix, fn, args) => {
        if (prefix.match(/function\s*$/)) return match;
        let newArgs = args;
        if (args.includes("workdir")) {
            newArgs = args.replace(/\bworkdir\b/g, "context");
        }
        return `${prefix}${fn}(${newArgs})`;
    });

    fs.writeFileSync(fullPath, content, 'utf8');
}
console.log("p2_regex done");
