import { execFileSync, spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const composeFile = resolve(root, "infra/test/docker-compose.yaml");
const project = "papertrail-w1-test";
const compose = (args, options = {}) => execFileSync("docker", ["compose", "-p", project, "-f", composeFile, ...args], { stdio: ["pipe", "inherit", "inherit"], ...options });
const sql = (file) =>
  compose(["exec", "-T", "database", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "papertrail", "-f", "-"], {
    input: readFileSync(resolve(root, file)),
  });

const sqlAsync = (file) =>
  new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "-p", project, "-f", composeFile, "exec", "-T", "database", "psql", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "papertrail", "-f", "-"], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stderr }));
    child.stdin.end(readFileSync(resolvePath(file)));
  });

const resolvePath = (file) => resolve(root, file);

try {
  compose(["up", "--wait", "--quiet-pull"]);
  sql("tests/integration/sql/bootstrap.sql");
  for (const migration of readdirSync(resolve(root, "supabase/migrations")).filter((file) => file.endsWith(".sql")).sort()) {
    sql(`supabase/migrations/${migration}`);
  }
  sql("tests/integration/sql/seed.sql");
  sql("tests/integration/sql/w1-foundation.sql");
  sql("tests/integration/sql/job-leases.sql");
  const first = sqlAsync("tests/integration/sql/concurrent-reservation-first.sql");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  const second = sqlAsync("tests/integration/sql/concurrent-reservation-second.sql");
  const concurrent = await Promise.all([first, second]);
  if (concurrent.filter((result) => result.code === 0).length !== 1 || concurrent.filter((result) => result.code !== 0).length !== 1) {
    throw new Error(`A35 failed: expected one concurrent reservation admission. ${concurrent.map((result) => result.stderr).join("\n")}`);
  }
  sql("tests/integration/sql/assert-concurrent-reservation.sql");
  console.log("W1 database integration tests passed: partial A01–A04, server-owned document intake/outbox, D12 candidate boundary, A16/A18/A42 lease fencing, A35, and A36.");
} finally {
  try {
    compose(["down", "--volumes", "--remove-orphans"]);
  } catch {
    // Preserve the preceding test result. This is a disposable tmpfs-only test database.
  }
}
