import { Project, SyntaxKind } from "ts-morph";
import * as fs from "fs";
import * as path from "path";

const project = new Project({ tsConfigFilePath: "./tsconfig.json" });
const toolsDir = path.join(process.cwd(), "src/tools");
project.addSourceFilesAtPaths(`${toolsDir}/**/*.ts`);

for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getBaseName() === "flavorConfig.ts") continue;

    let edits: { start: number; end: number; text: string }[] = [];

    const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
        const callee = call.getExpression().getText();
        if (callee === "loadJson" || callee === "saveJson" || callee.startsWith("load") || callee.startsWith("save")) {
            // Ignore if it's loadState/saveState from tiger_onboard.ts
            if (sourceFile.getBaseName() === "tiger_onboard.ts" && (callee === "loadState" || callee === "saveState")) continue;
            // Ignore flavorConfig
            if (callee === "loadFlavorConfig" || callee === "saveFlavorConfig") continue;

            const args = call.getArguments();
            if (args.length > 0 && args[0].getText() !== "context") {
                // If the first arg is not `context`, we need to prepend `context, `
                // Wait, does it ALREADY have two arguments?
                // Example: loadJson<...>("leads.json") -> loadJson(context, "leads.json")
                edits.push({
                    start: args[0].getStart(),
                    end: args[0].getStart(),
                    text: "context, "
                });
            }
        }
    }

    if (edits.length > 0) {
        let contentStr = sourceFile.getFullText();

        edits.sort((a, b) => (b.end - b.start) - (a.end - a.start));

        const validEdits: typeof edits = [];
        for (const edit of edits) {
            const overlaps = validEdits.some(e =>
                (edit.start >= e.start && edit.start < e.end) ||
                (edit.end > e.start && edit.end <= e.end) ||
                (edit.start <= e.start && edit.end >= e.end)
            );
            if (!overlaps) validEdits.push(edit);
        }

        validEdits.sort((a, b) => b.start - a.start);

        for (const edit of validEdits) {
            contentStr = contentStr.substring(0, edit.start) + edit.text + contentStr.substring(edit.end);
        }

        fs.writeFileSync(sourceFile.getFilePath(), contentStr, "utf8");
    }
}
console.log("Missing context fix done");
