import { Project, SyntaxKind } from "ts-morph";
import * as fs from "fs";
import * as path from "path";

const project = new Project({ tsConfigFilePath: "./tsconfig.json" });
const toolsDir = path.join(process.cwd(), "src/tools");
project.addSourceFilesAtPaths(`${toolsDir}/**/*.ts`);

for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getBaseName() === "flavorConfig.ts") continue;

    let edits: { start: number; end: number; text: string }[] = [];

    // 1. Fix loadJson and saveJson signatures to include <T>
    const funcs = sourceFile.getFunctions();
    for (const f of funcs) {
        const name = f.getName();
        if (name === "loadJson" || name === "saveJson") {
            // Find type parameter
            if (f.getTypeParameters().length === 0) {
                // Prepend <T>
                edits.push({
                    start: f.getNameNode()!.getEnd(),
                    end: f.getNameNode()!.getEnd(),
                    text: "<T>"
                });
            }
            // Fix double nulls
            const retTypeNode = f.getReturnTypeNode();
            if (retTypeNode && retTypeNode.getText().includes("null | null")) {
                edits.push({
                    start: retTypeNode.getStart(),
                    end: retTypeNode.getEnd(),
                    text: retTypeNode.getText().replace("null | null", "null")
                });
            }
        }
    }

    // 2. Fix VariableDeclarations that use path.join(workdir, "...") and references to them
    const pathVars: { [name: string]: string } = {};
    const varDecls = sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration);
    for (const vd of varDecls) {
        const init = vd.getInitializer();
        if (init && init.getText().includes("path.join")) {
            const match = init.getText().match(/["']([^"']+\.json)["']/);
            if (match) {
                const varName = vd.getName();
                pathVars[varName] = `"${match[1]}"`;

                // Track edit to delete the statement
                const statement = vd.getFirstAncestorByKind(SyntaxKind.VariableStatement);
                if (statement) {
                    edits.push({
                        start: statement.getStart(),
                        end: statement.getEnd(),
                        text: "/* unused path */"
                    });
                }
            }
        }
    }

    // Fix CallExpressions for loadJson and saveJson
    const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const call of calls) {
        const callee = call.getExpression().getText();
        if (callee === "loadJson" || callee === "saveJson" || callee.startsWith("load") || callee.startsWith("save")) {
            const args = call.getArguments();
            for (const arg of args) {
                const text = arg.getText();
                // Replace variable references with literal strings
                if (pathVars[text]) {
                    edits.push({
                        start: arg.getStart(),
                        end: arg.getEnd(),
                        text: pathVars[text]
                    });
                }
                // Replace workdir with context
                if (text === "workdir" || text === "filePath" || text === "tenantId" || text === "_workdir") {
                    edits.push({
                        start: arg.getStart(),
                        end: arg.getEnd(),
                        text: "context"
                    });
                }
            }
        }
    }

    // Replace lingering workdir usages with context
    const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier);
    for (const id of identifiers) {
        if (id.getText() === "workdir") {
            const parent = id.getParent();
            // Replace if it's the right side of an access or an argument not caught
            if (parent && !parent.isKind(SyntaxKind.PropertyAssignment) && !parent.isKind(SyntaxKind.VariableDeclaration) && !parent.isKind(SyntaxKind.Parameter)) {
                // If it's used inside path.join, replace with context (doesn't hurt, path.join won't be executed due to TS errors or we just leave it)
                // Actually if there are stray workdir, it's safer to avoid global replace
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
console.log("Storage calls fix done");
