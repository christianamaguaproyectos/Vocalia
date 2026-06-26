# Vocalia PWA Architecture

## 1. Vision
Vocalia es una PWA enfocada en registrar y publicar estadisticas de un torneo de futbol con funcionamiento offline y sincronizacion en tiempo real. La aplicacion se construye con React + TypeScript, TailwindCSS y Firebase (Authentication, Firestore, Hosting) siguiendo principios de clean architecture.

## 2. Capas de la aplicacion

```
src/
  app/
    providers/        # Inyección de dependencias, providers de UI
  core/               # Cross-cutting concerns (config, utils, hooks compartidos)
  modules/
    auth/             # Login de vocalia (admin)
    tournament/
      domain/         # Entidades y valores del dominio (equipos, partidos, eventos)
      application/    # Casos de uso (crear equipo, generar tabla, registrar evento)
      infrastructure/ # Adaptadores a Firestore
      presentation/   # Componentes, vistas y hooks de UI
    public-site/      # Vistas de publico (marcadores, tabla, llaves)
    admin-console/    # Vistas privadas para registrar partidos y eventos
  shared/             # Componentes y hooks reutilizables
```

La dependencia fluye de `presentation -> application -> domain` y `infrastructure` implementa interfaces definidas en `domain/application`. Ninguna otra capa accede directamente al SDK de Firebase.

## 3. Modelo de dominio

### Entidades principales
- `Tournament`: Datos generales de la edicion (nombre, temporada, estado).
- `Team`: Club participante, pertenece a un grupo y tiene jugadores.
- `Player`: Integrante con numero, posicion y referencias de tarjetas/goles.
- `GroupStanding`: Resumen por equipo (PJ, G, E, P, GF, GC, DG, puntos).
- `Match`: Partido con metadata (fase, grupo, marcador, estado, referencias de equipos).
- `MatchEvent`: Eventos atomicos (gol, tarjeta, sustitucion, inicio, fin, incidencia extra).
- `BracketNode`: Representa un cruce en playoffs (fase, llave, referencias de partidos).

### Objetos de valor
- `Score`: Marcador local/visita.
- `CardType`: `YELLOW`, `DOUBLE_YELLOW`, `RED`.
- `EventTime`: minuto + tiempo agregado + fase (regular, prorroga, penales).

### Reglas clave
1. **Fase de grupos**: Round robin por grupo (16 o 17 partidos por club segun cantidad de equipos). Clasifican los mejores 8 por grupo.
2. **Fase de octavos**: Cruces fijos (1A vs 8B, ... 8A vs 1B).
3. **Fase de cuartos en adelante**: Sorteo aleatorio en base a ganadores de la fase anterior.
4. **Persistencia**: Cada partido almacena subcoleccion `events`. Cada equipo almacena subcoleccion `players`.
5. **Calculadora de tablas**: Derivada de matches + events, nunca editada manualmente.

## 4. Estructura de Firestore

```
tournaments (collection)
  {tournamentId}
    name
    season
    status
    config { totalTeams, groupSize, points: {win:3, draw:1, loss:0} }
    groups (subcollection)
      {groupId}
        name
        order
        teams [teamId]
    teams (subcollection)
      {teamId}
        name
        groupId
        statsSnapshot { ...opcional para cache offline }
        players (subcollection)
          {playerId}
            fullName
            number
            position
    matches (subcollection)
      {matchId}
        phase
        stage (GROUP | ROUND_OF_16 | QUARTER | SEMI | FINAL)
        groupId
        homeTeamId
        awayTeamId
        startTime
        status (SCHEDULED | LIVE | FINISHED)
        score { home, away }
        bracketRef
        events (subcollection)
          {eventId}
            type (GOAL | CARD | SUBSTITUTION | START | END)
            minute
            teamId
            playerOutId
            playerInId
            cardType
            notes
```

> Nota: Cloud Functions opcionales para consolidar estadisticas en documentos `summaries` legibles por el publico.

## 5. Flujo de datos
- **Lectura en tiempo real**: `onSnapshot` desde hooks especializados (`useTeams`, `useMatches`, `useStandings`).
- **Persistencia offline**: `enableIndexedDbPersistence` ya activo. La UI debera manejar estados `isOffline` y colas de eventos.
- **Sincronizacion**: Los eventos grabados offline se sincronizan automaticamente cuando vuelve la red.

## 6. Casos de uso iniciales
1. `CreateTeam` (admin): valida grupo, limite de equipos, crea registros `Team` y jugadores.
2. `ScheduleGroupMatches`: genera calendario round robin cuando los grupos quedan completos.
3. `RecordMatchEvent`: agrega evento (gol/tarjeta/etc.), recalcula marcador en memoria y persiste.
4. `CompleteMatch`: cambia estado a `FINISHED`, dispara calculo de tabla.
5. `GenerateRoundOf16`: arma los cruces segun clasificacion de grupos.
6. `DrawNextRound`: sorteo controlado para cuartos y semifinales guardando seeds.

## 7. Rutas y vistas
- `/`: Landing + resumen del torneo.
- `/group-standings`: Tabla general por grupo (publico).
- `/bracket`: Llaves de playoffs.
- `/matches/live`: Feed de partidos en vivo.
- `/admin/login`: Autenticacion para vocalia.
- `/admin/dashboard`: Panel con tabs (equipos, calendario, partido en curso, reportes).
- `/admin/match/:id`: Registro de eventos con UI optimizada para uso en cancha.

## 8. Roadmap sugerido

1. **Foundation**
   - Configurar routing, providers, layout responsive, temas de color.
  - Implementar `FirebaseProvider` con manejo de estados offline.
  - Consolidar `AppDependenciesProvider` como contenedor de repositorios/casos de uso.
   - Definir tipos del dominio y factories en `modules/tournament/domain`.

2. **MVP de administracion**
  - CRUD basico de equipos y jugadores (UI inicial en `AdminCreateTeamForm`).
   - Generacion de calendario round robin.
   - Registro de eventos en vivo.

3. **MVP publico**
   - Tablas de posiciones calculadas en cliente.
   - Feed de partidos y marcador en vivo.
   - Vista de goleadores y tarjetas.

4. **Playoffs y sorteos**
   - Generacion automatica de octavos.
   - UI de sorteo para cuartos y semifinales.
   - Gestion de finales y tercer lugar (opcional).

5. **Optimización PWA**
   - Integrar `vite-plugin-pwa` para manifest + service worker.
   - Estrategias de cache para assets y vistas.
   - Testing offline, soporte multi-device.

6. **Calidad y observabilidad**
   - Testing unitario de casos de uso.
   - ESLint/Prettier y husky (pre-commit).
   - Logs centralizados con Firebase Analytics / Crashlytics (opcional en app nativa).

## 9. Buenas practicas
- Mantener interfaces claras entre capas. Los componentes nunca interactuan con Firestore directamente.
- Reutilizar hooks genericos para listeners (suscripciones) y mantener fallback offline.
- Documentar reglas de negocio y supuestos en `docs/`.
- Añadir pruebas para cada caso de uso antes de conectar UI.
- Automatizar despliegues con GitHub Actions + Firebase Hosting/Functions.
