const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src/tools');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'flavorConfig.ts');

let changed = true;
while (changed) {
    changed = false;
    for (const file of files) {
        const fullPath = path.join(dir, file);
        let content = fs.readFileSync(fullPath, 'utf8');
        let newContent = content;

        // Find synchronous functions that contain `await ` keyword 
        // regex: function\s+([a-zA-Z0-9_]+)[\s\S]*?\{[\s\S]*?\}
        // Actually, we can just look for `function myFunc(` and if `await` is inside its body (up to the next top-level `function` or EOF).
        // Since TS has nested brackets, regex is hard. Let's do simple line-by-line block tracking.

        const lines = content.split('\n');
        let inFunc = false;
        let funcStartLine = -1;
        let containsAwait = false;
        let funcName = "";
        let braceDepth = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Start of a function
            const match = line.match(/^(?:export\s+)?function\s+([^(\s]+)\s*\(/);
            if (match && !inFunc) {
                inFunc = true;
                funcStartLine = i;
                funcName = match[1];
                containsAwait = false;
                braceDepth = 0;
            }

            if (inFunc) {
                if (line.includes('await ')) {
                    containsAwait = true;
                }

                // Track braces carefully
                for (const char of line) {
                    if (char === '{') braceDepth++;
                    if (char === '}') braceDepth--;
                }

                if (braceDepth === 0 && line.includes('}')) {
                    // end of function
                    if (containsAwait) {
                        // Change to async function
                        let decl = lines[funcStartLine];
                        if (decl.includes(`Promise<`)) {
                            // it already has promise types, just add async
                            lines[funcStartLine] = decl.replace(/^(export\s+)?function/, '$1async function');
                        } else {
                            // attempt to rewrite type to Promise
                            const typeMatch = decl.match(/:\s*([^\{]+)\s*\{/);
                            if (typeMatch) {
                                const typeStr = typeMatch[1].trim();
                                if (typeStr && typeStr !== "void" && !typeStr.includes("Promise")) {
                                    lines[funcStartLine] = decl.replace(`: ${typeStr}`, `: Promise<${typeStr}>`);
                                } else if (typeStr === "void") {
                                    lines[funcStartLine] = decl.replace(`: void`, `: Promise<void>`);
                                }
                            }
                            lines[funcStartLine] = lines[funcStartLine].replace(/^(export\s+)?function/, '$1async function');
                        }

                        // We also need to add 'context' to caller and definition if it doesn't have it and it needs it. 
                        // Actually, if it contains `await loadXXX(context)`, where did `context` come from? 
                        // It must be passed from the caller!
                        if (!decl.includes('context')) {
                            // add `context: ToolContext` to parameters
                            lines[funcStartLine] = lines[funcStartLine].replace(/\((.*?)\)/, '(context: ToolContext, $1)').replace('(context: ToolContext, )', '(context: ToolContext)');

                            // Update all callers of this function to pass context
                            for (let j = 0; j < lines.length; j++) {
                                const callRegex = new RegExp(`\\b${funcName}\\s*\\(`, 'g');
                                if (j !== funcStartLine && lines[j].match(callRegex)) {
                                    lines[j] = lines[j].replace(new RegExp(`\\b${funcName}\\s*\\(\\s*\\)`, 'g'), `${funcName}(context)`);
                                    lines[j] = lines[j].replace(new RegExp(`\\b${funcName}\\s*\\(`, 'g'), `${funcName}(context, `).replace(/\(context, \)/g, '(context)');
                                }
                            }
                        }

                        // update callers to await this function
                        for (let j = 0; j < lines.length; j++) {
                            const callRegex = new RegExp(`(?<!await\\s+)\\b${funcName}\\s*\\(`, 'g');
                            if (j !== funcStartLine && lines[j].match(callRegex)) {
                                lines[j] = lines[j].replace(callRegex, `await ${funcName}(`);
                            }
                        }
                        changed = true;
                    }
                    inFunc = false;
                }
            }
        }

        newContent = lines.join('\n');

        // Clean up double contexts
        newContent = newContent.replace(/\(context: ToolContext, context: ToolContext/g, '(context: ToolContext');
        newContent = newContent.replace(/\(context, context,/g, '(context,');
        newContent = newContent.replace(/\(context, context\)/g, '(context)');

        if (newContent !== content) {
            fs.writeFileSync(fullPath, newContent, 'utf8');
        }
    }
}
console.log('async propagation done');
