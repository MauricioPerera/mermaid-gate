#!/usr/bin/env node
// Gate determinista para diagramas Mermaid: valida sintaxis + estructura contra un contrato YAML.
// Los checks semanticos (contract.semantic_checks) NO los juzga este script: los juzga un LLM
// externo (CLI, MCP, agente). Este script solo arma la tarea y despues valida el veredicto.
//
// Uso:
//   node src/gate.js <diagrama.mmd> <contrato.yaml> [veredictos.json]
//   node src/gate.js judge <diagrama.mmd> <contrato.yaml> [salida.json]

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const puppeteer = require('puppeteer');

const MERMAID_BUNDLE = path.join(__dirname, '..', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');

// Cada tipo soportado sabe extraer { nodes, edges } del db de mermaid.
// Para agregar un tipo nuevo: sumar una entrada acá con su propia lógica de extracción,
// basada en los métodos que expone diagram.db para ese tipo (ver docs/mermaid-db-api.md).
const EXTRACTORS_SOURCE = `
  const EXTRACTORS = {
    'flowchart-v2': (db) => {
      const vertices = db.getVertices();
      const nodes = Array.from(vertices.entries()).map(([id, v]) => ({ id, label: v.text }));
      const edges = db.getEdges().map((e) => ({ from: e.start, to: e.end, label: e.text || null }));
      return { nodes, edges };
    },
    'class': (db) => {
      const classes = db.getClasses();
      const nodes = Array.from(classes.entries()).map(([id, c]) => ({ id, label: c.label }));
      const edges = db.getRelations().map((r) => ({ from: r.id1, to: r.id2, label: r.title || null }));
      return { nodes, edges };
    },
    'stateDiagram': (db) => {
      const states = db.getStates();
      const nodes = Array.from(states.entries()).map(([id, s]) => ({
        id,
        label: s.descriptions && s.descriptions.length ? s.descriptions.join(' ') : id,
      }));
      const edges = db.getRelations().map((r) => ({ from: r.id1, to: r.id2, label: r.relationTitle || null }));
      return { nodes, edges };
    },
    'er': (db) => {
      const entities = db.getEntities();
      const nodes = Array.from(entities.entries()).map(([name, e]) => ({ id: name, label: e.label || name }));
      // getRelationships() referencia entidades por su id interno (entity-X-N), no por el
      // nombre que usa getEntities() como key: hay que resolver ese id -> nombre.
      const idToName = new Map(Array.from(entities.entries()).map(([name, e]) => [e.id, name]));
      const edges = db.getRelationships().map((r) => ({
        from: idToName.get(r.entityA) || r.entityA,
        to: idToName.get(r.entityB) || r.entityB,
        label: r.roleA || null,
      }));
      return { nodes, edges };
    },
    'mindmap': (db) => {
      const root = db.getMindmap();
      const nodes = [];
      const edges = [];
      // getMindmap() devuelve un arbol (root con children anidados), no una lista plana:
      // hay que recorrerlo y aplanarlo al mismo shape {nodes, edges} que usan los demas tipos.
      // OJO: nodeId sale del texto del nodo (descr) sanitizado, asi que dos nodos con el mismo
      // texto en ramas distintas colisionan en el mismo id.
      function walk(node, parent) {
        nodes.push({ id: node.nodeId, label: node.descr });
        if (parent) edges.push({ from: parent.nodeId, to: node.nodeId, label: null });
        (node.children || []).forEach((c) => walk(c, node));
      }
      walk(root, null);
      return { nodes, edges };
    },
    'gitGraph': (db) => {
      const commits = db.getCommits();
      const nodes = Array.from(commits.entries()).map(([id, c]) => ({ id, label: c.message || id }));
      // cada commit sabe sus padres (1 en un commit normal, 2 en un merge): el edge va
      // padre -> commit, no al reves.
      const edges = [];
      for (const [id, c] of commits.entries()) {
        for (const parentId of c.parents || []) {
          edges.push({ from: parentId, to: id, label: null });
        }
      }
      return { nodes, edges };
    },
    'sequence': (db) => {
      const actors = db.getActors();
      const nodes = Array.from(actors.entries()).map(([id, a]) => ({ id, label: a.description }));
      // getMessages() tambien devuelve notas y señales de activate/deactivate (sin 'to' real
      // o sin 'activate'), no solo mensajes. Se filtran para quedarnos con mensajes reales.
      const edges = db.getMessages()
        .filter((m) => typeof m.to === 'string' && Object.prototype.hasOwnProperty.call(m, 'activate'))
        .map((m) => ({ from: m.from, to: m.to, label: m.message || null }));
      return { nodes, edges };
    },
    // Estos tres no son grafos (sin nodos/edges): devuelven un shape propio, distinto del
    // {nodes, edges} de arriba. validate() los distingue por kind.
    'gantt': (db) => {
      const tasks = db.getTasks().map((t) => ({
        id: t.id,
        label: (t.task || '').trim(),
        section: t.section,
        // startTime/endTime son Date reales; se serializan a YYYY-MM-DD para que el contrato
        // los pueda declarar como string simple.
        start: t.startTime instanceof Date ? t.startTime.toISOString().slice(0, 10) : null,
        end: t.endTime instanceof Date ? t.endTime.toISOString().slice(0, 10) : null,
      }));
      return { kind: 'gantt', tasks, sections: db.getSections() };
    },
    'pie': (db) => {
      // getSections() devuelve un Map (label -> valor), no un objeto plano.
      const sections = db.getSections();
      const slices = Array.from(sections.entries()).map(([label, value]) => ({ label, value }));
      return { kind: 'pie', slices };
    },
    'journey': (db) => {
      const tasks = db.getTasks().map((t) => ({
        section: t.section,
        task: t.task,
        score: t.score,
        people: t.people || [],
      }));
      return { kind: 'journey', tasks, sections: db.getSections(), actors: db.getActors() };
    },
  };
`;

async function extractDiagram(diagramText) {
  const browser = await puppeteer.launch();
  try {
    const page = await browser.newPage();
    await page.goto('about:blank');
    await page.addScriptTag({ path: MERMAID_BUNDLE });
    await page.evaluate(EXTRACTORS_SOURCE);

    return await page.evaluate(async (text) => {
      window.mermaid.initialize({ startOnLoad: false });
      let diagram;
      try {
        diagram = await window.mermaid.mermaidAPI.getDiagramFromText(text);
      } catch (err) {
        return { syntaxError: err.message || String(err) };
      }
      const extractor = EXTRACTORS[diagram.type];
      if (!extractor) {
        return { unsupportedType: diagram.type };
      }
      return { diagramType: diagram.type, ...extractor(diagram.db) };
    }, diagramText);
  } finally {
    await browser.close();
  }
}

const TYPE_ALIASES = {
  flowchart: 'flowchart-v2',
  sequenceDiagram: 'sequence',
  classDiagram: 'class',
  stateDiagram: 'stateDiagram',
  'stateDiagram-v2': 'stateDiagram',
  erDiagram: 'er',
};

function validateGraph(extracted, contract) {
  const violations = [];

  if (typeof contract.min_nodes === 'number' && extracted.nodes.length < contract.min_nodes) {
    violations.push(`min_nodes ${contract.min_nodes}, encontrado ${extracted.nodes.length}`);
  }
  if (typeof contract.max_nodes === 'number' && extracted.nodes.length > contract.max_nodes) {
    violations.push(`max_nodes ${contract.max_nodes}, encontrado ${extracted.nodes.length}`);
  }

  const nodesById = new Map(extracted.nodes.map((n) => [n.id, n]));
  for (const req of contract.required_nodes || []) {
    const found = nodesById.get(req.id);
    if (!found) {
      violations.push(`falta nodo requerido '${req.id}'`);
      continue;
    }
    if (req.label && found.label !== req.label) {
      violations.push(`nodo '${req.id}' esperaba label '${req.label}', encontrado '${found.label}'`);
    }
  }

  for (const req of contract.required_edges || []) {
    const match = extracted.edges.find((e) => {
      if (e.from !== req.from || e.to !== req.to) return false;
      if (req.label && e.label !== req.label) return false;
      return true;
    });
    if (!match) {
      const labelPart = req.label ? ` con label '${req.label}'` : '';
      violations.push(`falta edge requerido '${req.from}' -> '${req.to}'${labelPart}`);
    }
  }

  return violations;
}

function validateGantt(extracted, contract) {
  const violations = [];
  const { tasks, sections } = extracted;

  if (typeof contract.min_tasks === 'number' && tasks.length < contract.min_tasks) {
    violations.push(`min_tasks ${contract.min_tasks}, encontrado ${tasks.length}`);
  }
  if (typeof contract.max_tasks === 'number' && tasks.length > contract.max_tasks) {
    violations.push(`max_tasks ${contract.max_tasks}, encontrado ${tasks.length}`);
  }

  for (const s of contract.required_sections || []) {
    if (!sections.includes(s)) violations.push(`falta section requerida '${s}'`);
  }

  const tasksById = new Map(tasks.map((t) => [t.id, t]));
  for (const req of contract.required_tasks || []) {
    const found = tasksById.get(req.id);
    if (!found) {
      violations.push(`falta task requerida '${req.id}'`);
      continue;
    }
    if (req.section && found.section !== req.section) {
      violations.push(`task '${req.id}' esperaba section '${req.section}', encontrado '${found.section}'`);
    }
    if (req.start && found.start !== req.start) {
      violations.push(`task '${req.id}' esperaba start '${req.start}', encontrado '${found.start}'`);
    }
    if (req.end && found.end !== req.end) {
      violations.push(`task '${req.id}' esperaba end '${req.end}', encontrado '${found.end}'`);
    }
  }

  return violations;
}

function validatePie(extracted, contract) {
  const violations = [];
  const { slices } = extracted;

  if (typeof contract.min_slices === 'number' && slices.length < contract.min_slices) {
    violations.push(`min_slices ${contract.min_slices}, encontrado ${slices.length}`);
  }
  if (typeof contract.max_slices === 'number' && slices.length > contract.max_slices) {
    violations.push(`max_slices ${contract.max_slices}, encontrado ${slices.length}`);
  }

  const sliceByLabel = new Map(slices.map((s) => [s.label, s]));
  for (const req of contract.required_slices || []) {
    const found = sliceByLabel.get(req.label);
    if (!found) {
      violations.push(`falta slice requerida '${req.label}'`);
      continue;
    }
    if (typeof req.value === 'number' && found.value !== req.value) {
      violations.push(`slice '${req.label}' esperaba value ${req.value}, encontrado ${found.value}`);
    }
  }

  return violations;
}

function validateJourney(extracted, contract) {
  const violations = [];
  const { tasks, sections, actors } = extracted;

  if (typeof contract.min_tasks === 'number' && tasks.length < contract.min_tasks) {
    violations.push(`min_tasks ${contract.min_tasks}, encontrado ${tasks.length}`);
  }
  if (typeof contract.max_tasks === 'number' && tasks.length > contract.max_tasks) {
    violations.push(`max_tasks ${contract.max_tasks}, encontrado ${tasks.length}`);
  }

  for (const s of contract.required_sections || []) {
    if (!sections.includes(s)) violations.push(`falta section requerida '${s}'`);
  }
  for (const a of contract.required_actors || []) {
    if (!actors.includes(a)) violations.push(`falta actor requerido '${a}'`);
  }

  for (const req of contract.required_tasks || []) {
    const found = tasks.find((t) => t.task === req.task);
    if (!found) {
      violations.push(`falta task requerida '${req.task}'`);
      continue;
    }
    if (req.section && found.section !== req.section) {
      violations.push(`task '${req.task}' esperaba section '${req.section}', encontrado '${found.section}'`);
    }
    if (typeof req.score === 'number' && found.score !== req.score) {
      violations.push(`task '${req.task}' esperaba score ${req.score}, encontrado ${found.score}`);
    }
    // people: se exige que esten todas las personas listadas (subset), no un match exacto de la lista.
    for (const p of req.people || []) {
      if (!found.people.includes(p)) {
        violations.push(`task '${req.task}' esperaba incluir a '${p}', encontrado [${found.people.join(', ')}]`);
      }
    }
  }

  return violations;
}

function validate(extracted, contract) {
  if (extracted.syntaxError) {
    return [`sintaxis invalida: ${extracted.syntaxError}`];
  }
  if (extracted.unsupportedType) {
    return [`tipo de diagrama '${extracted.unsupportedType}' aun no soportado por el gate`];
  }

  const violations = [];

  const expectedType = TYPE_ALIASES[contract.diagram_type] || contract.diagram_type;
  if (expectedType && extracted.diagramType !== expectedType) {
    violations.push(`diagram_type esperado '${contract.diagram_type}', encontrado '${extracted.diagramType}'`);
    return violations;
  }

  if (extracted.kind === 'gantt') return [...violations, ...validateGantt(extracted, contract)];
  if (extracted.kind === 'pie') return [...violations, ...validatePie(extracted, contract)];
  if (extracted.kind === 'journey') return [...violations, ...validateJourney(extracted, contract)];
  return [...violations, ...validateGraph(extracted, contract)];
}

function buildJudgeTask(diagramText, contract) {
  return {
    diagram_type: contract.diagram_type,
    diagram: diagramText,
    semantic_checks: contract.semantic_checks,
    instructions:
      'Sos un juez de diagramas Mermaid. Para cada elemento de semantic_checks, evalua si el ' +
      'diagrama (campo "diagram") lo cumple. Responde UNICAMENTE con este JSON, sin texto extra: ' +
      '{"checks":[{"check":"<texto EXACTO del check>","pass":true|false,"reason":"<justificacion breve>"}]}. ' +
      'Debe haber una entrada por cada check de semantic_checks, en cualquier orden.',
  };
}

function validateSemanticVerdicts(contract, verdictsPath) {
  const checks = contract.semantic_checks || [];
  if (checks.length === 0) return [];

  if (!verdictsPath) {
    return [
      `el contrato tiene ${checks.length} semantic_checks pero no se paso un archivo de veredictos. ` +
        `Corre 'node src/gate.js judge <diagrama> <contrato> tarea.json', pasale tarea.json a un LLM, ` +
        `guarda su respuesta como veredictos.json y volve a correr verify con ese tercer argumento.`,
    ];
  }

  let verdicts;
  try {
    verdicts = JSON.parse(fs.readFileSync(verdictsPath, 'utf8'));
  } catch (err) {
    return [`no se pudo leer/parsear el archivo de veredictos '${verdictsPath}': ${err.message}`];
  }

  if (!Array.isArray(verdicts.checks)) {
    return [`el archivo de veredictos '${verdictsPath}' no tiene el shape esperado: { "checks": [...] }`];
  }

  const violations = [];
  const verdictByCheck = new Map(verdicts.checks.map((v) => [v.check, v]));
  for (const check of checks) {
    const v = verdictByCheck.get(check);
    if (!v) {
      violations.push(`falta veredicto para semantic_check: '${check}'`);
      continue;
    }
    if (v.pass !== true) {
      const reason = v.reason ? ` — ${v.reason}` : '';
      violations.push(`semantic_check no cumplido: '${check}'${reason}`);
    }
  }
  return violations;
}

async function runJudge(diagramPath, contractPath, outPath) {
  if (!diagramPath || !contractPath) {
    console.error('Uso: node src/gate.js judge <diagrama.mmd> <contrato.yaml> [salida.json]');
    process.exit(2);
  }
  const diagramText = fs.readFileSync(diagramPath, 'utf8');
  const contract = yaml.load(fs.readFileSync(contractPath, 'utf8'));

  if (!contract.semantic_checks || contract.semantic_checks.length === 0) {
    console.error('El contrato no tiene semantic_checks: no hay nada que juzgar semanticamente.');
    process.exit(2);
  }

  const task = buildJudgeTask(diagramText, contract);
  const json = JSON.stringify(task, null, 2);
  if (outPath) {
    fs.writeFileSync(outPath, json);
    console.error(`Tarea de juicio escrita en ${outPath}. Pasasela a un LLM y guarda su respuesta como JSON.`);
  } else {
    console.log(json);
  }
}

async function runVerify(diagramPath, contractPath, verdictsPath) {
  if (!diagramPath || !contractPath) {
    console.error('Uso: node src/gate.js <diagrama.mmd> <contrato.yaml> [veredictos.json]');
    process.exit(2);
  }

  const diagramText = fs.readFileSync(diagramPath, 'utf8');
  const contract = yaml.load(fs.readFileSync(contractPath, 'utf8'));

  const extracted = await extractDiagram(diagramText);
  const violations = [...validate(extracted, contract), ...validateSemanticVerdicts(contract, verdictsPath)];

  if (violations.length === 0) {
    console.log('PASS');
    process.exit(0);
  } else {
    console.log('FAIL');
    for (const v of violations) console.log(`  - ${v}`);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === 'judge') {
    await runJudge(args[1], args[2], args[3]);
  } else {
    await runVerify(args[0], args[1], args[2]);
  }
}

main();
