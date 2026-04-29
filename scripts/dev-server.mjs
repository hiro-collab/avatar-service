import { spawn } from "node:child_process";
import { existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const scriptPath = resolve(import.meta.dirname, "dev-server.mjs");
const defaultStatusPath = resolve(root, ".dev-server.json");
const logPath = resolve(root, ".dev-server.log");
const viteCliPath = resolve(root, "node_modules", "vite", "bin", "vite.js");
const moduleName = "avatar-service";
const defaultHost = "127.0.0.1";
const defaultPort = 5173;
const defaultReadyTimeoutMs = 15_000;
const defaultStopTimeoutMs = 10_000;

const { command, options } = parseArgs(process.argv.slice(2));

try {
  if (command === "run") {
    await runForeground(options);
  } else if (command === "start") {
    await startDetached(options);
  } else if (command === "stop") {
    await stopRecordedProcess(options);
  } else if (command === "status") {
    await printStatus(options);
  } else if (command === "health") {
    await printHealth(options);
  } else {
    console.error(`Unknown command: ${command}`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(formatError(error));
  process.exitCode = 1;
}

async function runForeground(options) {
  const host = options.host;
  const port = options.port;
  const url = baseUrl(host, port);
  const startedAt = new Date().toISOString();
  let viteProcess = null;
  let shuttingDown = false;

  await assertPortAvailable(host, port);

  writeRuntimeStatus(options, {
    state: "running",
    pid: process.pid,
    parent_pid: process.ppid,
    started_at: startedAt,
    host,
    port,
    health_url: null,
    health_command: healthCommand(options),
    shutdown_url: null,
    shutdown_command: shutdownCommand(options),
    command_line: commandLine(process.argv),
    url
  });

  const logFd = openSync(logPath, "a");
  writeFileSync(logFd, `\n[${startedAt}] running Vite dev server on ${url}\n`);

  viteProcess = spawn(
    process.execPath,
    [viteCliPath, "--host", host, "--port", String(port), "--strictPort", "--clearScreen", "false"],
    {
      cwd: root,
      env: {
        ...process.env,
        AVATAR_SERVICE_HOST: host,
        AVATAR_SERVICE_PORT: String(port),
        AVATAR_SERVICE_RUNTIME_STATUS_FILE: options.runtimeStatusFile,
        AVATAR_SERVICE_STARTED_AT: startedAt
      },
      stdio: ["ignore", "inherit", "inherit"],
      windowsHide: true
    }
  );

  const shutdown = (reason) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`avatar-service dev server stopping: ${reason}`);
    if (viteProcess && isProcessAlive(viteProcess.pid)) {
      try {
        process.kill(viteProcess.pid, "SIGTERM");
      } catch {
        // Child may already be gone.
      }
    }
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  viteProcess.on("exit", (code, signal) => {
    const stoppedAt = new Date().toISOString();
    writeRuntimeStatus(options, {
      state: "stopped",
      pid: process.pid,
      parent_pid: process.ppid,
      started_at: startedAt,
      stopped_at: stoppedAt,
      host,
      port,
      health_url: null,
      health_command: healthCommand(options),
      shutdown_url: null,
      shutdown_command: shutdownCommand(options),
      command_line: commandLine(process.argv),
      url,
      exit_code: code,
      signal
    });
    console.log(`avatar-service dev server stopped: code=${code ?? "null"} signal=${signal ?? "null"}`);
    process.exitCode = code ?? (signal ? 0 : 1);
  });
}

async function startDetached(options) {
  const existing = readRuntimeStatus(options.runtimeStatusFile);
  if (existing && existing.state === "running" && isProcessAlive(existing.pid)) {
    const ready = await isReady(existing.url, 1_000);
    if (ready) {
      console.log(`Dev server already running: ${existing.url} pid=${existing.pid}`);
      return;
    }
    throw new Error(`Recorded pid=${existing.pid} is alive but ${existing.url} is not ready. Run npm run dev:stop first.`);
  }

  await assertPortAvailable(options.host, options.port);

  const logFd = openSync(logPath, "a");
  writeFileSync(logFd, `\n[${new Date().toISOString()}] starting detached dev server on ${baseUrl(options.host, options.port)}\n`);

  const child = spawn(process.execPath, runArgs(options), {
    cwd: root,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true
  });

  child.unref();
  if (!child.pid) {
    throw new Error("Failed to start dev server: child pid was not assigned.");
  }

  const url = baseUrl(options.host, options.port);
  const ready = await waitUntilReady(url, options.readyTimeoutMs);
  if (!ready) {
    console.error(`Dev server did not become ready within ${options.readyTimeoutMs / 1000}s.`);
    console.error(`Recorded pid=${child.pid}. Run npm run dev:stop to clean it up.`);
    console.error(`Log file: ${logPath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Dev server ready: ${url} pid=${child.pid}`);
}

async function stopRecordedProcess(options) {
  const state = readRuntimeStatus(options.runtimeStatusFile);
  if (!state) {
    console.log("No dev server status file found.");
    return;
  }

  if (state.module !== moduleName) {
    throw new Error(`Refusing to stop status file for module=${state.module}`);
  }

  if (!isProcessAlive(state.pid)) {
    writeRuntimeStatus(options, {
      ...state,
      state: "stopped",
      stopped_at: state.stopped_at ?? new Date().toISOString()
    });
    console.log(`Recorded dev server pid=${state.pid} is not running.`);
    return;
  }

  process.kill(state.pid, "SIGTERM");
  const stopped = await waitUntilStopped(state.pid, defaultStopTimeoutMs);
  if (!stopped) {
    throw new Error(`Timed out waiting for dev server pid=${state.pid} to stop.`);
  }

  const latest = readRuntimeStatus(options.runtimeStatusFile) ?? state;
  writeRuntimeStatus(options, {
    ...latest,
    state: "stopped",
    stopped_at: latest.stopped_at ?? new Date().toISOString()
  });
  console.log(`Stopped dev server pid=${state.pid}`);
}

async function printStatus(options) {
  const state = readRuntimeStatus(options.runtimeStatusFile);
  if (!state) {
    console.log("Dev server is not recorded as running.");
    return;
  }

  const health = await healthFromState(state);
  if (options.json) {
    console.log(JSON.stringify(health, null, 2));
    return;
  }

  console.log(
    `pid=${health.pid ?? "-"} alive=${health.alive} ready=${health.ready} state=${health.state} url=${state.url ?? "-"}`
  );
}

async function printHealth(options) {
  const state = readRuntimeStatus(options.runtimeStatusFile);
  const health = state
    ? await healthFromState(state)
    : {
        ok: false,
        module: moduleName,
        state: "missing",
        pid: null,
        uptime_s: 0,
        host: options.host,
        port: options.port,
        alive: false,
        ready: false
      };

  console.log(JSON.stringify(health, null, 2));
  process.exitCode = health.ok ? 0 : 1;
}

async function healthFromState(state) {
  const alive = isProcessAlive(state.pid);
  const ready = alive && (await isReady(state.url, 1_000));
  const uptimeS = state.started_at ? Math.max(0, (Date.now() - Date.parse(state.started_at)) / 1000) : 0;
  return {
    ok: alive && ready && state.state === "running",
    module: state.module,
    state: alive ? state.state : "stopped",
    pid: state.pid,
    parent_pid: state.parent_pid,
    uptime_s: Number(uptimeS.toFixed(3)),
    host: state.host,
    port: state.port,
    alive,
    ready,
    health_url: state.health_url,
    health_command: state.health_command,
    shutdown_url: state.shutdown_url,
    shutdown_command: state.shutdown_command
  };
}

function parseArgs(argv) {
  const parsed = {
    command: argv[0] ?? "status",
    options: {
      host: defaultHost,
      port: defaultPort,
      runtimeStatusFile: defaultStatusPath,
      readyTimeoutMs: defaultReadyTimeoutMs,
      json: false
    }
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--host") {
      parsed.options.host = requiredValue(argv, ++index, arg);
    } else if (arg === "--port") {
      parsed.options.port = parsePort(requiredValue(argv, ++index, arg));
    } else if (arg === "--runtime-status-file") {
      parsed.options.runtimeStatusFile = resolve(root, requiredValue(argv, ++index, arg));
    } else if (arg === "--ready-timeout-ms") {
      parsed.options.readyTimeoutMs = Math.max(1_000, Number(requiredValue(argv, ++index, arg)));
    } else if (arg === "--json") {
      parsed.options.json = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parsePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return port;
}

function runArgs(options) {
  return [
    scriptPath,
    "run",
    "--host",
    options.host,
    "--port",
    String(options.port),
    "--runtime-status-file",
    options.runtimeStatusFile
  ];
}

function baseUrl(host, port) {
  return `http://${host}:${port}/`;
}

async function assertPortAvailable(host, port) {
  if (!(await isPortAvailable(host, port))) {
    throw new Error(`Port ${port} is already in use on ${host}. Strict port mode refuses to use another port.`);
  }
}

function isPortAvailable(host, port) {
  return new Promise((resolveAvailable) => {
    const server = createServer();
    server.once("error", () => resolveAvailable(false));
    server.once("listening", () => {
      server.close(() => resolveAvailable(true));
    });
    server.listen(port, host);
  });
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
  if (!url) {
    return false;
  }

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

function waitUntilStopped(pid, timeoutMs) {
  return new Promise((resolveStopped) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (!isProcessAlive(pid)) {
        clearInterval(timer);
        resolveStopped(true);
      } else if (Date.now() - startedAt >= timeoutMs) {
        clearInterval(timer);
        resolveStopped(false);
      }
    }, 150);
  });
}

function readRuntimeStatus(path) {
  if (!existsSync(path)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed.pid === "number" && typeof parsed.module === "string") {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function writeRuntimeStatus(options, state) {
  const payload = {
    module: moduleName,
    ...state
  };
  writeFileSync(options.runtimeStatusFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function healthCommand(options) {
  return `node scripts/dev-server.mjs health --runtime-status-file ${options.runtimeStatusFile}`;
}

function shutdownCommand(options) {
  return `node scripts/dev-server.mjs stop --runtime-status-file ${options.runtimeStatusFile}`;
}

function commandLine(argv) {
  return argv.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ");
}

function isProcessAlive(pid) {
  if (typeof pid !== "number" || pid <= 0) {
    return false;
  }

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

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
