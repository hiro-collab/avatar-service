import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");
const tmpDir = resolve(root, ".tmp", "dev-server-smoke");
const statusPath = resolve(tmpDir, "runtime-status.json");
const nestedStatusPath = resolve(tmpDir, "nested", "runtime", "status.json");
const port = 5199;
const runningPort = 5200;

rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

await withPortInUse(port, async () => {
  const result = runDevServer(["start", "--port", String(port), "--runtime-status-file", statusPath]);
  assert(result.status !== 0, "start should fail when the requested port is already in use");
  assert(
    combinedOutput(result).includes("Strict port mode refuses to use another port"),
    "strict port failure message should be explicit"
  );
});

const health = runDevServer(["health", "--runtime-status-file", statusPath, "--json"]);
assert(health.status !== 0, "health should be non-zero when no runtime is running");
assert(combinedOutput(health).includes('"ok": false'), "health output should include ok=false");

const started = runDevServer(["start", "--port", String(runningPort), "--runtime-status-file", nestedStatusPath]);
assert(started.status === 0, `start should create missing status parents: ${combinedOutput(started)}`);
assert(existsSync(nestedStatusPath), "runtime status should be written under a missing parent directory");
const stopped = runDevServer(["stop", "--runtime-status-file", nestedStatusPath]);
assert(stopped.status === 0, `stop should succeed for the nested runtime status: ${combinedOutput(stopped)}`);

rmSync(tmpDir, { recursive: true, force: true });
console.log("dev-server smoke checks passed");

function runDevServer(args) {
  return spawnSync(process.execPath, [resolve(root, "scripts", "dev-server.mjs"), ...args], {
    cwd: root,
    encoding: "utf8"
  });
}

function withPortInUse(portToBind, callback) {
  return new Promise((resolveSmoke, rejectSmoke) => {
    const server = createServer();
    server.once("error", rejectSmoke);
    server.listen(portToBind, "127.0.0.1", async () => {
      try {
        await callback();
        server.close(resolveSmoke);
      } catch (error) {
        server.close(() => rejectSmoke(error));
      }
    });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function combinedOutput(result) {
  return `${result.stdout || ""}${result.stderr || ""}`;
}
