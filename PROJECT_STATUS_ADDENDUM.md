# Sección para incorporar a PROJECT_STATUS.md (NO sobrescribir historial)

## Revisión de alcance — 23/10/2026
- [x] Confirmado con mentores de Proofpoint: el concepto de InboxEye gusta; advertencia principal: alcance ambicioso y necesidad de entregas iterativas completas.
- [x] MVP v6 definido: demo local protegida, una empresa ficticia NovaShop hardcodeada, agente Claude, 5 tools sintéticas, Input Guard estático + segundo LLM, Action Guard, AgentReport JSON, inbox + trazas; comparación de modos y cola tras estabilizar recorrido base.
- [x] Revisión estática de ZIP actual: `AgentRunner`, `PolicyEngine`, `RunStore`, `readEmail`, endpoints y tests escritos existen; `StubInspector` no implementa seguridad real, frontend ausente, tools extra ausentes.
- [ ] Plan de migración v6 leído y aprobado en Claude Code Plan Mode.
- [ ] Suite de tests existente repetida exitosamente tras actualizar dependencias en el entorno local.
- [ ] Agente + nuevas tools + `AgentReport` estructurado probados.
- [ ] Input Guard con LLM real y fail-closed probado.
- [ ] Consola con 3 recorridos end-to-end.
- [ ] Comparación Protected/Unprotected y/o cola secuencial (posterior a demo P0).

**Nota:** los tests 10/10 y la llamada real de 20/10 se mantienen como evidencia histórica registrada, no se afirmaron como reejecutados el 23/10. Preservar historia y distinguir «previsto», «implementado» y «validado».
