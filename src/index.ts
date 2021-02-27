#!/usr/bin/env node
import chowkidar from "chokidar";
import path from "path";
import child_process from "child_process";
import tree_kill from "tree-kill";

const spawn = child_process.spawn;
console.debug(__dirname);
console.debug(process.cwd());

const pathsToWatch = [
  path.join(process.cwd(), "/**/*.js"),
  path.join(process.cwd(), "/**/*.json"),
  path.join(process.cwd(), "/**/*.env.*"),
];

console.log(pathsToWatch);

let processExited = false;

const startProcess = () => {
  // Why spawn - https://stackoverflow.com/questions/48698234/node-js-spawn-vs-execute
  const nodeProcess = spawn("node", [process.argv[2], "--colors"], {
    stdio: [process.stdin, process.stdout, process.stderr],
  });
  // First exit happens and then close
  // Exit ->child process exits but stdio is not closed
  // Close -> Child process stdio is also closed
  //   nodeProcess.on("exit", (code) => {
  //     console.log(`Process ${nodeProcess.pid} exited with code ${code}`);
  //   });
  nodeProcess.on("close", (code, signal) => {
    processExited = true;
    console.log(
      `Process ${nodeProcess.pid} exited with ${
        code ? `code ${code}` : `signal ${signal}`
      }`
    );
  });
  nodeProcess.on("error", (err) => {
    processExited = true;
    // Ref: https://nodejs.org/docs/latest-v14.x/api/child_process.html
    console.log(`Failed to start process ${process.argv[2]}`);
  });
  return nodeProcess;
};

const stopProcess = async (
  targetProcess: child_process.ChildProcessByStdio<null, null, null>
) => {
  if (processExited) return true;
  console.debug(`Stopping process ${targetProcess.pid}`);
  return new Promise<boolean>((resolve, reject) => {
    tree_kill(targetProcess.pid, "SIGTERM", (err) => {
      if (err)
        tree_kill(targetProcess.pid, "SIGKILL", () => {
          processExited = true;
          resolve(true);
        });
      else {
        processExited = true;
        resolve(true);
      }
    });
  });
};

if (process.argv.length !== 3)
  console.error(
    `Expected 1 argument, recieved ${process.argv.length - 2} arguments`
  );
else {
  let nodeProcess = startProcess();
  chowkidar
    .watch(pathsToWatch, { ignored: "**/node_modules/*", ignoreInitial: true })
    .on("all", async () => {
      console.info("File changed");
      await stopProcess(nodeProcess);
      nodeProcess = startProcess();
      processExited = false;
    });
  process.once("exit", async () => {
    await stopProcess(nodeProcess);
    console.log("exiting");
  });
  process.once("SIGINT", async () => {
    await stopProcess(nodeProcess);
    console.log("SIGINT");
    process.exit();
  });
  process.once("SIGTERM", async () => {
    await stopProcess(nodeProcess);
    console.log("SIGTERM");
    process.exit();
  });
}
