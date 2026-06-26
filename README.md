# Vocalía PWA

Aplicación web progresiva para la gestión integral de un torneo de fútbol con 32-34 equipos, registro de eventos en vivo (vocalía), visualizaciones en tiempo real y soporte offline.

## Tecnologías principales

- React 19 + TypeScript
- Vite 7
- Tailwind CSS 3
- Firebase (Authentication, Cloud Firestore, Hosting/Storage)

Revisa `docs/architecture.md` para el desglose completo de la arquitectura, capas y modelo de dominio.

## Requisitos previos

- Node.js >= 20
- Cuenta y proyecto configurado en Firebase

### Variables de entorno (`.env`)

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_FIREBASE_MEASUREMENT_ID=
VITE_TOURNAMENT_ID=torneo-2025
```

> *Temporal*: los valores están escritos directamente en `src/lib/firebase.ts`. Múdelos a variables de entorno antes de publicar.

## Scripts

- `pnpm dev` – servidor de desarrollo
- `pnpm build` – build de producción
- `pnpm preview` – previo local del build
- `pnpm lint` – verificación de estilo y reglas de TypeScript

## Estructura relevante

- `src/app` – proveedores globales y composición principal
- `src/core` – configuración transversal (env vars, utilidades)
- `src/modules/tournament` – capas domain / application / infrastructure / presentation del módulo de torneo
- `docs/architecture.md` – decisiones de diseño, roadmap y estructura de Firestore

## Roadmap inmediato

1. Implementar repositorios de Firestore restantes (partidos, eventos, standings cache).
2. Configurar Firebase Authentication y proteger vistas de administración.
3. Integrar `vite-plugin-pwa` para manifest y service worker.
4. Añadir pruebas unitarias para casos de uso (Vitest) y Storybook para componentes críticos.
5. Preparar despliegue automatizado (GitHub Actions + Firebase Hosting).
