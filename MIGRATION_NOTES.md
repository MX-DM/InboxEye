# InboxEye — diagnóstico del ZIP del 23/10 y migración a v6

## Alcance de esta inspección
Se inspeccionaron los fuentes y Markdown del ZIP adjunto `InboxEye(1).zip` **sin ejecutar código de la aplicación ni invocar Anthropic**. No se leyó el `.env` incluido ni se analizaron credenciales o el contenido de `.git`. Las referencias a tests OK y corrida real proceden del `PROJECT_STATUS.md` de la versión antigua; deberán confirmarse localmente.

## Qué ya existe y debemos preservar
| Ubicación en repo | Estado observado | Acción v6 |
|---|---|---|
| `apps/api/src/core/AgentRunner.ts` | Ciclo `tool_use/tool_result`, validación Zod, autorización, inspección antes de retorno de contenido, límite de pasos/tokens, eventos | **Reutilizar**; añadir contrato JSON, `mode`, mapping de estados y eventos útiles |
| `apps/api/src/core/llm.ts` | Cliente Anthropic inyectable, `disable_parallel_tool_use`, usage tokens | Preservar; usar cliente LLM aparte para clasificador |
| `apps/api/src/core/PolicyEngine.ts` | Deniega tools desconocidas y verifica `scopeToRunEmail` | Ampliar reglas por ID de documentos, categorías y nuevas tools |
| `apps/api/src/core/inspector.ts` | `StubInspector` devuelve siempre `safe` | Sustituir en runtime por Static Analyzer + clasificador LLM; stub solo en tests |
| `apps/api/src/core/RunStore.ts` | Estado/eventos en memoria; resumen en string | Mantener; extender con `ProcessingResult`, modo y reportes |
| `apps/api/src/company/config.ts` | Objetivo genérico; **solo `readEmail`** | NovaShop y herramientas fijas de demo, sin framework multiempresa |
| `apps/api/src/company/emails.ts` | Tres correos sintéticos | Reemplazar/ampliar por escenarios de demo (no datos reales) |
| `apps/api/src/http/routes.ts` | `POST /runs`, `GET /runs`, `GET /runs/:id` | Mantener; agregar `GET /emails` y opciones de modo/cola después |
| `apps/api/test/agent.test.ts` | Diez tests escritos con mocks y API local, incl. cuarentena, deny, límites | Reutilizar y extender sin volverlos tests de pago |
| `apps/web` | No existe | Crear **más adelante**, tras flujo backend protegido |

## Desajustes de docs antiguas con el alcance confirmado
1. `CLAUDE.md` dice que ActionEvaluator y aprobación para envíos son parte del diseño; **ahora fuera de MVP**. También dice que «harness es parte del agente»; v6 diferencia responsabilidades lógicas.
2. `INBOXEYE_CONTEXT.md` antiguo pide drafts, envío simulado, aprobación; ahora reporte interno, tools de consulta/clasificación/derivación.
3. `ARCHITECTURE.md` antiguo propone `lookupRecord`, `createDraft`, `sendEmail`; ahora cinco tools concretas de NovaShop y contrato JSON final.
4. `IMPLEMENTATION_PLAN.md` planea mucho trabajo en aprobar envíos, Action Evaluator y HTML; v6 prioriza **completitud + demo + comparación**.
5. `PROJECT_STATUS.md` tiene checklist inicial antiguo parcialmente contradictorio con un anexo de Incremento 1 ya realizado. **No sobrescribir**: reconciliar las casillas y conservar historial.
6. `PROMPTS.md` anterior prepara un proyecto desde cero; usar nuevo primer prompt de adaptación.
7. `.gitignore` ignora `PROMPTS.md` y `README_START_HERE.md`, así que no aparecerán en Git salvo cambio consciente del ignore. Las nuevas instrucciones pueden estar localmente aunque no se versionen.

## Riesgos concretos encontrados y cómo manejarlos
- **`StubInspector` admite cualquier texto**; no presentar el prototipo actual como sistema protegido.
- **Solo `readEmail` existe hoy**: el comportamiento empresarial interesante todavía no está construido.
- **`summary` es texto libre**: no sirve como contrato uniforme de salida; migrar a `agentReport` validado y `ProcessingResult` generado por backend.
- **`BLOCKED_ACTION` como status**: evaluar convergencia con `NEEDS_REVIEW` + evento de política, sin romper tests/historia.
- El runner actualmente envía aviso de cuarentena a Claude y sigue una llamada más. Garantizar que el **contenido no se filtra** y que el estado y el reporte reflejan cuarentena; decidir si conviene terminar más pronto para ahorrar tokens.
- En `AgentRunner`, la marca `external` gatilla el inspector para toda tool externa. Para MVP el caso central es **solo `readEmail`**, pero seguir tratando resultados de otras fuentes no confiables como datos.
- El ZIP original **incluía `.env` y `.git`**. No se copiaron al handoff actualizado. Nunca distribuir un ZIP con `.env`, ni leerlo para verificar configuración.
- `apps/api/node_modules` del ZIP solo tenía caches, no dependencias completas. No se puede inferir que el proyecto compila hoy únicamente por existencia de `dist/`.

## Plan de migración de mínima intrusión
1. Crear commit o respaldo **por decisión del desarrollador** antes de cambios amplios (Claude no hace commits sin autorización).
2. Usar los nuevos `.md` como fuente de verdad. Mantener `PROJECT_STATUS.md` viejo y agregar una sección v6.
3. Pedir a Claude Plan Mode que compare esta matriz con su código y dé un **diff propuesto** de bajo riesgo, sin programar inmediatamente.
4. Primer cambio en código: agregar las cuatro tools y los outcomes, manteniendo loop, rutas y tests actuales.
5. Segundo cambio: Input Guard real y tests fail-closed.
6. Tercero: frontend y comparación, solo después de tener demo básica completa.

No convertir la migración en refactor total. El objetivo es **máximo valor demostrable por hora de trabajo**.
