import { spawn } from "node:child_process";

const children = [
  spawn("node", ["--watch", "src/server/server.ts"], { stdio: "inherit" }),
  spawn("pnpm", ["exec", "vite"], { stdio: "inherit" }),
];

let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  process.exit(code ?? 0);
}

for (const child of children) {
  child.on("exit", (code) => shutdown(code ?? 0));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => shutdown(0));
}
