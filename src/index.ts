#!/usr/bin/env node
import chowkidar from "chokidar";
import path from "path";
import child_process from "child_process";
import tree_kill from "tree-kill";

const spawn = child_process.spawn;

class daenode {
  private processExited = false;
  private nodeProcess!: child_process.ChildProcessByStdio<null, null, null>;
  private pathsToWatch = [
    path.join(process.cwd(), "/**/*.js"),
    path.join(process.cwd(), "/**/*.json"),
    path.join(process.cwd(), "/**/*.env.*"),
  ];
  constructor() {
    if (process.argv.length !== 3)
      console.error(
        `Expected 1 argument, recieved ${process.argv.length - 2} arguments`
      );
    else {
      this.init();
    }
  }
  init = async () => {
    this.nodeProcess = this.startProcess();
    this.watchFiles();
    process.once("SIGINT", async () => await this.exit("SIGINT"));
    process.once("SIGTERM", async () => await this.exit("SIGTERM"));
  };
  private exit = async (signal: string) => {
    this.print("debug", "Detected " + signal);
    await this.stopProcess(this.nodeProcess);
    process.exit();
  };
  private watchFiles = () => {
    chowkidar
      .watch(this.pathsToWatch, {
        ignored: "**/node_modules/*",
        ignoreInitial: true,
      })
      .on("all", async () => {
        this.print("info", "File changed");
        await this.stopProcess(this.nodeProcess);
        this.nodeProcess = this.startProcess();
        this.processExited = false;
      });
  };
  private print = (type: keyof Console, message: string) => {
    console[type](`[DAENODE]: ${message}`);
  };
  private startProcess = () => {
    // Why spawn - https://stackoverflow.com/questions/48698234/node-js-spawn-vs-execute
    const nodeProcess = spawn("node", [process.argv[2], "--colors"], {
      stdio: [process.stdin, process.stdout, process.stderr],
    });
    // First exit happens and then close
    // Exit ->child process exits but stdio is not closed
    // Close -> Child process stdio is also closed
    //   nodeProcess.on("exit", (code) => {
    //     this.print("log",`Process ${nodeProcess.pid} exited with code ${code}`);
    //   });
    nodeProcess.on("close", (code, signal) => {
      this.processExited = true;
      this.print(
        "log",
        `Process ${nodeProcess.pid} exited with ${
          code ? `code ${code}` : `signal ${signal}`
        }`
      );
    });
    nodeProcess.on("error", (err) => {
      this.processExited = true;
      // Ref: https://nodejs.org/docs/latest-v14.x/api/child_process.html
      this.print("log", `Failed to start process ${process.argv[2]}`);
    });
    return nodeProcess;
  };

  private stopProcess = async (
    targetProcess: child_process.ChildProcessByStdio<null, null, null>
  ) => {
    if (this.processExited) return true;
    this.print("debug", `Stopping process ${targetProcess.pid}`);
    return new Promise<boolean>((resolve, reject) => {
      tree_kill(targetProcess.pid, "SIGTERM", (err) => {
        if (err)
          tree_kill(targetProcess.pid, "SIGKILL", () => {
            this.processExited = true;
            resolve(true);
          });
        else {
          this.processExited = true;
          resolve(true);
        }
      });
    });
  };
}
new daenode();
