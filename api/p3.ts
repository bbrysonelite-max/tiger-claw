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
        const functions = sourceFile.getFunctions();
        const asyncFuncNames = new Set(functions.filter(f => f.isAsync()).map(f => f.getName()!));

        const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);
        for (const callExpr of callExpressions) {
            const calleeName = callExpr.getExpression().getText();
            if (asyncFuncNames.has(calleeName)) {
                const parent = callExpr.getParent();
                if (parent && parent.getKind() !== SyntaxKind.AwaitExpression) {
                    const text = callExpr.getText();
                    sourceFile.replaceText([callExpr.getStart(), callExpr.getEnd()], `await ${text}`);
                    sourceFile.saveSync();
                    changed = true;
                    break;
                }
            }
        }
    }
}
console.log("p3 done");
