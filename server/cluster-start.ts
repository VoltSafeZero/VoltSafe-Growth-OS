/**
 * Cluster entry point — multiplies request throughput across all available CPUs.
 *
 * Usage:
 *   Development:  NUM_WORKERS=2 npx tsx server/cluster-start.ts
 *   Production:   NUM_WORKERS=2 node dist/cluster-start.cjs
 *
 * Only worker 0 starts background schedulers (Gmail sync, calendar, etc.).
 * All other workers set ENABLE_BACKGROUND_JOBS=false to prevent duplicate jobs.
 *
 * With Replit's 2-CPU environment, NUM_WORKERS=2 doubles effective throughput
 * for CPU-bound operations and halves wait time under concurrent load.
 */

import cluster from "cluster";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NUM_WORKERS = Math.min(
  parseInt(process.env.NUM_WORKERS || String(os.cpus().length), 10),
  os.cpus().length
);

if (!cluster.isPrimary) {
  // Worker process: boot the actual server
  await import("./index.js");
} else {
  // Primary process: spawn workers
  const workerExec = process.execArgv.includes("--import") || process.execArgv.some(a => a.includes("tsx"))
    ? path.resolve(__dirname, "index.ts")
    : path.resolve(__dirname, "index.js");

  (cluster as any).setupPrimary?.({ exec: workerExec }) ||
    (cluster as any).setupMaster?.({ exec: workerExec });

  console.log(`[cluster] Primary PID ${process.pid} — spawning ${NUM_WORKERS} worker(s)`);

  for (let i = 0; i < NUM_WORKERS; i++) {
    const workerEnv = {
      ...process.env,
      ENABLE_BACKGROUND_JOBS: i === 0 ? "true" : "false",
      WORKER_INDEX: String(i),
    };
    cluster.fork(workerEnv);
  }

  cluster.on("online", (worker) => {
    console.log(`[cluster] Worker ${worker.process.pid} online`);
  });

  cluster.on("exit", (worker, code, signal) => {
    const bg = (worker as any).process.env?.ENABLE_BACKGROUND_JOBS ?? "false";
    console.log(`[cluster] Worker ${worker.process.pid} exited (${code}/${signal}) — respawning`);
    cluster.fork({
      ...process.env,
      ENABLE_BACKGROUND_JOBS: "false", // Safe default for auto-respawned workers
    });
  });
}
