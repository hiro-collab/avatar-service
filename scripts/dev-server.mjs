import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const statePath = resolve(root, ".dev-server.json");
const logPath = resolve(root, ".dev-server.log");
const viteCliPath = resolve(root, "node_modules", "vite", "bin", "vite.js");
const defaultHost = "127.0.0.1";
const preferredPort = 5173;
const readyTimeoutMs = 15_000;

const command = process.argv[2] ?? "status";

if (command === "start") {
  await start();
} else if (command === "stop") {
  stop();
} else if (command === "status") {
  await status();
} else {
  console.error(`Unknown command: ${command}`);
  process.exitCode = 1;
}

async function start() {
  const existing = readState();
  if (existing && isProcessAlive(existing.pid)) {
    const ready = await isReady(existing.url, 1_000);
    if (ready) {
      console.log(`Dev server already running: ${existing.url} pid=${existing.pid}`);
      return;
    }

    console.error(`PID ${existing.pid} exists, but ${existing.url} is not responding.`);
    console.error("Run npm run dev:stop before starting a new detached server.");
    process.exitCode = 1;
    return;
  }

  const port = await findAvailablePort(preferredPort, 20);
  const url = `http://${defaultHost}:${port}/`;
  const logFd = openSync(logPath, "a");
  writeFileSync(logFd, `\n[${new Date().toISOString()}] starting dev server on ${url}\n`);

  const child = spawn(process.execPath, [viteCliPath, "--host", defaultHost, "--port", String(port), "--strictPort", "--clearScreen", "false"], {
    cwd: root,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true
  });

  child.unref();
  if (!child.pid) {
    console.error("Failed to start dev server: child pid was not assigned.");
    process.exitCode = 1;
    return;
  }

  writeState({ pid: child.pid, url, startedAt: new Date().toISOString() });

  const ready = await waitUntilReady(url, readyTimeoutMs);
  if (!ready) {
    console.error(`Dev server did not become ready within ${readyTimeoutMs / 1000}s.`);
    console.error(`Recorded pid=${child.pid}. Run npm run dev:stop to clean it up.`);
    console.error(`Log file: ${logPath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Dev server ready: ${url} pid=${child.pid}`);
}

function stop() {
  const state = readState();
  if (!state) {
    console.log("No detached dev server state found.");
    return;
  }

  if (isProcessAlive(state.pid)) {
    try {
      process.kill(state.pid);
      console.log(`Stopped dev server pid=${state.pid}`);
    } catch (error) {
      console.error(`Failed to stop pid=${state.pid}: ${formatError(error)}`);
      process.exitCode = 1;
      return;
    }
  } else {
    console.log(`Recorded dev server pid=${state.pid} is not running.`);
  }

  removeState();
}

async function status() {
  const state = readState();
  if (!state) {
    console.log("Dev server is not recorded as running.");
    return;
  }

  const alive = isProcessAlive(state.pid);
  const ready = alive && (await isReady(state.url, 1_000));
  console.log(`pid=${state.pid} alive=${alive} ready=${ready} url=${state.url}`);

  if (!alive) {
    removeState();
  }
}

async function waitUntilReady(url, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReady(url, 750)) {
      return true;
    }
    await delay(300);
  }
  return false;
}

async function isReady(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function readState() {
  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8"));
    if (typeof parsed.pid === "number" && typeof parsed.url === "string") {
      return parsed;
    }
  } catch {
    removeState();
  }

  return null;
}

function writeState(state) {
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function removeState() {
  if (existsSync(statePath)) {
    unlinkSync(statePath);
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, ms);
  });
}

async function findAvailablePort(startPort, attempts) {
  for (let port = startPort; port < startPort + attempts; port += 1) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(`No available port found from ${startPort} to ${startPort + attempts - 1}.`);
}

function isPortAvailable(port) {
  return new Promise((resolveAvailable) => {
    const server = createServer();
    server.once("error", () => resolveAvailable(false));
    server.once("listening", () => {
      server.close(() => resolveAvailable(true));
    });
    server.listen(port, defaultHost);
  });
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
