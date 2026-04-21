# Estándares del Proyecto (Telegram Furniture Bot)

## 1. Arquitectura General
- El proyecto sigue una arquitectura modular y funcional.
- Se separan los middlewares globales, los routers funcionales (`user.ts`, `admin.ts`) y la lógica de negocio (`pricing.ts`, `parser.ts`).
- **NUNCA** rompas la separación de responsabilidades metiendo lógica compleja dentro de la declaración de rutas de la API/bot.
- Todo efecto de red (LLMs, Base de datos) debe estar encapsulado en sus propios módulos (`src/db`, `src/nlu/providers`).

## 2. Testing y Calidad (TDD)
- Haremos uso de **Strict TDD Mode** dado que usamos `jest`.
- Tests unitarios deben acompañar cada cambio en la lógica de negocio (principalmente pricing y esquemas). 
- Los handlers de Telegram pueden prescindir de tests automatizados complejos si requieren muchos mocks de grammy, pero la lógica de parseo y cálculo SIEMPRE se testea aislada.

## 3. Estado (Manejo de Memoria)
- Manejá siempre la sesión de forma inmutable previendo los *race-conditions*.
- Siempre validá primero si el input es válido antes de avanzar el estado o mutar la `session` de grammy.
- ¡Cuidado con el flag `ctx.session.awaiting...`! Bloqueá entradas inválidas (fotos, audios perdidos) cuando transicionás de estado.

## 4. Tipado (TypeScript)
- Usa `zod` siempre que interactúes con inputs que vienen de afuera (LLM, requests web, etc). 
- Evitar hacer _castings_ como `as any`.
- Interface y Types compartidos viven en `src/engine/types.ts` o `src/bot/types.ts`. Extender los tipos del `SessionData` explícita y globalmente en `types.ts`.

## 5. Diseño y UX del Bot
- Todas las respuestas al usuario en `user.ts` van en español Rioplatense, de forma clara, directa y amistosa.
- Evitá *silent fails*: Cuando la entrada falle (ej, NLU no entiende medidas), mostrale explícitamente al usuario qué faltó. Usar Markdown simple pero elegante.
