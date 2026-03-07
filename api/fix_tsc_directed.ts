import { Project, SyntaxKind, FunctionDeclaration, ArrowFunction, FunctionExpression, CallExpression } from "ts-morph";
import * as fs from "fs";
import * as path from "path";

const project = new Project({ tsConfigFilePath: "./tsconfig.json" });
const toolsDir = path.join(process.cwd(), "src/tools");
project.addSourceFilesAtPaths(`${toolsDir}/**/*.ts`);

const logFile = fs.readFileSync("errors_final.log", "utf8");

for (const sourceFile of project.getSourceFiles()) {
    const filename = sourceFile.getBaseName();
    let edits: { start: number; end: number; text: string }[] = [];

    // Parse specific TS2304 workdir errors for THIS file
    const workdirRegex = new RegExp(`${filename}\\((\\d+),\\d+\\): error TS2304: Cannot find name 'workdir'`, "g");
    let m;
    const lines = sourceFile.getFullText().split('\n');
    const workdirLines = new Set<number>();
    while ((m = workdirRegex.exec(logFile)) !== null) {
        workdirLines.add(parseInt(m[1]));
    }

    // Parse 'context' errors
    const contextRegex = new RegExp(`${filename}\\((\\d+),\\d+\\): error TS2304: Cannot find name 'context'`, "g");
    const contextLines = new Set<number>();
    while ((m = contextRegex.exec(logFile)) !== null) {
        contextLines.add(parseInt(m[1]));
    }

    // 1. Fix workdir
    sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).forEach(node => {
        if (node.getText() === "workdir") {
            const line = node.getStartLineNumber();
            if (workdirLines.has(line)) {
                edits.push({
                    start: node.getStart(),
                    end: node.getEnd(),
                    text: "context.workdir"
                });
            }
        }
    });

    // 2. Fix duplicated `context, context` arguments from safe_refactor.ts
    sourceFile.getFunctions().forEach(func => {
        const params = func.getParameters();
        if (params.length >= 2 && params[0].getText().includes("context") && params[1].getText().includes("context")) {
            edits.push({
                start: params[0].getStart(),
                end: params[1].getEnd(),
                text: "context: ToolContext"
            });
        }
    });

    sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
        const args = call.getArguments();
        if (args.length >= 2 && args[0].getText() === "context" && args[1].getText() === "context") {
            edits.push({
                start: args[0].getStart(),
                end: args[1].getEnd(),
                text: "context"
            });
        }
    });

    // 3. Fix TS2554 "Expected 2 arguments, but got 1" (which means missing context in CallExpression!)
    // Just find any call that throws this error and prepend it. Wait, fix_missing_context.ts didn't get all of them?
    const expectedRegex = new RegExp(`${filename}\\((\\d+),\\d+\\): error TS2554: Expected \\d+ arguments, but got \\d+`, "g");
    const expectedLines = new Set<number>();
    while ((m = expectedRegex.exec(logFile)) !== null) {
        expectedLines.add(parseInt(m[1]));
    }
    sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
        if (expectedLines.has(call.getStartLineNumber())) {
            const callee = call.getExpression().getText();
            // Prepend context, if it doesn't already have it
            if (callee.startsWith("load") || callee.startsWith("save") || callee.startsWith("handle")) {
                const args = call.getArguments();
                if (args.length === 0 || args[0].getText() !== "context") {
                    edits.push({
                        start: call.getArguments()[0]?.getStart() ?? call.getExpression().getEnd() + 1,
                        // If no arguments, we prepend inside `()`
                        end: call.getArguments()[0]?.getStart() ?? call.getExpression().getEnd() + 1,
                        text: args.length > 0 ? "context, " : "context"
                    });
                }
            }
        }
    });

    // 4. TS1064 Promise<T> return type fix
    const retRegex = new RegExp(`${filename}\\((\\d+),\\d+\\): error TS1064: .*Did you mean to write 'Promise<([^>]+)>'`, "g");
    const retFixes = new Map<number, string>();
    while ((m = retRegex.exec(logFile)) !== null) {
        retFixes.set(parseInt(m[1]), m[2]);
    }
    sourceFile.getFunctions().forEach(f => {
        const rNode = f.getReturnTypeNode();
        if (rNode && retFixes.has(rNode.getStartLineNumber())) {
            edits.push({
                start: rNode.getStart(),
                end: rNode.getEnd(),
                text: `Promise<${retFixes.get(rNode.getStartLineNumber())}>`
            });
        }
    });

    // 5. 'context' undefined Error: The helper function needs context parameter added!
    sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).forEach(id => {
        if (id.getText() === "context" && contextLines.has(id.getStartLineNumber())) {
            const func = id.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) || id.getFirstAncestorByKind(SyntaxKind.ArrowFunction);
            if (func) {
                // Determine if we need to add context as first parameter
                const params = func.getParameters();
                const hasContextParam = params.some(p => p.getName() === "context");
                if (!hasContextParam) {
                    const firstParam = params[0];
                    if (firstParam) {
                        edits.push({
                            start: firstParam.getStart(),
                            end: firstParam.getStart(),
                            text: "context: ToolContext, "
                        });
                    } else {
                        // Empty params
                        const lParen = func.getFirstChildByKind(SyntaxKind.OpenParenToken);
                        if (lParen) {
                            edits.push({
                                start: lParen.getEnd(),
                                end: lParen.getEnd(),
                                text: "context: ToolContext"
                            });
                        }
                    }

                    // For calls to this function, add context
                    const name = func.getName() || "";
                    if (name) {
                        const callRefs = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).filter(c => c.getExpression().getText() === name);
                        for (const cr of callRefs) {
                            const crArgs = cr.getArguments();
                            if (crArgs.length > 0) {
                                edits.push({
                                    start: crArgs[0].getStart(),
                                    end: crArgs[0].getStart(),
                                    text: "context, "
                                });
                            } else {
                                edits.push({
                                    start: cr.getExpression().getEnd() + 1,
                                    end: cr.getExpression().getEnd() + 1,
                                    text: "context"
                                });
                            }
                        }
                    }
                }
            }
        }
    });

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
console.log("TS error directed fix done");
