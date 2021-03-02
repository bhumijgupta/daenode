#!/usr/bin/env node
import chowkidar from "chokidar";
import path from "path";
import childProcess from "child_process";
import treeKill from "tree-kill";
import { Writable } from "stream";

type restartEvent = "Manual reload" | "File change";

class Daenode {
  private processExited = false;
  private previousReload: undefined | NodeJS.Timeout;
  private nodeProcess!: childProcess.ChildProcessByStdio<Writable, null, null>;
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
    process.once("SIGINT", async () => await this.exitHandler("SIGINT"));
    process.once("SIGTERM", async () => await this.exitHandler("SIGTERM"));
    process.stdin.on("data", async (chunk) => {
      const str = chunk.toString();
      if (str === "rs\n") {
        await this.reload("Manual reload");
      }
    });
  };

  private reload = async (event: restartEvent) => {
    this.print("info", `${event} detected. Restarting process`);
    if (!this.processExited) {
      await this.stopProcess();
    }
    this.nodeProcess = this.startProcess();
  };

  private exitHandler = async (signal: string) => {
    this.print("debug", `Detected ${signal}. Exiting...`);
    await this.stopProcess();
    process.exit();
  };

  private watchFiles = () => {
    chowkidar
      .watch(this.pathsToWatch, {
        ignored: "**/node_modules/*",
        ignoreInitial: true,
      })
      .on("all", async () => {
        // Debounce
        let timeoutKey = setTimeout(async () => {
          if (this.previousReload) clearTimeout(this.previousReload);
          await this.reload("File change");
        }, 1000);
        this.previousReload = timeoutKey;
      });
  };

  private print = (type: keyof Console, message: string) => {
    console[type](`[DAENODE]: ${message}`);
  };

  private startProcess = () => {
    // Why spawn - https://stackoverflow.com/questions/48698234/node-js-spawn-vs-execute
    const nodeProcess = childProcess.spawn("node", [process.argv[2]], {
      stdio: ["pipe", process.stdout, process.stderr],
    });
    this.processExited = false;
    // First exit happens and then close
    // Exit ->child process exits but stdio is not closed
    // Close -> Child process stdio is also closed
    //   nodeProcess.on("exit", (code) => {
    //     this.print("log",`Process ${nodeProcess.pid} exited with code ${code}`);
    //   });
    process.stdin.pipe(nodeProcess.stdin);
    nodeProcess.stdin.on("close", () => {
      process.stdin.unpipe(nodeProcess.stdin);
      process.stdin.resume();
    });
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
      this.print("log", `Failed to start process ${process.argv[2]}`);
    });
    return nodeProcess;
  };

  private stopProcess = async () => {
    if (this.processExited) return true;
    return new Promise<boolean>((resolve, reject) => {
      treeKill(this.nodeProcess.pid, "SIGTERM", (err) => {
        if (err) treeKill(this.nodeProcess.pid, "SIGKILL", () => {});
      });
      const key = setInterval(() => {
        if (this.processExited) {
          clearInterval(key);
          resolve(true);
        }
      }, 500);
    });
  };
}
new Daenode();
