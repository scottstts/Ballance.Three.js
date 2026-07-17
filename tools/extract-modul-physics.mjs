/**
 * Extracts per-part physics parameter tables from the Ballance Unity Rebuild
 * prefab YAMLs (numeric facts of the original game's physics tuning).
 * Usage: node tools/extract-modul-physics.mjs <path-to-imengyu-ballance> > docs/modul-physics.json
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2];
if (!repo) {
  console.error('usage: node tools/extract-modul-physics.mjs <imengyu-ballance-repo>');
  process.exit(1);
}
const dir = join(repo, 'Assets/Game/GamePlay/Prefabs/Moduls');

const INTERESTING = [
  'm_Mass', 'm_Friction', 'm_Elasticity', 'm_LinearSpeedDamping', 'm_RotSpeedDamping',
  'm_Fixed', 'm_StartFrozen', 'm_UseBall', 'm_BallRadius', 'm_ShiftMassCenter',
  'm_EnableConstantForce', 'm_EnableGravity', 'm_AutoMassCenter', 'm_Layer',
  'Force', 'MaxForce', 'SwitchTime', 'DelayTime', 'P_Modul_18_Force',
];

function parseDoc(doc) {
  const out = {};
  const lines = doc.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^\s{2}(m?_?[A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const [, key, raw] = m;
    if (key === 'm_Name' && !('name' in out)) out.name = raw.trim();
    if (key === 'm_GameObject') {
      const fm = /fileID:\s*(-?\d+)/.exec(raw);
      if (fm) out.owner = fm[1];
    }
    if (INTERESTING.includes(key)) {
      let v = raw.trim();
      const vec = /^\{x:\s*(-?[\d.e+-]+),\s*y:\s*(-?[\d.e+-]+),\s*z:\s*(-?[\d.e+-]+)\}$/.exec(v);
      if (vec) out[key] = [Number(vec[1]), Number(vec[2]), Number(vec[3])];
      else if (/^-?[\d.e+-]+$/.test(v)) out[key] = Number(v);
      else out[key] = v;
    }
  }
  return out;
}

const result = {};
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.prefab')) continue;
  const text = readFileSync(join(dir, file), 'utf8');
  const docs = text.split(/^--- !u!/m);
  const goNames = new Map(); // fileID -> GameObject name
  for (const doc of docs) {
    const head = /^1 &(-?\d+)/.exec(doc);
    if (!head) continue;
    const nm = /m_Name:\s*(.+)$/m.exec(doc);
    if (nm) goNames.set(head[1], nm[1].trim());
  }
  const parts = [];
  for (const doc of docs) {
    if (!/^114 &/.test(doc)) continue; // MonoBehaviour components
    const rec = parseDoc(doc);
    const keys = Object.keys(rec).filter((k) => k !== 'owner' && k !== 'name');
    if (keys.length === 0) continue;
    if (!('m_Mass' in rec) && !('Force' in rec) && !('P_Modul_18_Force' in rec) && !('SwitchTime' in rec)) continue;
    rec.part = goNames.get(rec.owner) ?? '?';
    delete rec.owner;
    delete rec.name;
    parts.push(rec);
  }
  if (parts.length) result[file.replace('.prefab', '')] = parts;
}
console.log(JSON.stringify(result, null, 1));
