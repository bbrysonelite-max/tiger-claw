import { Project } from "ts-morph";
import * as path from "path";

const project = new Project({ tsConfigFilePath: "./tsconfig.json" });
const toolsDir = path.join(process.cwd(), "src/tools");
project.addSourceFilesAtPaths(`${toolsDir}/**/*.ts`);

for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getBaseName() === "flavorConfig.ts") continue;

    for (const func of sourceFile.getFunctions()) {
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
            }
        }
    }
    sourceFile.saveSync();
}
console.log("p1 done");
