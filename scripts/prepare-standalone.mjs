import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const standaloneDir = path.join(root, ".next", "standalone");
const staticDir = path.join(root, ".next", "static");
const publicDir = path.join(root, "public");

/** Paths that must never ship inside the Electron standalone bundle. */
const STRIP_FROM_STANDALONE = [
  "dist",
  "data",
  ".git",
  ".workflow",
  ".cursor",
  "electron",
  "scripts",
  "src",
  "node_modules/.cache",
  "tsconfig.tsbuildinfo",
  "package-lock.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "eslint.config.mjs",
  "components.json",
  "next.config.ts",
  "postcss.config.mjs",
  "tsconfig.json",
];

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing directory: ${src}`);
  }
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function rmPath(target) {
  if (!fs.existsSync(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
}

if (!fs.existsSync(standaloneDir)) {
  throw new Error("Standalone build not found. Run `next build` first.");
}

for (const rel of STRIP_FROM_STANDALONE) {
  rmPath(path.join(standaloneDir, rel));
}

copyDir(staticDir, path.join(standaloneDir, ".next", "static"));
copyDir(publicDir, path.join(standaloneDir, "public"));

/**
 * Next.js file tracing often ships page runtimes but omits App Router route
 * runtimes (app-route-turbo.runtime.prod.js). Pages then return 200 while
 * /api/* returns 500. Copy all production next-server runtimes into every
 * traced next-server directory in the standalone bundle.
 */
function ensureNextServerRuntimes() {
  const srcDir = path.join(root, "node_modules", "next", "dist", "compiled", "next-server");
  if (!fs.existsSync(srcDir)) {
    throw new Error(`Missing Next.js next-server runtimes at ${srcDir}`);
  }

  const prodRuntimes = fs
    .readdirSync(srcDir)
    .filter((name) => name.endsWith(".runtime.prod.js"));

  if (prodRuntimes.length === 0) {
    throw new Error(`No *.runtime.prod.js files found in ${srcDir}`);
  }

  const destDirs = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "next-server" && dir.endsWith(`${path.sep}compiled`)) {
          destDirs.push(full);
        } else if (entry.name !== ".cache") {
          walk(full);
        }
      }
    }
  }
  walk(path.join(standaloneDir, "node_modules"));

  if (destDirs.length === 0) {
    throw new Error("No compiled/next-server directories found in standalone bundle.");
  }

  for (const destDir of destDirs) {
    for (const name of prodRuntimes) {
      fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
    }
    console.log(`Ensured ${prodRuntimes.length} next-server runtimes in ${path.relative(standaloneDir, destDir)}`);
  }
}

ensureNextServerRuntimes();
materializeTracedPackages();
rebuildSqliteForElectron();

console.log("Standalone bundle prepared for Electron packaging.");

/**
 * Next's file trace keeps Turbopack's external-package symlinks, but only
 * copies package.json for those packages. Node then fails to load Pi, and
 * teaching chat cannot read history or send. Copy each traced package and
 * its pnpm dependency closure from the project install.
 */
function materializeTracedPackages() {
  const externalRoot = path.join(standaloneDir, ".next", "node_modules");
  if (!fs.existsSync(externalRoot)) return;

  const seen = new Set();
  const links = [];
  function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) links.push(full);
      else if (entry.isDirectory()) collect(full);
    }
  }
  collect(externalRoot);

  for (const link of links) {
    const relTarget = fs.readlinkSync(link);
    const absInStandalone = path.resolve(path.dirname(link), relTarget);
    const rel = path.relative(standaloneDir, absInStandalone);
    if (rel.startsWith("..")) continue;
    const projectPkg = path.join(root, rel);
    if (fs.existsSync(projectPkg)) ensurePnpmPackage(projectPkg, seen);
  }
  console.log(`Materialized ${seen.size} traced packages into the standalone bundle`);
}

function ensurePnpmPackage(projectPath, seen) {
  const marker = `${path.sep}.pnpm${path.sep}`;
  const idx = projectPath.indexOf(marker);
  if (idx < 0) return;
  const folder = projectPath.slice(idx + marker.length).split(path.sep)[0];
  if (!folder || seen.has(folder)) return;
  seen.add(folder);

  const srcNm = path.join(root, "node_modules", ".pnpm", folder, "node_modules");
  const destNm = path.join(standaloneDir, "node_modules", ".pnpm", folder, "node_modules");
  if (!fs.existsSync(srcNm)) return;
  copyNodeModules(srcNm, destNm, seen);
}

function copyNodeModules(srcNm, destNm, seen) {
  fs.mkdirSync(destNm, { recursive: true });
  for (const name of fs.readdirSync(srcNm)) {
    copyEntry(path.join(srcNm, name), path.join(destNm, name), seen);
  }
}

function copyEntry(src, dest, seen) {
  const stat = fs.lstatSync(src);
  if (stat.isSymbolicLink()) {
    const relTarget = fs.readlinkSync(src);
    const absTarget = path.resolve(path.dirname(src), relTarget);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      if (fs.lstatSync(dest).isSymbolicLink()) {
        /* keep existing link */
      }
    } catch {
      fs.symlinkSync(relTarget, dest);
    }
    if (absTarget.startsWith(path.join(root, "node_modules", ".pnpm"))) {
      ensurePnpmPackage(absTarget, seen);
    }
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      copyEntry(path.join(src, name), path.join(dest, name), seen);
    }
    return;
  }
  if (path.basename(dest) === "better_sqlite3.node" && fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
}

/** The desktop app runs this copy under Electron's Node (ABI 148), not system Node. */
function rebuildSqliteForElectron() {
  const electronDir = path.join(root, "node_modules", "electron");
  const version = JSON.parse(fs.readFileSync(path.join(electronDir, "package.json"), "utf8")).version;
  const sqliteDir = path.join(standaloneDir, "node_modules", "better-sqlite3");
  const sourceDir = path.join(root, "node_modules", "better-sqlite3");
  const nodeGyp = path.join(root, "node_modules", "node-gyp", "bin", "node-gyp.js");
  if (!fs.existsSync(path.join(sourceDir, "binding.gyp"))) {
    throw new Error("Project better-sqlite3 is missing binding.gyp");
  }
  if (!fs.existsSync(nodeGyp)) {
    throw new Error(`node-gyp not found at ${nodeGyp}`);
  }
  for (const name of ["binding.gyp", "deps", "src"]) {
    const dest = path.join(sqliteDir, name);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(path.join(sourceDir, name), dest, { recursive: true });
  }
  execFileSync(
    process.execPath,
    [
      nodeGyp,
      "rebuild",
      `--target=${version}`,
      `--arch=${process.arch}`,
      "--dist-url=https://electronjs.org/headers",
    ],
    {
      stdio: "inherit",
      cwd: sqliteDir,
      env: {
        ...process.env,
        npm_config_runtime: "electron",
        npm_config_target: version,
        npm_config_arch: process.arch,
        npm_config_disturl: "https://electronjs.org/headers",
      },
    },
  );
  for (const name of ["binding.gyp", "deps", "src"]) {
    fs.rmSync(path.join(sqliteDir, name), { recursive: true, force: true });
  }
  console.log(`Rebuilt standalone better-sqlite3 for Electron ${version}`);
}
