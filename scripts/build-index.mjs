// Writes index.json from the plugins themselves: each script runs once against a stand-in
// `Monav`, and what it registers becomes its entry.
//
//   node scripts/build-index.mjs
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const folder = join(root, "plugins");

const plugins = readdirSync(folder).filter(name => name.endsWith(".js")).sort().map(name => {
  let registered = null;
  const Monav = {
    register: plugin => { registered = plugin; },
    storage: { get: () => null, set: () => {} },
    setting: () => null,
    sleep: async () => {},
    uuid: () => "00000000-0000-0000-0000-000000000000",
    distance: () => 0,
  };
  const console = { log() {}, warn() {}, error() {} };
  vm.runInNewContext(readFileSync(join(folder, name), "utf8"), { Monav, console, fetch: async () => { throw new Error("no network"); } },
                     { filename: name });
  if (!registered?.id) throw new Error(`${name}: Monav.register({ id, … }) missing`);
  return {
    id: registered.id,
    name: registered.name ?? registered.id,
    version: registered.version ?? "1.0",
    description: registered.description,
    provides: registered.provides ?? [],
    hosts: registered.hosts ?? [],
    file: `plugins/${name}`,
  };
});

writeFileSync(join(root, "index.json"), JSON.stringify({ name: "Monav Plugins", plugins }, null, 2) + "\n");
console.log(`index.json: ${plugins.map(p => `${p.id} ${p.version}`).join(", ")}`);
