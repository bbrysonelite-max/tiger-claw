import { Project, SyntaxKind, FunctionDeclaration, CallExpression } from "ts-morph";
import * as path from "path";

const project = new Project({
    tsConfigFilePath: "./tsconfig.json",
});

const toolsDir = path.join(process.cwd(), "src/tools");
project.addSourceFilesAtPaths(`${toolsDir}/**/*.ts`);

const files = project.getSourceFiles();

// Phase 0: Rename 'workdir' parameter to 'context' on non-execute functions
for (const sourceFile of files) {
    if (sourceFile.getBaseName() === "flavorConfig.ts") continue;

    const functions = sourceFile.getFunctions();
    for (const func of functions) {
        if (func.getName() === "execute") continue;

        const params = func.getParameters();
        const workdirParam = params.find(p => p.getName() === "workdir");
        if (workdirParam) {
            workdirParam.rename("context");
            workdirParam.setType("ToolContext");
            sourceFile.saveSync();
        }

        // Similarly for filePath -> rename to key? Wait `loadJson(filePath)`
        // If we rename filePath to key
        const filePathParam = params.find(p => p.getName() === "filePath");
        if (filePathParam) {
            // we will just replace the parameter manually to avoid rename breaking string manipulation later
        }
    }
}

// Reload everything
project.addSourceFilesAtPaths(`${toolsDir}/**/*.ts`);

// Phase 1: Update load/save function definitions 
for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getBaseName() === "flavorConfig.ts") continue;

    const functions = sourceFile.getFunctions();
    for (const func of functions) {
        const name = func.getName();
        if (!name || (!name.startsWith("load") && !name.startsWith("save"))) continue;
        if (name === "loadFlavorConfig") continue;

        const params = func.getParameters();
        const firstParam = params[0];

        if (firstParam && (firstParam.getName() === "context" || firstParam.getType().getText() === "string" || firstParam.getName() === "filePath" || firstParam.getName() === "tenantId")) {

            if (firstParam.getName() === "tenantId" && sourceFile.getBaseName() === "tiger_onboard.ts") continue;

            let keyName = "unknown.json";

            const bodyText = func.getBodyText() || "";
            const match = bodyText.match(/["']([^"']+\.json)["']/);
            if (match) {
                keyName = match[1];
            } else {
                keyName = name.replace("load", "").replace("save", "").toLowerCase() + ".json";
                if (name.includes("Contact")) keyName = "contacts.json";
                else if (name.includes("Lead")) keyName = "leads.json";
                else if (name.includes("Nurture")) keyName = "nurture.json";
                else if (name.includes("Setting")) keyName = "settings.json";
                else if (name.includes("Cache")) keyName = "cache.json";
                else if (name.includes("Store")) keyName = "store.json";
            }

            const isLoad = name.startsWith("load");
            const isSave = name.startsWith("save");

            if (isLoad) {
                const retType = func.getReturnTypeNode()?.getText() || "any";
                if (retType.includes("Promise")) continue;

                const tmplParams = func.getTypeParameters().map(t => t.getText()).join(', ');
                const tmplStr = tmplParams ? `<${tmplParams}>` : '';

                let emptyVal = "{} as any";
                if (bodyText.includes("return null")) emptyVal = "null";
                else if (bodyText.includes("[]")) emptyVal = "[]";

                let newFuncText = "";
                if (firstParam.getName() === "filePath") {
                    newFuncText = `async function ${name}${tmplStr}(context: any, key: string): Promise<${retType} | null> {\n  const data = await context.storage.get(key);\n  return data ?? null;\n}`;
                } else {
                    newFuncText = `async function ${name}${tmplStr}(context: any): Promise<${retType}> {\n  const data = await context.storage.get("${keyName}");\n  return data ?? (${emptyVal});\n}`;
                }
                func.replaceWithText(newFuncText);
                sourceFile.saveSync();
            } else if (isSave) {
                const secondParam = params[1];
                if (!secondParam) continue;

                const dataType = secondParam.getTypeNode()?.getText() || "any";
                const dataName = secondParam.getName();

                if (func.getReturnTypeNode()?.getText().includes("Promise")) continue;

                let newFuncText = "";
                if (firstParam.getName() === "filePath") {
                    newFuncText = `async function ${name}(context: any, key: string, ${dataName}: ${dataType}): Promise<void> {\n  await context.storage.set(key, ${dataName});\n}`;
                } else {
                    newFuncText = `async function ${name}(context: any, ${dataName}: ${dataType}): Promise<void> {\n  await context.storage.set("${keyName}", ${dataName});\n}`;
                }
                func.replaceWithText(newFuncText);
                sourceFile.saveSync();
            }
        }
    }
}

// Phase 2: Update callers of load and save
for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getBaseName() === "flavorConfig.ts") continue;

    let iterations = 0;
    let keepGoing = true;
    while (keepGoing && iterations++ < 100) {
        keepGoing = false;
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

                        // Extract key if it's path.join
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

                        // Just manipulate the call string. The async propagation will be dealt with.
                        // We also need to make sure the enclosing function is marked async!
                        const enclosingFunc = callExpr.getFirstAncestorByKind(SyntaxKind.FunctionDeclaration) || callExpr.getFirstAncestorByKind(SyntaxKind.ArrowFunction);
                        let doReplaceCall = true;

                        if (enclosingFunc) {
                            if (!enclosingFunc.isAsync()) {
                                const parentKind = enclosingFunc.getParent()?.getKind();
                                if (parentKind !== SyntaxKind.PropertyAssignment) {
                                    enclosingFunc.setIsAsync(true);
                                    let retType = enclosingFunc.getReturnTypeNode()?.getText();
                                    if (retType && !retType.startsWith("Promise<")) {
                                        enclosingFunc.setReturnType(`Promise<${retType}>`);
                                    }
                                    sourceFile.saveSync();
                                    keepGoing = true;
                                    doReplaceCall = false; // we saved, so nodes are invalidated, break and retry
                                }
                            }
                        }

                        if (doReplaceCall) {
                            callExpr.replaceWithText(newCallText);
                            sourceFile.saveSync();
                            keepGoing = true;
                        }

                        break; // RE-RUN LOOP
                    }
                }
            }
        }
    }
}

// Phase 3: Add Await to async helpers and Add storage type to ToolContext Interface
for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getBaseName() === "flavorConfig.ts") continue;

    let iterations = 0;
    let keepGoing = true;
    while (keepGoing && iterations++ < 100) {
        keepGoing = false;
        sourceFile.refreshFromFileSystem();

        const functions = sourceFile.getFunctions();
        const asyncFuncNames = new Set(functions.filter(f => f.isAsync()).map(f => f.getName()!));

        const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
        for (const callExpr of callExpressions) {
            const calleeName = callExpr.getExpression().getText();
            if (asyncFuncNames.has(calleeName)) {
                const parent = callExpr.getParent();
                if (parent && parent.getKind() !== SyntaxKind.AwaitExpression) {
                    callExpr.replaceWithText(`await ${callExpr.getText()}`);
                    sourceFile.saveSync();
                    keepGoing = true;
                    break;
                }
            }
        }
    }

    // add storage to ToolContext
    const contextInterface = sourceFile.getDescendantsOfKind(SyntaxKind.InterfaceDeclaration).find(i => i.getName() === "ToolContext");
    if (contextInterface) {
        const hasStorage = contextInterface.getProperty("storage");
        if (!hasStorage) {
            contextInterface.addProperty({
                name: "storage",
                type: "{ get: (key: string) => Promise<any>; set: (key: string, value: any) => Promise<void>; }"
            });
            sourceFile.saveSync();
        }
    }
}

console.log("Refactoring complete.");
