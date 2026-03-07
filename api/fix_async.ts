import { Project, SyntaxKind, ArrowFunction, FunctionDeclaration, FunctionExpression } from "ts-morph";
import * as fs from "fs";
import * as path from "path";

const project = new Project({ tsConfigFilePath: "./tsconfig.json" });
const toolsDir = path.join(process.cwd(), "src/tools");
project.addSourceFilesAtPaths(`${toolsDir}/**/*.ts`);

for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getBaseName() === "flavorConfig.ts") continue;

    let edits: { start: number; end: number; text: string }[] = [];

    const awaitExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.AwaitExpression);

    for (const awaitExpr of awaitExpressions) {
        // Find closest function ancestor
        const func = awaitExpr.getFirstAncestor(node =>
            node.isKind(SyntaxKind.ArrowFunction) ||
            node.isKind(SyntaxKind.FunctionDeclaration) ||
            node.isKind(SyntaxKind.FunctionExpression)
        ) as ArrowFunction | FunctionDeclaration | FunctionExpression | undefined;

        if (func && !func.isAsync()) {
            // Need to make it async
            const asyncKeyword = func.getAsyncKeyword();
            if (!asyncKeyword) {
                // If it's an arrow func `(...) =>` or `arg =>`
                edits.push({
                    start: func.getStart(),
                    end: func.getStart(),
                    text: "async "
                });

                // If it's passed to .map(), wrap the .map() call
                const parent = func.getParent();
                if (parent && parent.isKind(SyntaxKind.CallExpression)) {
                    const calleeText = parent.getExpression().getText();
                    if (calleeText.endsWith(".map")) {
                        // Ensure we haven't already wrapped it (in case multiple awaits in same map)
                        edits.push({
                            start: parent.getStart(),
                            end: parent.getStart(),
                            text: "await Promise.all("
                        });
                        edits.push({
                            start: parent.getEnd(),
                            end: parent.getEnd(),
                            text: ")"
                        });
                    }
                }
            }
        }
    }

    if (edits.length > 0) {
        let contentStr = sourceFile.getFullText();

        // Sort by length DESCENDING to prioritize outer wrappers if overlapping, 
        // string edits on AST nodes require care. We just push characters at boundaries, so length is e.end - e.start = 0.
        // Wait! We're just INSERTING characters (start == end). They don't overlap, they stack!
        // So we just sort by start DESCENDING.
        // If start is the same (e.g., adding `async ` and `await Promise.all(` at the exact same bound? 
        // No, `async` is inside the `map` call, so its start > `map` call start.
        edits.sort((a, b) => {
            if (b.start !== a.start) return b.start - a.start;
            // if same start, we don't care, just preserve order or push one inside another.
            // actually if length is 0, they are just insertions.
            return 0;
        });

        // Filter exact duplicates (multiple awaits in same function triggering same `async ` insertion)
        const uniqueEdits: typeof edits = [];
        for (const edit of edits) {
            const isDup = uniqueEdits.some(e => e.start === edit.start && e.end === edit.end && e.text === edit.text);
            if (!isDup) uniqueEdits.push(edit);
        }

        for (const edit of uniqueEdits) {
            contentStr = contentStr.substring(0, edit.start) + edit.text + contentStr.substring(edit.end);
        }

        fs.writeFileSync(sourceFile.getFilePath(), contentStr, "utf8");
    }
}
console.log("Async fix done");
