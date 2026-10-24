# InboxEye — instrucciones operativas para Claude Code (23/10/2026)

## Misión y límite
Showcase individual del Bootcamp Proofpoint, demo 30/10/2026; examen universitario 29/10. Objetivo: **demo local terminada, verificable e impactante** de un agente de correo autónomo protegido por un harness. Presupuesto Anthropic comunicado: USD 20 compartidos entre desarrollo y runtime; confirmar consumo, no asumir límite automático.

**No construir una plataforma extensible**: una empresa sintética (NovaShop), herramientas y datos hardcodeados, un agente Claude y un segundo LLM como clasificador. Monolito sencillo Node/Express/TypeScript, frontend React/Vite, Vitest, Zod; estado en memoria. Reutilizar el primer incremento existente, NO empezar de cero sin motivo técnico probado.

## Documentación y precedencia
1. `INBOXEYE_CONTEXT.md` — alcance y definición de terminado.
2. `ARCHITECTURE.md` — límites de confianza, flujo, módulos, contratos y estados.
3. `DEMO_SCENARIOS.md` — fixtures y resultados observables deseados.
4. `IMPLEMENTATION_PLAN.md` — secuencia y recortes.
5. `MIGRATION_NOTES.md` — auditoría del incremento existente y cambios requeridos.
6. `PROJECT_STATUS.md` — hechos implementados/validados: **preservarlo** y actualizarlo al terminar cada incremento.
7. `PROMPTS.md` — mensajes de inicio y de trabajo.

Si documentos antiguos contradicen estos, prevalece esta versión de alcance (23/10). No releer todos los MD en cada llamada: usar solo los necesarios.

## Invariantes de arquitectura
- El frontend dispara `emailId` (o lote) y modo. El AgentRunner inicia Claude con un objetivo confiable + ID + schemas. **No se envía el cuerpo del email inicialmente**.
- Claude **decide las tools** y su secuencia; es el único agente autónomo. El harness gestiona `tool_use` / `tool_result` y las decisiones obligatorias de seguridad. El clasificador es una **segunda llamada LLM sin tools**, no un segundo agente.
- Toda tool pasa por verificación de nombre, esquema y política **antes** de ejecutar. `readEmail` pasa además por Input Guard sobre la respuesta **antes** de que Claude vea el contenido.
- Input Guard protegido = reglas estáticas ligeras + clasificador LLM especializado; LOW admite como dato **no confiable**, MEDIUM deriva a revisión, HIGH cuarentena; fallo de inspección nunca libera el contenido.
- Action Guard = código determinista, valida correo de la ejecución, ID de documento, herramientas y argumentos autorizados. El juicio de un LLM nunca concede permisos.
- Salida uniforme `ProcessingResult`: estado y traza generados por harness, `agentReport` estructurado producido por Claude si termina. Si cuarentena previa, `agentReport=null`.
- Modo `UNPROTECTED_DEMO` únicamente sobre fixtures, sin integraciones ni peligros reales: quita barreras empresariales adicionales para comparar; siempre mantiene sandbox, validación técnica, límites y auditoría.
- Nunca se envía email real, no se exponen shell, filesystem arbitrario, red externa, secretos ni datos privados al agente. Nunca afirmar que un ataque funcionó si no ocurrió realmente.

## Forma de trabajo — MUY IMPORTANTE
- **Primera interacción: inspección y plan, sin cambios de código.** Comparar repo con docs v6, detectar componentes reutilizables y proponer el próximo incremento mínimo. No hacer refactor masivo.
- Cada incremento debe dejar algo que compila, se prueba y puede mostrarse. Antes de programar: objetivo, archivos, criterios de aceptación, plan breve. Después: tests **realmente ejecutados**, diferencias y actualizar `PROJECT_STATUS.md` sin borrar historia.
- Priorizar el recorrido end-to-end protegido y la UI funcional antes del comparador; la comparación es el gran diferenciador para la demo pero no debe impedir una entrega terminada.
- Evitar microservicios, Redis, WebSocket, base de datos productiva, SDK universal, configurador de empresas, prompts subagente, generador de drafts (extra) y traducción a framework genérico.
- **Seguridad de secretos:** nunca leer, imprimir, buscar dentro, copiar a prompts, registrar o mostrar `.env`, `.env.*`, API keys, tokens, variables de entorno sensibles ni contenidos de `.git` buscando secretos. `grep`, `Get-Content`, `cat`, `rg` pueden mostrar claves accidentalmente: hacer verificaciones booleanas/redactadas. No poner secretos en trazas, tests, screenshots, MD o commits.
- No ejecutar instalaciones globales, commits/push, despliegues, comandos destructivos ni pruebas reales repetitivas con costo sin indicación expresa. Tests normales con mocks; pruebas Anthropic reales pequeñas, explícitas y registradas.
