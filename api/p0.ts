import { Project } from "ts-morph";
import * as path from "path";

const project = new Project({ tsConfigFilePath: "./tsconfig.json" });
const toolsDir = path.join(process.cwd(), "src/tools");
project.addSourceFilesAtPaths(`${toolsDir}/**/*.ts`);

for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.getBaseName() === "flavorConfig.ts") continue;

    for (const func of sourceFile.getFunctions()) {
        if (func.getName() === "execute") continue;
        const workdirParam = func.getParameters().find(p => p.getName() === "workdir");
        if (workdirParam) {
            workdirParam.rename("context");
            workdirParam.setType("ToolContext");
        }
    }
    sourceFile.saveSync();
}
console.log("p0 done");
