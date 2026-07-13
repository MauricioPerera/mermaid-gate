#!/usr/bin/env node
// Corre el gate contra todos los fixtures de examples/ y verifica el resultado esperado:
// *-ok.mmd debe dar PASS, *-fail.mmd debe dar FAIL, mas los 4 casos de la capa semantica.
// Uso: node scripts/regression-test.js

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const EXAMPLES = path.join(ROOT, 'examples');
const GATE = path.join(ROOT, 'src', 'gate.js');

function runGate(args) {
  try {
    const stdout = execFileSync('node', [GATE, ...args], { cwd: ROOT, encoding: 'utf8' });
    return { exitCode: 0, stdout };
  } catch (err) {
    return { exitCode: err.status, stdout: (err.stdout || '') + (err.stderr || '') };
  }
}

let failures = 0;
let checked = 0;

function expect(label, args, expectedFirstLine) {
  checked++;
  const { stdout } = runGate(args);
  const firstLine = stdout.split('\n')[0];
  if (firstLine !== expectedFirstLine) {
    failures++;
    console.error(`FALLO: ${label}`);
    console.error(`  esperado: ${expectedFirstLine}`);
    console.error(`  obtenido: ${firstLine}`);
    console.error(stdout);
  } else {
    console.log(`OK: ${label} -> ${expectedFirstLine}`);
  }
}

// --- *-ok.mmd -> PASS ---
const okFiles = fs.readdirSync(EXAMPLES)
  .filter((f) => f.endsWith('-ok.mmd') || f === 'ok.mmd')
  .sort();

for (const f of okFiles) {
  const mmd = path.join('examples', f);
  const contract = f === 'ok.mmd'
    ? path.join('examples', 'ok.contract.yaml')
    : path.join('examples', f.replace(/\.mmd$/, '.contract.yaml'));
  expect(f, [mmd, contract], 'PASS');
}

// --- *-fail.mmd -> FAIL (contra el contrato -ok correspondiente) ---
const failFiles = fs.readdirSync(EXAMPLES)
  .filter((f) => f.endsWith('-fail.mmd') || f === 'fail.mmd')
  .sort();

for (const f of failFiles) {
  const mmd = path.join('examples', f);
  const contract = f === 'fail.mmd'
    ? path.join('examples', 'fail.contract.yaml')
    : path.join('examples', f.replace(/-fail\.mmd$/, '-ok.contract.yaml'));
  expect(f, [mmd, contract], 'FAIL');
}

// --- capa semantica ---
expect(
  'semantic: sin veredictos',
  [path.join('examples', 'ok.mmd'), path.join('examples', 'semantic-ok.contract.yaml')],
  'FAIL'
);
expect(
  'semantic: veredictos refutan',
  [
    path.join('examples', 'ok.mmd'),
    path.join('examples', 'semantic-ok.contract.yaml'),
    path.join('examples', 'semantic-verdicts-fail.json'),
  ],
  'FAIL'
);
expect(
  'semantic: veredictos confirman',
  [
    path.join('examples', 'semantic-pass.mmd'),
    path.join('examples', 'semantic-ok.contract.yaml'),
    path.join('examples', 'semantic-verdicts-pass.json'),
  ],
  'PASS'
);

console.log(`\nResumen: ${checked - failures}/${checked} casos correctos.`);
if (failures > 0) {
  console.error(`${failures} caso(s) con resultado inesperado.`);
  process.exit(1);
}
