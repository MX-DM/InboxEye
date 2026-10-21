# InboxEye — estado real del proyecto

> **Actualizado inicialmente:** 20/10/2026. Este archivo NO implica que algo esté programado. Solo marcar «Hecho» cuando existan archivos verificables y pruebas ejecutadas.

## Estado general
- [x] Producto, objetivo y arquitectura *agent-driven* definidos conceptualmente.
- [x] Paquete de handoff y plan de desarrollo preparados.
- [ ] Stack inicializado y dependencias verificadas.
- [ ] Test de conectividad con API de Claude (runtime de la app).
- [ ] AgentRunner / harness real con `tool_use` / `tool_result`.
- [ ] Repositorio de emails sintéticos y `readEmail`.
- [ ] Security Analyzer y cuarentena.
- [ ] Policy Engine / permisos.
- [ ] Tools secundarias sintéticas y aprobación humana.
- [ ] Frontend Inbox / estados / trazas.
- [ ] Tests automatizados y demo vertical completa.
- [ ] Action Evaluator selectivo (P1).
- [ ] HTML oculto y escenarios A/B (P1).

## Decisiones aprobadas
1. InboxEye protege un agente generalista de correo corporativo (no agente de compras).
2. El procesamiento es **agent-driven**. Se pasa `emailId` al modelo principal; `readEmail` es elección de Claude; la respuesta es interceptada por seguridad antes del tool_result.
3. `SecurityAnalyzer` = LLM que clasifica contenido no confiable. `ActionEvaluator` = LLM opcional/selectivo sobre acciones. `PolicyEngine` = autorización determinista externa al modelo.
4. Revisión humana obligatoria para operaciones sensibles autorizables. Datos y operaciones 100% sintéticos.
5. MVP de 5–6 días, monolito modular, pruebas con mocks y uso acotado de crédito.

## Próximo incremento
**Planificación inicial con Claude Code (sin modificar código):** leer documentos y proponer un plan breve para la primera implementación. Revisar las decisiones antes de autorizar cambios.

## Último incremento implementado
- **Fecha:** 20/10/2026 — Incremento 1 (slice sin UI).
- **Qué se hizo:** `POST /runs {emailId}` → harness con loop `tool_use/tool_result` → validación Zod → `PolicyEngine` (deny por defecto, `readEmail` solo del `emailId` de la corrida) → handler → inspector → `tool_result`. Separación `core/` (harness, política, inspector, store, `LLMClient`) y `company/` (objetivo, tool `readEmail`, 3 correos sintéticos). `disable_parallel_tool_use`, límites de pasos/tokens, fail-closed del inspector, estado final calculado por el harness.
- **Archivos afectados:** `package.json`, `.env.example`, `apps/api/{package.json,tsconfig.json,vitest.config.ts}`, `apps/api/src/core/*`, `apps/api/src/company/*`, `apps/api/src/http/routes.ts`, `apps/api/src/server.ts`, `apps/api/scripts/it-real.ts`, `apps/api/test/agent.test.ts`.
- **Comandos/tests ejecutados:** `npm run build -w @inboxeye/api` (OK); `npm test -w @inboxeye/api` → 10/10 con `MockLLM`; `npm run it:real` sin `RUN_REAL_LLM=1` aborta como se espera.
- **Resultados:** tests con mocks pasan (10/10). Corrida real (`RUN_REAL_LLM=1 npm run it:real -w @inboxeye/api`, modelo `claude-haiku-5-5`, email-001): `PROCESSED`; Claude llamó `readEmail` por sí mismo, `PolicyEngine` ALLOW, inspector stub (`safe`), resumen generado. Tokens: 1.405 entrada / 232 salida en 2 llamadas (≈ USD 0.0002 estimado).
- **Límites / errores conocidos:** el inspector es `StubInspector` (NO analiza nada; marca todo `safe`) hasta el Incremento 2. Solo existe la tool `readEmail`. Sin UI. Estado en memoria. Modelo por `ANTHROPIC_MODEL` sin verificar contra la API.
- **Coste API si se conoce:** ≈ USD 0.0002 (una corrida real).
- **Siguiente paso:** una corrida real (`RUN_REAL_LLM=1 npm run it:real -w @inboxeye/api`), luego SecurityAnalyzer real + cuarentena.

## Bloqueos y dudas abiertas
- Verificar el alcance de la API Key y disponibilidad de modelos para runtime.
- Confirmar prioridades con mentor, si corresponde.
- Definir comportamiento final ante operación que requiere aprobación pendiente sin implementar un workflow empresarial complejo.

## Historial de progreso
<!-- Agregar aquí al final de cada incremento, con fecha, verificación y próximo paso. No borrar decisiones antiguas sin motivo. -->
