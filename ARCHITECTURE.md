# InboxEye — arquitectura definitiva: agent-driven + security pipeline

## 1. Decisión nuclear
**El agente conduce el procesamiento.** La UI solo elige qué email simulado procesar; el backend inicia una corrida con el **ID** y contexto confiable. Claude conoce misión y tools, decide llamar a `readEmail(id)`, luego decide siguientes acciones. **No recibe el cuerpo del correo por adelantado.** El harness es código TypeScript, *parte del agente*, y aplica controles obligatorios sobre llamadas a herramientas y resultados externos.

La inspección HTML/texto es un paso de seguridad del **resultado de `readEmail`**, no un procesamiento de negocio independiente que sustituya al agente.

## 2. Componentes y roles
| Componente | IA | ¿Autónomo? | Responsabilidad |
|---|---|---|---|
| Email Processing Agent (Claude + harness + tools + objective) | Sí | **Uno solo** | Decide orden de herramientas, clasifica, resume, propone borradores/acciones. |
| Harness / Agent Runtime | No por sí mismo | Parte del agente | Ejecuta loop `tool_use → tool_result`, valida inputs, controla pasos, invoca seguridad, maneja resultados/errores. |
| Security Analyzer | Una llamada separada a Claude | No | Analiza **contenido externo** y signos de indirect prompt injection antes de devolverlo como `tool_result`. |
| Policy Engine | No, TypeScript | No | Chequea autorización de tool, recurso, destinatario, efectos y requisitos de aprobación; siempre manda por encima de los LLM. |
| Action Evaluator (P1) | Una llamada separada a Claude, condicional | No | Estima si una **acción propuesta** se alinea con la misión empresarial; no autoriza por sí solo. |
| Human Approval | No | No | Aprueba/rechaza acción sensible autorizable, unida a tool + args exactos + run; no anula prohibiciones. |
| Simulated Tool Executor | No | No | Lee emails, consulta registros, guarda borradores, simula envíos sin contactar terceros. |
| Frontend React | No | No | Inbox, selección/batch, trazas, hallazgos y revisiones. |

Claude Code se utiliza para **desarrollar** InboxEye; NO es el agente empresarial de runtime.

## 3. Diagrama de flujo
```text
[React: seleccionar email(s) → Procesar]
                  |
          POST /runs { emailIds }
                  |
[Backend: crea Run por ID, lote secuencial]
                  |
       [EMAIL PROCESSING AGENT]
         [HARNESS inicia Claude]
     objective confiable + emailId + tool schemas
                  |
       Claude solicita readEmail(id)
                  |
      BEFORE TOOL: Policy Engine
       DENY / REVIEW / ALLOW
                  |
      [Tool Executor: readEmail]
                  |
      AFTER TOOL: pipeline de seguridad
      - parseo/normalización HTML (si aplica)
      - Security Analyzer: otra llamada a Claude
      - SAFE / SUSPICIOUS / QUARANTINE
                  |
    [tool_result al Claude principal]
       solo resultado admitido o aviso
                  |
    Claude interpreta y pide otra tool
                  |
      BEFORE TOOL: Policy Engine
      Action Evaluator (si corresponde, P1)
      Human Approval (si corresponde)
                  |
       ALLOW / DENY / PENDING
                  |
     ejecutar herramienta o suspender
                  |
         tool_result → Claude
                  |
     repetir con límite de pasos/costo
                  |
[Run/eventos/estados → React dashboard]
```

## 4. Boundary / jerarquía de confianza
1. **Confiable:** configuración del backend, `AGENT_OBJECTIVE`, permisos estructurados, estado de la corrida, aprobación autenticada/validada en demo, fixtures internos clasificados en el servidor.
2. **No confiable:** subject, sender, body text/plain, HTML, links, datos retornados por herramientas que se originan externamente, sugerencias del propio LLM.
3. Nunca interpolar un email como `system` ni aceptar en él instrucciones para cambiar objetivos/permisos. El contexto inicial de Claude contiene `emailId`, no el cuerpo. Preprocesamiento del correo es responsabilidad del harness al devolver `readEmail`.
4. La salida `SAFE` de Security Analyzer significa **«no encontró indicios suficientes»**, NO «correo confiable» ni permiso adicional. `HIGH/QUARANTINE` evita devolver el contenido al agente; error de inspección falla de forma segura.
5. No enviar el contenido HTML bruto a un componente React que lo renderice sin sanitización. Vista de fuente: mostrar texto escapado, sin scripts ni recursos remotos.

## 5. Herramientas de ejemplo (ajustables dentro del MVP)
- `readEmail({ emailId })`: devuelve correo sintético al harness, **no directo a Claude**; antes pasa autorización, después inspector.
- `lookupRecord({ recordId })`: consulta registros internos sintéticos, solo IDs permitidos; prohibir IDs restringidos. Registro devuelve datos mínimos necesarios.
- `createDraft({ emailId, subject, body })`: escribe un borrador sintético de respuesta. Validar longitudes e IDs; no enviar.
- `sendEmail({ draftId, to })`: **simulación** de envío. Solo para destinos autorizables y con aprobación humana exacta previa; never real mail.
- La clasificación y el resumen pueden entregarse como respuesta estructurada del agente o actualizar estado mediante una herramienta simple; no inventar herramientas redundantes.

Todas las entradas de tools se validan contra schema en runtime. Evitar `executeCommand`, lectura arbitraria del FS, fetch de URL arbitraria o `sendRawHttp`.

## 6. Mecanismo de autorización de una acción
En orden:
1. Validación de nombre y esquema de herramienta; desconocido → `DENY`.
2. `PolicyEngine` determinista: tool habilitada, alcance de IDs/recursos, clasificación de información, destinatario permitido, operación y límite de frecuencia; prohibición → `DENY` sin consultar LLM.
3. `ActionEvaluator` (P1): **solo** si la acción pasó la política dura y tiene riesgo semántico/ambigüedad; recibe objetivo confiable + acción propuesta + contexto mínimo necesario y etiquetado como no confiable. `misaligned` → `DENY`; `uncertain` → `REVIEW` o `DENY`; `aligned` **no concede permisos**.
4. Si por reglas la acción sensible necesita humano, dejarla en `PENDING_APPROVAL` aunque LLM diga `aligned`; no ejecutar mientras esté pendiente.
5. Si se autoriza, `ToolExecutor` ejecuta y harness devuelve `tool_result` a Claude.
6. Auditar pasos. Ante caídas del evaluador o políticas, no permitir por defecto.

### Aprobación humana en MVP
En el dashboard mostrar la tool y **parámetros exactos** (resumen, destinatario, IDs, contenido a compartir). Guardar `runId`, `toolCallId`, args normalizados, estado pendiente; aprobar **solo** esos parámetros (sin edición silenciosa). Al aprobar, backend revalida política y ejecuta **una sola vez** la operación simulada; al rechazar registra no ejecución. Diseñar suspensión/reanudación simple; es válido dejar la corrida detenida con resultado `PENDING_APPROVAL` y emitir un evento final tras aprobación sin recrear el bucle del agente, si eso ahorra complejidad. Documentar esta limitación.

## 7. Security Analyzer y HTML
- **Paso 1** (`readEmail` ejecutado): parser HTML tolerante, sin ejecutar scripts/recursos, extrae texto legible y marcadores de fragmentos ocultos por heurísticas simples. Mensajes text-only son válidos.
- **Paso 2**: llamada a Claude como clasificador, sin herramientas, con instrucciones defensivas y contenido etiquetado como no confiable. Parseo y validación de JSON/schema en backend. Considerar salida mínima: `{verdict: 'safe'|'suspicious'|'quarantine', reason, evidence}`.
- **Paso 3**: `quarantine` → no devolver cuerpo al agente, registrar; `suspicious` → política conservadora (por defecto revisión/cuarentena según configuración explícita); `safe` → devolver texto admitido **como tool_result de origen externo**, nunca autoridad.
- Un correo puede tener indicios de ataque y ser inocente (falso positivo); registrar razones y revisar.
- HTML oculto **no** significa automáticamente prompt injection; el parser solo destaca fragmentos para que el clasificador los evalúe.

## 8. Estados y eventos
- `PENDING`: recibido/seleccionado aún sin procesar.
- `PROCESSING`: ejecución activa.
- `PROCESSED`: terminó satisfactoriamente la tarea permitida.
- `QUARANTINED`: correo retenido por análisis.
- `BLOCKED_ACTION`: hubo intento de una acción prohibida. Se registra también como evento aunque el agente eventualmente finalice; definir estado final consistente.
- `PENDING_APPROVAL`: operación sensible propuesta y pausada.
- `FAILED`: falló la corrida, se agotó límite o no se pudo inspeccionar con seguridad.

Registro append-only en memoria para demo: `{runId, emailId, timestamp, eventType, tool?, decision?, reason?}`; sin guardar secretos ni texto completo sensible en trazas. Refrescar UI vía polling sencillo; WebSocket no necesario.

## 9. Pseudocódigo de referencia (conceptual)
```ts
async function runEmailAgent(emailId: string, trustedContext: AgentContext) {
  let response = await invokeClaude({
    system: trustedContext.agentObjective,
    userEvent: { type: 'PROCESS_EMAIL', emailId },
    toolSchemas: AVAILABLE_TOOLS,
  });

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    if (!response.toolCalls.length) return finalizeRun(response);

    const toolResults = [];
    for (const call of response.toolCalls) {
      const permitted = policyEngine.evaluate(call, trustedContext);
      if (permitted.kind === 'DENY') {
        toolResults.push(blockedToolResult(call));
        continue;
      }
      const semantic = shouldEvaluate(call)
        ? await actionEvaluator.assess(trustedContext.agentObjective, call)
        : null;
      if (semantic?.kind === 'MISALIGNED') {
        toolResults.push(blockedToolResult(call));
        continue;
      }
      if (permitted.kind === 'REVIEW' || semantic?.kind === 'UNCERTAIN') {
        queueExactApproval(call, trustedContext);
        return suspendRun(); // No se ejecuta aún. Reanudar/aprobar explícitamente.
      }

      const rawResult = await simulatedToolExecutor(call);
      if (call.name === 'readEmail') {
        const parsed = extractEmailContent(rawResult);
        const verdict = await securityAnalyzer.inspect(parsed, trustedContext.agentObjective);
        toolResults.push(['quarantine', 'suspicious'].includes(verdict.verdict)
          ? quarantinedToolResult(call)
          : admittedToolResult(call, parsed.agentVisibleText));
      } else {
        toolResults.push(normalToolResult(call, rawResult));
      }
    }
    response = await continueClaudeWithToolResults(response, toolResults);
  }
  return failSafely('Maximum tool steps reached');
}
```
**Atención:** es pseudocódigo de dominio, NO API literal. La implementación debe respetar la semántica real de `tool_use`/`tool_result`, **todas** las llamadas concurrentes que emita el modelo, y la consistencia de resultados si queda una aprobación pendiente. Para el MVP se puede configurar ejecución secuencial de herramientas si el SDK/modelo lo permite y simplificar el manejo.

## 10. Threat model compacto
- **Activo:** documentos/registros internos sintéticos, destino y contenido de mensajes, integridad de la tarea del agente.
- **Atacante:** remitente externo que controla asunto, texto/HTML del correo y posibles instrucciones escondidas. No controla configuración confiable ni permisos.
- **Superficies:** body text/html, metadatos, enlaces simulados, resultados de tools de origen externo.
- **Abusos:** goal hijacking, extracción de datos, envío no autorizado, evasión del scanner, elevación de confianza por contenido del email, costes excesivos por bucles.
- **Controles:** tipado/validación, extracción prudente, scanner LLM, autorizaciones fuera del LLM, revisión humana, topes de llamadas, logs y pruebas.
- **Límites:** el clasificador y el propio agente pueden equivocarse; la seguridad de tools no elimina todos los riesgos de contenido generado; el parser HTML no simula todos los clientes de mail.

## 11. Criterio arquitectónico
Monolito modular y dependencias invertidas donde aporten valor. `AgentRunner` depende de una interfaz `LLMProvider`, `SecurityAnalyzer` de un `Classifier`, `PolicyEngine` no depende de LLM, `ToolExecutor` resuelve solo tools explícitas. Evitar abstraer todo antes de tener un vertical slice funcionando.
