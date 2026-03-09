# Elastic Sizing Next

Aplicación Angular 20 para capacity planning de clusters Elasticsearch/OpenSearch con ILM por tiers (`hot/warm/cold/frozen`), escenarios comparables y export/import JSON.

## Stack y decisiones

- Frontend: Angular 20, standalone components, signals, Angular Material.
- Estado: signals puros (`signal`, `computed`, `effect`), sin NgRx.
- Backend: no incluido (cálculo 100% local en navegador).
- Persistencia local: `localStorage` + export/import JSON.

## Modos

- `study`: cálculo rápido tipo calculadora.
- `production`: mismo motor + validaciones estrictas (por ejemplo, warning si no existe tier hot con datos).

## Modelo principal

- `ScenarioInput`: escenario completo (modo, overhead, constraints, nodeProfiles, workloads).
- `WorkloadInput`: caso de uso/cliente con uno o más datasets.
- `DatasetInput`: ingest + políticas ILM por tier.
- `SizingResult`: resultado final con resumen global, vista por tier, warnings y plan opcional de nodos.

Modelos en `src/app/core/models/sizing.models.ts`.

## Motor de cálculo (puro y testeable)

Ubicación: `src/app/core/engine`.

Funciones implementadas:

- `normalizeInputs`
- `calculateStorageByTier`
- `calculatePrimaryShardsByTier`
- `calculateTotalShardsByTier`
- `recommendNodesByTier_storageBased`
- `recommendNodesByTier_shardsHeapBased`
- `recommendMasters`
- `generateWarnings`
- `optional_assignShardsToNodes`
- `calculate`

### Fórmulas clave

Conversión:

- `gb_per_day = gb_per_hour * 24`
- `bytes_per_sec = (gb_per_hour * 1e9) / 3600`
- `eps = bytes_per_sec / avg_event_bytes`

Storage por tier:

- `primary_storage_gb = daily_gb * retention_days * index_overhead_factor * headroom_factor`
- `total_storage_gb = primary_storage_gb * (1 + replicas)`

Shards:

- `primary_shards = max( ceil(primary_storage_gb / target_shard_size_gb), ceil(retention_days / rollover_days) )`
- `total_shards = primary_shards * (1 + replicas)`

Nodos por tier:

- `nodes_by_storage = ceil(total_storage_gb / (node_disk_gb * disk_usable_factor))`
- `nodes_by_shards_heap = ceil(total_shards / (heap_gb * max_shards_per_node_per_heap_gb))`
- `nodes_recommended = max(nodes_by_storage, nodes_by_shards_heap, min_data_nodes_per_tier)` cuando el tier tiene datos

Masters dedicados:

- Si `total_data_nodes > require_dedicated_masters_when_data_nodes_gt`, recomienda `dedicated_masters` (mínimo 3).

## Warnings implementados

- Tamaño promedio de shard fuera de rango recomendado.
- Oversharding.
- Tier limitado por shards/heap.
- Aplicación de mínimo de nodos HA.
- Recomendación de masters dedicados.
- Errores de input (por ejemplo EPS sin `avg_event_bytes`).

## UI

Layout requerido implementado:

- Sidebar izquierda: escenarios, workloads, datasets, presets y configuración.
- Main tabs:
  - `Resumen`
  - `Tiers`
  - `Nodos`
  - `Warnings`
  - `Export/Import JSON`

Salidas visuales en cards/chips (no tablas estilo spreadsheet).

## Archivo de ejemplo

- `public/config.sample.json`

Incluye 2 escenarios reales, con múltiples workloads y datasets.

## Scripts

```bash
npm install
npm start
npm run build
npm run test -- --watch=false
```

## Tests

Pruebas unitarias del motor en:

- `src/app/core/engine/calculate.spec.ts`

Cubre conversiones, sizing por tier, masters dedicados y regla de colocación primario/réplica.
