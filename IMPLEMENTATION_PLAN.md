# InboxEye — plan incremental orientado a terminar la demo (v6, 23/10)

## Punto de partida VERIFICADO POR REVISIÓN DE CÓDIGO
El backend ya contiene `AgentRunner`, Anthropic `LLMClient`, `PolicyEngine`, `RunStore`, `readEmail`, 3 fixtures, endpoints `POST/GET /runs` y tests escritos. `PROJECT_STATUS.md` registra 10 tests pasando y una llamada real en el incremento 1 (20/10), **no repetidos aún por esta revisión**. No hay frontend, clasificador real ni herramientas adicionales. No reiniciar todo.

## Incremento 0 — auditoría y plan de migración [breve, SIN CODIFICAR]
- Leer docs v6, `PROJECT_STATUS.md` y los fuentes actuales.
- Identificar mínimo diff reutilizable, dependencias y trade-offs; no introducir refactor de framework o multiempresa.
- Confirmar tipos definitivos para `AgentReport`, `ProcessingResult` y orden de incrementos.
- Output: lista de archivos por cambiar y plan de tests; **esperar aprobación** antes de editar código.

## Incremento 1 — resultados útiles y autonomía demostrable [P0]
- Reutilizar runner; cambiar fixtures a NovaShop con órdenes/documentos y objetivo claro.
- Añadir `getOrderStatus`, `readInternalDocument`, `tagEmail`, `flagForReview`; políticas por correo/documento/tipo.
- Modelo principal decide llamadas, devuelve `AgentReport` JSON parseado y validado al finalizar. El harness crea `ProcessingResult` con estado, eventos y security desconocido/actual.
- `POST /runs` y `GET /runs/:id` mantienen compatibilidad; agregar `GET /emails`.
- Tests con mock: pedido encontrado, inexistente, revisión humana, documento denegado, herramienta inválida; y una corrida real **solo cuando sea explícitamente habilitada**.
- **Aceptación:** backend resuelve al menos A, C y E con informes útiles y trazas; jamás inventa envíos. Sin frontend todavía aceptable durante el incremento.

## Incremento 2 — Input Guard real [P0]
- Reemplazar `StubInspector` de servidor con Static Analyzer pequeño + segunda llamada LLM. Mantener stub/test mocks solo en entorno de pruebas, claramente nombrado.
- Salida estructurada validada: risk, reason, signals; LOW/REVIEW/QUARANTINE; falla cerrada.
- No abrir GMail ni HTML sofisticado; texto plano suficiente para la demo principal.
- Tests: seguro admitido, alto bloqueado sin entrega del cuerpo, medio a revisión, excepción/JSON inválido no filtra datos, segundo modelo no ejecuta tools.
- **Aceptación:** un correo malicioso seleccionado se retiene antes de llegar al agente principal; caso normal sigue funcionando.

## Incremento 3 — consola MVP [P0 y primer producto completamente demostrable]
- `apps/web` React + Vite: inbox, selección individual, `Process Selected`, lista de estados, detalle de email, `AgentReport` / `SecurityReport` / `ExecutionTrace` renderizados desde JSON real.
- Polling sencillo `GET /runs/:id`, sin websockets; mapeo explícito de PENDING/PROCESSING/PROCESSED/NEEDS_REVIEW/QUARANTINED/FAILED.
- Si tiempo, admitir selección múltiple; por ahora la selección individual completa prevalece.
- **Aceptación:** A/C/D funcionan desde UI end-to-end y muestran estados correctos, sin logs falsos. Grabar evidencia de funcionamiento.

## Incremento 4 — comparación y cola [P1 con máximo impacto]
- `UNPROTECTED_DEMO` como modo aislado, deshabilita Input Guard y reglas empresariales de recursos, pero sigue con tools solo sintéticas, validación, límites y auditoría.
- `Compare Security` ejecuta mismo email por separado sobre datos clonados; UI compara estados, tool calls observados, denegaciones y outcomes.
- `Process Pending` cola secuencial (en memoria), no requiere Redis ni background workers.
- **Aceptación:** comparación creíble con dos runs reales y sin filtración de recursos reales. Si no se completa, el MVP del incremento 3 sigue siendo presentable.

## Incremento 5 — estabilizar para la presentación [NO NEGOCIABLE]
- Ejercitar 3 escenarios y tests deterministas; verificar instalación, build, start y errores de API.
- Guardar 1–2 replays reales etiquetados para contingencia, si añade robustez.
- Preparar demo corta, explicar límites y anomalías, actualizar README y `PROJECT_STATUS.md` con lo realmente probado.
- **Cero funcionalidad nueva el 29/10** salvo bug crítico; conservar tiempo para examen y exposición.

## Prioridad de recorte
1. Recortar animaciones, HTML avanzado, configuración, métricas, real-time, infraestructura.
2. Luego pulido de comparación y batch; conservar visualización de trazas reales para un email.
3. Nunca sacrificar para la demo final: **agente real + Input Guard real + Action Guard determinista + informe JSON + UI mínima**.
4. No agregar `createDraft`, Action Evaluator, envío simulado/aprobación de envíos ni plugins de tools antes de completar 1–5.

## Criterios de trabajo para cada incremento
- Presentar 3–5 pasos, archivos afectados, tests y gasto esperado.
- Cambios pequeños y revisables; respetar la organización existente, no reconstruir todo.
- Correr pruebas normales mock, reportar resultados exactos (no asumir que pasaron).
- No llamar API real en tests ordinarios; `RUN_REAL_LLM=1` con aprobación para prueba explícita.
- Documentar lo que falla, decisiones, fecha y siguiente bloque en `PROJECT_STATUS.md`.
- Nunca leer `.env`/keys para inspección: solo comprobar presencia sin imprimir su valor.
