# mermaid-gate

Verificador determinista de diagramas Mermaid contra un contrato declarativo (YAML), con una capa
opcional de juicio semántico delegada a un LLM externo. Mismo principio que CCDD / design.md:
lo que se puede chequear con hechos lo decide una máquina; lo que es juicio de opinión lo decide
un LLM o un humano, y la máquina solo valida que ese veredicto exista y tenga el shape correcto.

## Qué verifica

1. **Sintaxis** — corre el parser real de Mermaid (vía Chromium headless) sobre el `.mmd`. Si no
   parsea, falla con el error real del parser.
2. **Estructura** — extrae el AST del diagrama y lo compara contra un contrato. Para diagramas de
   grafo (flowchart, sequenceDiagram, classDiagram, stateDiagram, erDiagram, mindmap, gitGraph) son
   nodos y relaciones obligatorias. Para gantt/pie/journey, que no son grafos, el contrato usa un
   esquema propio (ver "Tipos de diagrama soportados" abajo).
3. **Semántica (opcional)** — si el contrato declara `semantic_checks`, exige un veredicto externo
   (de un LLM) que confirme o refute cada afirmación. El gate no juzga esto por sí mismo.

## Instalación

```
npm install
```

## Uso

### Verificar un diagrama

```
node src/gate.js <diagrama.mmd> <contrato.yaml> [veredictos.json]
```

- Exit code `0` y `PASS` si cumple todo.
- Exit code `1` y `FAIL` + lista de violaciones si no.
- `veredictos.json` es opcional y solo se usa si el contrato tiene `semantic_checks` (ver abajo).

Ejemplo:

```
node src/gate.js examples/ok.mmd examples/ok.contract.yaml
# PASS
```

## El contrato (`.contract.yaml`)

`diagram_type` es el único campo obligatorio siempre. El resto de los campos depende de si el tipo
es un grafo o uno de los tres tipos "planos" (gantt/pie/journey). `semantic_checks` aplica a
cualquier tipo por igual. Un contrato sin reglas estructurales solo valida sintaxis + tipo.

### Diagramas de grafo (flowchart, sequenceDiagram, classDiagram, stateDiagram, erDiagram, mindmap, gitGraph, requirementDiagram, C4Context, sankey, block, kanban)

```yaml
diagram_type: flowchart      # tipo esperado (ver "Tipos soportados" abajo)

min_nodes: 3                 # opcional
max_nodes: 10                # opcional

required_nodes:              # opcional
  - id: A
    label: Inicio            # opcional: si se omite, solo se exige que el id exista
  - id: B

required_edges:               # opcional
  - from: A
    to: B
  - from: B
    to: C
    label: Si                # opcional: si se omite, no importa el label del edge

semantic_checks:              # opcional, ver "Capa semántica" abajo
  - "el diagrama maneja explicitamente un camino de error, no solo el camino feliz"
```

### gantt

```yaml
diagram_type: gantt

min_tasks: 4                  # opcional
max_tasks: 8                  # opcional

required_sections:            # opcional
  - Diseno
  - Dev

required_tasks:               # opcional, matchea por id de la task (":a1" en la sintaxis mermaid)
  - id: a1
    section: Diseno           # opcional
    start: "2026-01-01"       # opcional, formato YYYY-MM-DD
    end: "2026-01-06"         # opcional, formato YYYY-MM-DD
```

### pie

```yaml
diagram_type: pie

min_slices: 2                 # opcional
max_slices: 5                 # opcional

required_slices:              # opcional
  - label: A
    value: 40                 # opcional: si se omite, solo se exige que la slice exista
```

### journey

```yaml
diagram_type: journey

min_tasks: 2                  # opcional
max_tasks: 6                  # opcional

required_sections:            # opcional
  - Buscar
required_actors:              # opcional
  - Cliente

required_tasks:               # opcional, matchea por texto exacto de la task
  - task: "Buscar producto"
    section: Buscar           # opcional
    score: 5                  # opcional
    people:                   # opcional: subset — exige que esten estas personas, no un match exacto
      - Cliente
```

### quadrantChart

```yaml
diagram_type: quadrantChart

min_points: 2                 # opcional
max_points: 5                 # opcional

required_quadrants:           # opcional
  - Hacer ya
  - Planificar

required_points:              # opcional, matchea por nombre exacto del punto
  - name: "Feature A"
    quadrant: Planificar      # opcional: si se omite, solo se exige que el punto exista
```

### timeline

```yaml
diagram_type: timeline

min_periods: 2                # opcional
max_periods: 5                # opcional

required_periods:             # opcional, matchea por texto exacto del periodo
  - period: "2020"
    events:                   # opcional: subset — exige que esten estos eventos, no un match exacto
      - Fundacion
```

### xychart

```yaml
diagram_type: xychart

required_categories:          # opcional
  - ene
  - feb

required_plots:               # opcional, matchea por type ('bar' o 'line')
  - type: bar
    points:                   # opcional
      - category: ene
        value: 500            # opcional: si se omite, solo se exige que exista un punto para esa categoria
```

### packet

```yaml
diagram_type: packet

min_fields: 2                 # opcional
max_fields: 5                 # opcional

required_fields:              # opcional, matchea por label exacto del field
  - label: "Source Port"
    start: 0                  # opcional
    end: 15                   # opcional
```

### radar

```yaml
diagram_type: radar

required_axes:                # opcional
  - Ataque
  - Defensa

required_curves:              # opcional, matchea por label exacto de la curva
  - label: "Jugador 1"
    values:                   # opcional: mapa eje -> valor esperado, solo se chequean los ejes listados
      Ataque: 85
```

## Tipos de diagrama soportados

| `diagram_type` en el contrato | Tipo interno de Mermaid |
|---|---|
| `flowchart` | `flowchart-v2` |
| `sequenceDiagram` | `sequence` |
| `classDiagram` | `class` |
| `stateDiagram` / `stateDiagram-v2` | `stateDiagram` |
| `erDiagram` | `er` |
| `mindmap` | `mindmap` |
| `gitGraph` | `gitGraph` |
| `gantt` | `gantt` |
| `pie` | `pie` |
| `journey` | `journey` |
| `requirementDiagram` | `requirement` |
| `C4Context` | `c4` |
| `sankey` | `sankey` |
| `quadrantChart` | `quadrantChart` |
| `block` | `block` |
| `timeline` | `timeline` |
| `xychart` | `xychart` |
| `kanban` | `kanban` |
| `packet` | `packet` |
| `radar` | `radar` |

Cualquier otro tipo todavía no tiene extractor: el gate falla con
`tipo de diagrama '<tipo>' aun no soportado por el gate`.

### Notas por tipo (comportamiento real verificado, no documentación oficial de Mermaid)

- **stateDiagram**: los pseudo-estados `[*]` se materializan como nodos reales `root_start` /
  `root_end` en el AST — cuentan para `min_nodes`/`max_nodes`.
- **sequenceDiagram**: `getMessages()` del parser también devuelve notas y señales de
  activate/deactivate, no solo mensajes reales; el extractor las filtra.
- **erDiagram**: las relaciones referencian entidades por su id interno (`entity-X-N`), no por el
  nombre visible; el extractor resuelve ese lookup.
- **mindmap**: `getMindmap()` devuelve un árbol anidado (root con `children`), no una lista plana;
  el extractor lo recorre y aplana. El `id` de cada nodo sale del texto (`nodeId`), no hay ids
  explícitos como en flowchart — dos nodos con el mismo texto en ramas distintas colisionan en el
  mismo id.
- **gitGraph**: cada commit trae su lista de `parents` (1 en un commit normal, 2 en un merge); el
  extractor genera un edge `padre -> commit` por cada parent. Un `merge` sin id explícito
  (`merge <branch> id: "..."`) genera un id con hash aleatorio, distinto en cada parseo — para que
  el contrato sea reproducible hay que forzar el id del merge a mano.
- **gantt**: `startTime`/`endTime` en `getTasks()` son objetos `Date` reales (calculados incluso
  para tasks declaradas como `after <otra-task>`); el extractor los serializa a `YYYY-MM-DD`.
- **pie**: `getSections()` devuelve un `Map` (label → valor), no un objeto plano — hay que
  convertirlo con `Array.from(map.entries())` antes de poder iterarlo.
- **requirementDiagram**: los nodos salen de dos colecciones distintas (`getRequirements()` y
  `getElements()`), que hay que combinar; las relaciones (`getRelationships()`) usan `src`/`dst`
  en vez de `from`/`to`.
- **C4Context**: `label`, `descr` y `techn` en shapes/rels no son strings sino objetos `{text: "..."}`
  — hay que extraer `.text`, no asumir que el campo ya es el string.
- **sankey**: `getNodes()`/`getLinks()` son la excepción prolija — nodos con `{ID}` y links con
  `{source: {ID}, target: {ID}, value}`, sin gotchas.
- **quadrantChart (⚠ frágil)**: `getQuadrantData()` NO expone AST semántico — solo geometría de
  render ya calculada (coordenadas en píxeles, cajas de cuadrante). No hay forma de saber en qué
  cuadrante cae un punto por nombre directamente; el extractor lo infiere comparando el pixel del
  punto contra el bounding box de cada cuadrante. Si una versión futura de mermaid cambia el
  layout/canvas por defecto, esto puede romperse sin que el diagrama haya cambiado. Es el único
  extractor de todo el proyecto que depende de datos de render en vez de datos de parseo.
- **block**: excepción prolija — `getBlocks()`/`getEdges()` ya vienen en el shape que se necesita,
  sin lookups ni colecciones que combinar.
- **timeline**: el texto de cada evento conserva el espacio previo al `:` del parseo original
  (`"Primera ronda "`, con espacio final) — el extractor los trimea. Los periodos no tienen
  relaciones entre sí, por eso es `{kind: 'timeline', periods}` y no `{nodes, edges}`.
- **xychart**: cada serie (`bar`/`line`) se identifica por su `type`, no por un id — si un contrato
  necesitara dos series `bar` distinguibles, `required_plots` no alcanza (matchea la primera con
  ese type).
- **kanban**: `getData()` devuelve una lista plana de nodos (secciones + tareas) con `parentId`,
  no un árbol ni edges ya armados — el extractor reconstruye el edge `sección -> tarea` a partir
  de ese `parentId`.
- **packet**: `getPacket()` agrupa los campos en "filas" (arrays anidados) según cuántos bits
  entran por fila en el render; el extractor aplana todas las filas, porque para el contrato la
  fila no importa, solo el campo.
- **radar**: `getCurves()` devuelve los valores como array posicional (`entries: [85, 60, 90]`),
  que corresponde por índice al array de `getAxes()`, no por nombre — el extractor arma el mapa
  eje→valor cruzando ambos arrays por posición.

### Agregar un tipo nuevo

En `src/gate.js`, sumar una entrada al objeto `EXTRACTORS` que reciba el `db` de mermaid para ese
tipo. Si el tipo es un grafo, devolver `{ nodes: [{id, label}], edges: [{from, to, label}] }` y
sumar su validación al branch por defecto de `validate()`. Si no es un grafo (como gantt/pie/journey),
devolver un objeto con un campo `kind` propio (ej. `{ kind: 'gantt', tasks, sections }`) y escribir
una función `validateX()` nueva + un branch en `validate()` que la despache por `extracted.kind`.

Para saber qué expone el `db` de un tipo nuevo, no hay que adivinar: escribir un script temporal
que llame `mermaid.mermaidAPI.getDiagramFromText(texto)` dentro de una página de Puppeteer y loguear
`diagram.type` + los métodos propios de `diagram.db` (`Object.getOwnPropertyNames(db)` — en varios
tipos los métodos son propiedades propias del objeto, no del prototipo, así que hay que chequear
ambos). Es como se descubrieron todos los extractores actuales, incluyendo los shapes inesperados
(Maps que parecen `{}` al loguearlos directo, ids internos que no coinciden con los nombres visibles,
etc.) — logueá el resultado real y armá el extractor a partir de eso, nunca de la documentación.

## Capa semántica (LLM-judge)

Para requisitos que no son estructurales ("el diagrama representa bien tal flujo", "los nombres
son descriptivos", "hay manejo de error") no existe chequeo determinista posible. El gate no llama
a ningún LLM por su cuenta: arma la tarea, un LLM externo (CLI, agente, MCP — lo que tengas a mano)
la resuelve, y el gate valida que el veredicto tenga el shape correcto y esté todo en `pass: true`.

### 1. Declarar los checks en el contrato

```yaml
semantic_checks:
  - "el diagrama maneja explicitamente un camino de error o rechazo, no solo el camino feliz"
  - "los nombres de los nodos son descriptivos, no genericos como 'Paso 1'"
```

### 2. Generar la tarea de juicio

```
node src/gate.js judge <diagrama.mmd> <contrato.yaml> tarea.json
```

Esto escribe `tarea.json` con el diagrama, la lista de `semantic_checks` y las instrucciones de
formato de respuesta. Sin el tercer argumento, imprime el JSON a stdout en vez de escribir un archivo.

### 3. Pasarle `tarea.json` a un LLM

El LLM debe responder únicamente con:

```json
{
  "checks": [
    { "check": "<texto EXACTO del check>", "pass": true, "reason": "justificacion breve" }
  ]
}
```

Debe haber una entrada por cada check declarado en el contrato, con el texto del check idéntico
(se matchea por string exacto).

### 4. Verificar con el veredicto

```
node src/gate.js <diagrama.mmd> <contrato.yaml> veredictos.json
```

Si falta el veredicto de algún check, o alguno tiene `pass: false`, el gate falla y lista el motivo
(el `reason` que dio el LLM). Ver `examples/semantic-*` para un caso completo de punta a punta,
incluyendo un diagrama que falla genuinamente los checks y uno que los cumple.

## Ejemplos (`examples/`)

Cada tipo soportado tiene un par `*-ok.mmd` / `*-fail.mmd` con su contrato, más el flujo semántico
completo en `semantic-*`. Sirven como fixtures de regresión: correr el gate contra todos los `-ok`
debe dar `PASS`, contra todos los `-fail` debe dar `FAIL`.

```
node src/gate.js examples/ok.mmd examples/ok.contract.yaml               # flowchart, PASS
node src/gate.js examples/fail.mmd examples/fail.contract.yaml           # flowchart, FAIL
node src/gate.js examples/sequence-ok.mmd examples/sequence-ok.contract.yaml   # sequenceDiagram, PASS
node src/gate.js examples/class-ok.mmd examples/class-ok.contract.yaml         # classDiagram, PASS
node src/gate.js examples/state-ok.mmd examples/state-ok.contract.yaml         # stateDiagram, PASS
node src/gate.js examples/er-ok.mmd examples/er-ok.contract.yaml               # erDiagram, PASS
node src/gate.js examples/mindmap-ok.mmd examples/mindmap-ok.contract.yaml     # mindmap, PASS
node src/gate.js examples/gitgraph-ok.mmd examples/gitgraph-ok.contract.yaml   # gitGraph, PASS
node src/gate.js examples/gantt-ok.mmd examples/gantt-ok.contract.yaml         # gantt, PASS
node src/gate.js examples/pie-ok.mmd examples/pie-ok.contract.yaml             # pie, PASS
node src/gate.js examples/journey-ok.mmd examples/journey-ok.contract.yaml     # journey, PASS
node src/gate.js examples/requirement-ok.mmd examples/requirement-ok.contract.yaml  # requirementDiagram, PASS
node src/gate.js examples/c4-ok.mmd examples/c4-ok.contract.yaml               # C4Context, PASS
node src/gate.js examples/sankey-ok.mmd examples/sankey-ok.contract.yaml       # sankey, PASS
node src/gate.js examples/quadrant-ok.mmd examples/quadrant-ok.contract.yaml   # quadrantChart, PASS
node src/gate.js examples/block-ok.mmd examples/block-ok.contract.yaml         # block, PASS
node src/gate.js examples/timeline-ok.mmd examples/timeline-ok.contract.yaml   # timeline, PASS
node src/gate.js examples/xychart-ok.mmd examples/xychart-ok.contract.yaml     # xychart, PASS
node src/gate.js examples/kanban-ok.mmd examples/kanban-ok.contract.yaml       # kanban, PASS
node src/gate.js examples/packet-ok.mmd examples/packet-ok.contract.yaml       # packet, PASS
node src/gate.js examples/radar-ok.mmd examples/radar-ok.contract.yaml         # radar, PASS
node src/gate.js examples/semantic-pass.mmd examples/semantic-ok.contract.yaml examples/semantic-verdicts-pass.json  # PASS
```

## Estructura del proyecto

```
src/gate.js       # todo el gate: extracción de AST, validación estructural, subcomando judge
examples/         # fixtures .mmd + .contract.yaml + veredictos de ejemplo
```

## Integración con KDD

[MauricioPerera/KDD](https://github.com/MauricioPerera/KDD) — plantilla de metodología
Knowledge-Driven Development (OKF + CCDD) — tiene su propio gate de diagramas Mermaid en
[`scripts/validate_diagrams.py`](https://github.com/MauricioPerera/KDD/blob/main/scripts/validate_diagrams.py),
documentado en [`knowledge/diagram-contract-spec.md`](https://github.com/MauricioPerera/KDD/blob/main/knowledge/diagram-contract-spec.md).

No invoca este proyecto: los gates Nivel 1 de KDD prohíben `subprocess`/`network`/`llm`, así que
no pueden shellear a `node src/gate.js` (eso necesitaría Node.js + subprocess). En cambio,
KDD reimplementa parsers propios en Python puro para un subconjunto de 4 tipos
(`flowchart`, `gantt`, `pie`, `journey`), con un contrato JSON equivalente (mismo vocabulario,
JSON en vez de YAML) pero de fidelidad y cobertura menor que este proyecto.

Este repo (`mermaid-gate`) es la herramienta de referencia cuando se necesita el parser real de
mermaid o alguno de los 16 tipos que KDD no cubre — se usa como herramienta externa, invocada a
mano o desde CI de un proyecto que sí pueda correr Node.js, no como parte del gate Nivel 1 de KDD.
