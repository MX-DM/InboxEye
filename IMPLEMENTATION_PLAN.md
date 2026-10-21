# InboxEye — plan de implementación realista (5–6 días efectivos)

## Principio de ejecución
Primero un **vertical slice funcional**: «elegir correo → Claude solicita una tool → harness la ejecuta → devuelve resultado → dashboard registra». Luego integrar protecciones sin perder un sistema demostrable. **Cada día termina con algo ejecutable y verificado.** El 29/10 hay parcial; no usarlo como día crítico de programación.

> Las siguientes duraciones son bloques de trabajo, no fechas obligatorias ni promesas. Si aparecen bloqueos, recortar por prioridad y terminar el MVP antes del examen.

## Día 0 — Aprobación del diseño / preparación (breve)
- Revisar estos documentos; validar supuestos con el mentor cuando corresponda (API habilitada para app, alcance aceptable).
- Crear repo Git local privado si se desea, `.gitignore`, `.env.example` sin secretos; preparar variable de entorno local ANTHROPIC_API_KEY solo en backend.
- Confirmar en una prueba **mínima** que la API y el identificador del modelo configurado funcionan. No repetir llamadas exploratorias.
- Definir qué herramientas/escenarios mínimo vamos a demostrar y criterios de éxito.

## Día 1 — Estructura + vertical slice agent-driven
**Entregable:** procesar **1 email sintético** desde un endpoint y observar que **Claude decide llamar** a `readEmail(emailId)`.
- Proyecto Node/TS + Express mínimo; frontend puede ser todavía muy simple.
- Fixtures de correo en memoria; `POST /runs` con email ID válido.
- `AgentRunner` con `tool_use`/`tool_result`, `MAX_TOOL_STEPS`, mock `LLMProvider` para tests y *al menos una* prueba real con API.
- `readEmail` desde repositorio sintético, validación de parámetros y resultados. Registrar línea de tiempo.
- Definir `AGENT_OBJECTIVE` empresarial; el cuerpo **no** se pasa en contexto inicial.
**Aceptación:** una corrida real usa al menos una herramienta y termina; correo inválido y tool desconocida se deniegan sin ejecutar.

## Día 2 — Seguridad de contenido + primeros escenarios
**Entregable:** `readEmail` vuelve por un pipeline antes de que Claude vea el contenido.
- `SecurityAnalyzer` como clasificador con llamada separada al LLM y salida validada.
- Probar varios correos sintéticos; safe → tool_result no confiable; quarantine → contenido no entregado y estado de cuarentena.
- Registrar por qué se clasificó. Política segura si el analizador falla.
- Añadir parseo de `textBody` y base de `htmlBody` si entra en el tiempo; heurística HTML oculto puede posponerse a P1.
**Aceptación:** tests de flujo prueban que el correo malicioso no alcanza al agente cuando se pone en cuarentena; fallo del scanner no habilita el contenido.

## Día 3 — Control de acciones + permisos
**Entregable:** el agente puede proponer acciones posteriores pero no saltarse la autorización.
- Herramientas sintéticas `lookupRecord`, `createDraft`, `sendEmail` (no real).
- `PolicyEngine`: deny-by-default, allowlist de herramientas, recursos y destinos, permisos por corrida; validación de args.
- Documentar por qué el LLM no decide los permisos. Eventos `ALLOW`, `DENY`, `BLOCKED_ACTION`.
- Tests: rechazo de tool desconocida, registro restringido, destino no autorizado, caso permitido.
**Aceptación:** intento de acceder a recurso prohibido jamás alcanza a `ToolExecutor` aun si el LLM insiste.

## Día 4 — Human-in-the-loop + Acción semántica selectiva
**Entregable:** el dashboard/endpoint muestran una operación sensible en `PENDING_APPROVAL` antes de ejecutarla.
- Estado pendiente unido a `runId`, `toolCallId`, acción y args; aprobar/rechazar contra ese snapshot y revalidar al ejecutar.
- `sendEmail` solo simulado. Test de aprobación única, rechazo, cambio de args e intentos duplicados.
- **Si P0 está estable**: `ActionEvaluator` con llamada selectiva a Claude para comparar acción vs objetivo confiable. Alinear salida `aligned/misaligned/uncertain` a decisiones conservadoras. No autoriza por sí solo.
**Aceptación:** ninguna solicitud pendiente se ejecuta sin aprobación exacta; semántica opcional no elimina controles duros.

## Día 5 — UI, pruebas y demo
**Entregable:** un flujo completo por UI con estados y evidencias.
- Inbox React con lista de 8–12 correos, seleccionar uno o lote, procesar secuencialmente, detalles y resultados.
- Timeline por correo con tool calls, decisiones y hallazgos; interfaz de aprobar/rechazar.
- Casos para demo: normal, injection detectado, intento bloqueado, operación legítima pendiente y aprobada/rechazada.
- Tests de integración con mocks (sin pagar tokens), y 3–5 pruebas reales **controladas**. Registrar resultados *reales*.
- README con cómo arrancar, variables, comandos, amenazas, limitaciones y demo script de 3–5 minutos.
**Aceptación:** recorrido de demo se puede ejecutar completo sin intervención manual en consola; hay salida clara para cada mensaje.

## Día 6 (solo si existe margen) — Pulido y extras
- HTML oculto y comparación de fuente vs texto extraído.
- Action Evaluator si no entró antes.
- Comparación básica scanner on/off **solo con herramientas simuladas**, y métricas sobre fixtures etiquetados (si alcanzan y realmente se ejecutaron).
- Mejora UX, revisión de seguridad y presentación. **No** agregar producción o integraciones externas.

## Orden de recorte si falta tiempo o crédito
1. **Eliminar primero:** animaciones, componentes visuales ornamentales, despliegue, Docker, métricas sofisticadas, procesado paralelo, WebSocket.
2. Luego: HTML oculto complejo (mantener text/plain y parsing básico si ya existe), comparación A/B, gráficos avanzados.
3. Luego: Action Evaluator semántico (mantener **PolicyEngine** determinista y aprobación humana; explicar claramente el recorte).
4. **No recortar:** agente real que selecciona herramientas, interceptación obligatoria del `readEmail`, scanner LLM real, política de autorización, herramienta sensible simulada, al menos una revisión humana, trazas y tests básicos.

## Calidad / definición de terminado (Definition of Done)
- Compila y se ejecuta localmente con comandos documentados.
- No hay credenciales en git, UI, logs o prompts; `.env.example` contiene placeholders.
- Un `emailId` no da acceso a otro correo sin autorización; herramientas desconocidas no se ejecutan.
- La lectura de emails pasa por scanner **antes** del tool_result al modelo principal.
- **Todos** los `tool_use` pasan por validación + PolicyEngine. No hay rutas alternativas abiertas.
- El LLM de clasificación puede fallar sin que eso se interprete como autorización.
- Acciones sensibles simuladas requieren aprobación exacta; rechazadas nunca se ejecutan.
- Los tests reportados fueron corridos realmente. Se distingue explícitamente tests con mocks de evaluaciones con Claude.
- UI informa estados reales; no utilizar resultados hardcodeados presentándolos como inferencia del agente.
- Presentación reconoce limitaciones del prototipo.

## Presupuesto de API y desarrollo
- Tratar los USD 20 como **presupuesto operativo**, no como «suscripción» ni límite garantizado.
- Bajar coste con Haiku para tareas acotadas; Sonnet para plan, harness, seguridad delicada y bugs difíciles.
- Tests normales con `MockLLMProvider` y respuestas fixtures; llamadas reales limitadas y agrupadas por objetivo.
- Registrar manualmente gasto aproximado al terminar cada sesión (comando `/cost` u otro mecanismo disponible y consola del proveedor, si se tiene acceso); no inventar el saldo.
- Evitar reexplicar todo a Claude Code en cada prompt, contextos enormes, prompts que lo hagan leer el repo entero constantemente o subagentes múltiples.
- Limitar en runtime: max pasos de agente, retries, tokens/respuestas y tamaño de emails.

## Preguntas de diseño para validar una sola vez
- ¿Cuáles son las 3–4 tools mínimas para que la demo sea convincente?
- ¿Cómo suspendemos una operación aprobable sin corromper el ciclo `tool_use`/`tool_result` de Claude? Si no cabe reanudación completa, pausar y registrar aprobación/ejecución independiente es válido para MVP.
- ¿Qué comportamiento de cuarentena representa mejor el caso? Preferir no entregar contenido detectado como riesgoso.
- ¿La clave suministrada permite API desde la aplicación además de Claude Code y qué límites de crédito se aplican?
