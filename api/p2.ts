import { Project, SyntaxKind } from "ts-morph";
import * as path from "path";
import * as fs from "fs";

const project = new Project({ tsConfigFilePath: "./tsconfig.json" });
const toolsDir = path.join(process.cwd(), "src/tools");
project.addSourceFilesAtPaths(`${toolsDir}/**/*.ts`);

for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getBaseName() === "flavorConfig.ts") continue;

    let changed = true;
    while (changed) {
        changed = false;
        sourceFile.refreshFromFileSystem();
        const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

        for (const callExpr of callExpressions) {
            const calleeName = callExpr.getExpression().getText();
            if ((calleeName.startsWith("load") || calleeName.startsWith("save")) && calleeName !== "loadFlavorConfig") {
                const args = callExpr.getArguments();
                if (args.length > 0) {
                    const firstArgText = args[0].getText();
                    if (firstArgText === "context" || firstArgText === "filePath" || firstArgText.includes("path.join")) {
                        if (firstArgText === "tenantId" && sourceFile.getBaseName() === "tiger_onboard.ts") continue;

                        let newCallText = "";
                        const p = callExpr.getParent();
                        const isAwaited = p && p.getKind() === SyntaxKind.AwaitExpression;
                        const awaitStr = isAwaited ? "" : "await ";

                        if (firstArgText.includes("path.join")) {
                            const match = firstArgText.match(/["']([^"']+\.json)["']/);
                            const keyName = match ? `"${match[1]}"` : '"unknown.json"';
                            if (calleeName.startsWith("load")) {
                                newCallText = `${awaitStr}${calleeName}(context, ${keyName})`;
                            } else {
                                const arg2 = args[1]?.getText() || "{}";
                                newCallText = `${awaitStr}${calleeName}(context, ${keyName}, ${arg2})`;
                            }
                        } else {
                            if (calleeName.startsWith("load")) {
                                newCallText = `${awaitStr}${calleeName}(context)`;
                            } else {
                                const arg2 = args[1]?.getText() || "{}";
                                newCallText = `${awaitStr}${calleeName}(context, ${arg2})`;
                            }
                        }

                        let doReplaceCall = true;
                        if (callExpr.getText() === newCallText) {
                            doReplaceCall = false;
                        }

                        let madeChange = false;
                        const enclosingFunc = callExpr.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) || callExpr.getFirstAncestorByKind(SyntaxKind.ArrowFunction);

                        if (enclosingFunc) {
                            if (!enclosingFunc.isAsync()) {
                                const parentKind = enclosingFunc.getParent()?.getKind();
                                if (parentKind !== SyntaxKind.PropertyAssignment) {
                                    enclosingFunc.setIsAsync(true);
                                    let retType = enclosingFunc.getReturnTypeNode()?.getText();
                                    if (retType && !retType.startsWith("Promise<")) {
                                        enclosingFunc.setReturnType(`Promise<${retType}>`);
                                    }
                                    madeChange = true;
                                    doReplaceCall = false; // Nodes invalidated by setIsAsync, replace later
                                }
                            }
                        }

                        if (doReplaceCall) {
                            console.log(`[p2] Replacing in ${sourceFile.getBaseName()}: ${callExpr.getText()} -> ${newCallText}`);
                            sourceFile.replaceText([callExpr.getStart(), callExpr.getEnd()], newCallText);
                            madeChange = true;
                        }

                        if (madeChange) {
                            sourceFile.saveSync();
                            changed = true;
                            break;
                        }
                    }
                }
            }
        }
    }
}
console.log("p2 done");
