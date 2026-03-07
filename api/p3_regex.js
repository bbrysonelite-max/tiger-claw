const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src/tools');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'flavorConfig.ts');

for (const file of files) {
    const fullPath = path.join(dir, file);
    let content = fs.readFileSync(fullPath, 'utf8');

    // Find all async functions (those modified or already async)
    const asyncFuncRegex = /async\s+(?:export\s+)?function\s+([a-zA-Z0-9_]+)/g;
    let match;
    const asyncFuncs = new Set();
    while ((match = asyncFuncRegex.exec(content)) !== null) {
        asyncFuncs.add(match[1]);
    }

    // Now loop over the code and replace calls that do not have await
    // Regex: (?<!await\s+)\bfuncName\s*\(
    // Be careful not to replace function definitions or variable names, but since they have ( immediately after, they are likely calls.
    for (const funcName of asyncFuncs) {
        if (funcName === "execute") continue; // rarely called directly anyway, but just safe

        // This regex ensures we don't prefix await if there already is an await or a function declaration
        const callRegex = new RegExp(`(?<!await\\s+)(?<!function\\s+)(?<!async\\s+function\\s+)\\b${funcName}\\s*\\(`, 'g');
        content = content.replace(callRegex, `await ${funcName}(`);
    }

    // clean duplicate awaits just in case (e.g. if regex lookbehind failed)
    content = content.replace(/await\s+await\s+/g, 'await ');

    fs.writeFileSync(fullPath, content, 'utf8');
}
console.log('p3 done');
