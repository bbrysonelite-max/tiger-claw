import { Project, SyntaxKind, ParameterDeclaration, FunctionDeclaration } from "ts-morph";
import * as fs from "fs";
import * as path from "path";

const project = new Project({ tsConfigFilePath: "./tsconfig.json" });
const toolsDir = path.join(process.cwd(), "src/tools");
project.addSourceFilesAtPaths(`${toolsDir}/**/*.ts`);

for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getBaseName() === "flavorConfig.ts") continue;

    let edits: { start: number; end: number; text: string }[] = [];

    // 1. ToolContext Interface adding storage
    const contextInterface = sourceFile.getInterface("ToolContext");
    if (contextInterface && !contextInterface.getProperty("storage")) {
        edits.push({
            start: contextInterface.getEnd() - 1,
            end: contextInterface.getEnd() - 1,
            text: '\n  storage: { get: (key: string) => Promise<any>; set: (key: string, value: any) => Promise<void>; };\n'
        });
    }

    const functions = sourceFile.getFunctions();
    for (const func of functions) {
        const funcName = func.getName();
        if (!funcName) continue;

        let isLoad = funcName.startsWith("load") && funcName !== "loadFlavorConfig";
        let isSave = funcName.startsWith("save") && funcName !== "saveFlavorConfig";
        let isHandle = funcName.startsWith("handle") || funcName.startsWith("derive") || funcName.startsWith("run") || funcName.startsWith("check") || funcName.startsWith("getD");

        if (sourceFile.getBaseName() === "tiger_onboard.ts" && (funcName === "loadState" || funcName === "saveState")) {
            isLoad = false;
            isSave = false;
        }

        let key = funcName.toLowerCase().replace('load', '').replace('save', '') + '.json';
        if (funcName.includes("Contact")) key = "contacts.json";
        else if (funcName.includes("Lead")) key = "leads.json";
        else if (funcName.includes("Nurture")) key = "nurture.json";
        else if (funcName.includes("Setting")) key = "settings.json";
        else if (funcName.includes("Cache")) key = "cache.json";
        else if (funcName.includes("Store")) key = "store.json";
        else if (funcName.includes("Onboard") || funcName.includes("State")) key = "onboard_state.json";
        else if (funcName.includes("Key")) key = "key_state.json";

        // Handle parameters: replacing 'workdir: string' with 'context: ToolContext'
        const params = func.getParameters();
        let workdirParam = params.find(p => p.getName() === "workdir" || p.getName() === "_workdir" || p.getName() === "filePath" || p.getName() === "tenantId");

        if (isLoad) {
            const retTypeNode = func.getReturnTypeNode();
            const retType = retTypeNode ? retTypeNode.getText() : "any";
            const cleanType = retType;
            let exportStr = func.isExported() ? "export " : "";

            let emptyVal = "{} as any";
            const bodyText = func.getBodyText() || "";
            if (bodyText.includes("return null")) emptyVal = "null";
            else if (bodyText.includes("[]")) emptyVal = "[]";
            else if (bodyText.includes("defaultSettings()")) emptyVal = "defaultSettings()";

            if (workdirParam && workdirParam.getName() === "filePath") {
                edits.push({
                    start: func.getStart(),
                    end: func.getEnd(),
                    text: `${exportStr}async function ${funcName}(context: ToolContext, key: string): Promise<${cleanType} | null> {\n  const data = await context.storage.get(key);\n  return data ?? null;\n}`
                });
            } else {
                edits.push({
                    start: func.getStart(),
                    end: func.getEnd(),
                    text: `${exportStr}async function ${funcName}(context: ToolContext): Promise<${cleanType}> {\n  const data = await context.storage.get("${key}");\n  return data ?? (${emptyVal});\n}`
                });
            }
        } else if (isSave) {
            const dataParam = params.length > 1 ? params[1] : null;
            const dataName = dataParam ? dataParam.getName() : "data";
            const dataType = dataParam && dataParam.getTypeNode() ? dataParam.getTypeNode()!.getText() : "any";
            let exportStr = func.isExported() ? "export " : "";

            if (workdirParam && workdirParam.getName() === "filePath") {
                edits.push({
                    start: func.getStart(),
                    end: func.getEnd(),
                    text: `${exportStr}async function ${funcName}(context: ToolContext, key: string, ${dataName}: ${dataType}): Promise<void> {\n  await context.storage.set(key, ${dataName});\n}`
                });
            } else {
                edits.push({
                    start: func.getStart(),
                    end: func.getEnd(),
                    text: `${exportStr}async function ${funcName}(context: ToolContext, ${dataName}: ${dataType}): Promise<void> {\n  await context.storage.set("${key}", ${dataName});\n}`
                });
            }
        } else if (isHandle || funcName === "execute") {
            if (funcName !== "execute" && !func.isAsync()) {
                // Prepend async
                const asyncKeyword = func.getAsyncKeyword();
                if (!asyncKeyword) {
                    edits.push({
                        start: func.getStart(),
                        end: func.getStart(),
                        text: "async "
                    });
                }

                const retTypeNode = func.getReturnTypeNode();
                if (retTypeNode) {
                    let retType = retTypeNode.getText();
                    if (!retType.startsWith("Promise<")) {
                        if (retType === "void") retType = "Promise<void>";
                        else retType = `Promise<${retType}>`;
                        edits.push({
                            start: retTypeNode.getStart(),
                            end: retTypeNode.getEnd(),
                            text: retType
                        });
                    }
                }
            }

            if (workdirParam && funcName !== "execute" && (!isLoad && !isSave)) {
                edits.push({
                    start: workdirParam.getStart(),
                    end: workdirParam.getEnd(),
                    text: `context: ToolContext`
                });
            }
        }
    }

    // Process all calls
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
    for (const callExpr of callExpressions) {
        const callee = callExpr.getExpression().getText();
        let isLoad = callee.startsWith("load") && callee !== "loadFlavorConfig";
        let isSave = callee.startsWith("save") && callee !== "saveFlavorConfig";
        let isHandle = callee.startsWith("handle") || callee.startsWith("derive") || callee.startsWith("check") || callee.startsWith("run") || callee.startsWith("getD");

        if (sourceFile.getBaseName() === "tiger_onboard.ts" && (callee === "loadState" || callee === "saveState")) {
            isLoad = false;
            isSave = false;
        }

        if (isLoad || isSave || isHandle) {
            // make sure it has await
            const parent = callExpr.getParent();
            const parentKind = parent ? parent.getKind() : SyntaxKind.Unknown;
            if (parentKind !== SyntaxKind.AwaitExpression) {
                // Find all async keywords prepending
                edits.push({
                    start: callExpr.getStart(),
                    end: callExpr.getStart(),
                    text: "await "
                });
            }

            // replace workdir param parsing
            const args = callExpr.getArguments();
            for (const arg of args) {
                const argText = arg.getText();
                if (argText === "workdir" || argText === "_workdir" || argText === "filePath" || argText === "tenantId") {
                    edits.push({
                        start: arg.getStart(),
                        end: arg.getEnd(),
                        text: "context"
                    });
                } else if (argText.includes("path.join")) {
                    const m = argText.match(/["']([^"']+\.json)["']/);
                    const k = m ? `"${m[1]}"` : '"unknown.json"';
                    edits.push({
                        start: arg.getStart(),
                        end: arg.getEnd(),
                        text: k
                    });
                }
            }
        }
    }

    if (edits.length > 0) {
        let contentStr = sourceFile.getFullText();

        // Filter out edits that are completely inside another edit
        // We can do this by keeping the LARGEST edits when they overlap.
        // Sort by length of edit range DESCENDING so we see the biggest edits first.
        edits.sort((a, b) => (b.end - b.start) - (a.end - a.start));

        const validEdits: typeof edits = [];
        for (const edit of edits) {
            // Check if this edit overlaps with any already kept edit
            const overlaps = validEdits.some(e =>
                (edit.start >= e.start && edit.start < e.end) ||
                (edit.end > e.start && edit.end <= e.end) ||
                (edit.start <= e.start && edit.end >= e.end)
            );
            if (!overlaps) {
                validEdits.push(edit);
            }
        }

        // Now sort the valid edits by start DESCENDING to apply bottom-to-top
        validEdits.sort((a, b) => b.start - a.start);

        for (const edit of validEdits) {
            contentStr = contentStr.substring(0, edit.start) + edit.text + contentStr.substring(edit.end);
        }

        fs.writeFileSync(sourceFile.getFilePath(), contentStr, "utf8");
    }
}
console.log("AST safe refactor done");
