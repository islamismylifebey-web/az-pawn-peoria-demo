// Adds (or resets) a Command Center login. Run it yourself on a computer that
// is signed in to Cloudflare. The password is typed here and only its one-way
// hash leaves this computer.
// Usage: node tools/add-staff.mjs <username> [--local]
import { webcrypto as crypto } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline";

const user = (process.argv[2] || "").trim();
if (!/^[A-Za-z0-9._-]{2,40}$/.test(user)) { console.error("Usage: node tools/add-staff.mjs <username>"); process.exit(1); }
// Reads typed lines without echoing them to the screen.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
rl._writeToOutput = () => {};
const lines = [], waiting = [];
rl.on("line", l => (waiting.length ? waiting.shift()(l) : lines.push(l)));
const ask = p => { process.stdout.write(p); return new Promise(r => (lines.length ? r(lines.shift()) : waiting.push(r))).then(a => { process.stdout.write("\n"); return a; }); };
const pw = await ask("Password (12+ characters): ");
const again = await ask("Type it again: ");
rl.close();
if (pw.length < 12 || pw !== again) { console.error("Passwords must match and be at least 12 characters."); process.exit(1); }

const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
const hash = hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256));
const stored = `pbkdf2-sha256$100000$${hex(salt)}$${hash}`;
const now = new Date().toISOString().slice(0, 19) + "+00:00";
const sql = `INSERT INTO staff (username, password_hash, created_at) VALUES ('${user}', '${stored}', '${now}') ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash;`;
const where = process.argv.includes("--local") ? "--local" : "--remote";
execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["wrangler", "d1", "execute", "az-jewelry-store", where, "--command", sql],
  { stdio: "inherit", shell: process.platform === "win32" });
console.log(`Staff login "${user}" is ready.`);
