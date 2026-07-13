# mermaid-gate

Verificador determinista de diagramas Mermaid contra un contrato declarativo (YAML), con una capa
opcional de juicio semántico delegada a un LLM externo. Mismo principio que CCDD / design.md:
lo que se puede chequear con hechos lo decide una máquina; lo que es juicio de opinión lo decide
un LLM o un humano, y la máquina solo valida que ese veredicto exista y tenga el shape correcto.

## Qué verifica

1. **Sintaxis** — corre el parser real de Mermaid (vía Chromium headless) sobre el `.mmd`. Si no
   parsea, falla con el error real del parser.
2. **Estructura** — extrae el AST del diagrama (nodos, relaciones) y lo compara contra un contrato:
   tipo de diagrama, cantidad de nodos, nodos y relaciones obligatorias.
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

Todos los campos son opcionales salvo `diagram_type`. Un contrato vacío de reglas estructurales
solo valida sintaxis + tipo de diagrama.

## Tipos de diagrama soportados

| `diagram_type` en el contrato | Tipo interno de Mermaid |
|---|---|
| `flowchart` | `flowchart-v2` |
| `sequenceDiagram` | `sequence` |
| `classDiagram` | `class` |
| `stateDiagram` / `stateDiagram-v2` | `stateDiagram` |
| `erDiagram` | `er` |

Cualquier otro tipo (`gantt`, `pie`, `mindmap`, `gitGraph`, etc.) todavía no tiene extractor: el
gate falla con `tipo de diagrama '<tipo>' aun no soportado por el gate`.

### Notas por tipo (comportamiento real verificado, no documentación oficial de Mermaid)

- **stateDiagram**: los pseudo-estados `[*]` se materializan como nodos reales `root_start` /
  `root_end` en el AST — cuentan para `min_nodes`/`max_nodes`.
- **sequenceDiagram**: `getMessages()` del parser también devuelve notas y señales de
  activate/deactivate, no solo mensajes reales; el extractor las filtra.
- **erDiagram**: las relaciones referencian entidades por su id interno (`entity-X-N`), no por el
  nombre visible; el extractor resuelve ese lookup.

### Agregar un tipo nuevo

En `src/gate.js`, sumar una entrada al objeto `EXTRACTORS` que reciba el `db` de mermaid para ese
tipo y devuelva `{ nodes: [{id, label}], edges: [{from, to, label}] }`. Para saber qué expone el
`db` de un tipo nuevo, no hay que adivinar: escribir un script temporal que llame
`mermaid.mermaidAPI.getDiagramFromText(texto)` dentro de una página de Puppeteer y loguear
`diagram.type` + los métodos del prototipo de `diagram.db` (es como se descubrieron todos los
extractores actuales).

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
node src/gate.js examples/semantic-pass.mmd examples/semantic-ok.contract.yaml examples/semantic-verdicts-pass.json  # PASS
```

## Estructura del proyecto

```
src/gate.js       # todo el gate: extracción de AST, validación estructural, subcomando judge
examples/         # fixtures .mmd + .contract.yaml + veredictos de ejemplo
```
