import { DatasetInput, NormalizedDatasetMetrics, SizingWarning } from '../models/sizing.models';

export interface NormalizationResult {
  metrics: NormalizedDatasetMetrics;
  warnings: SizingWarning[];
}

function safeNumber(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    return fallback;
  }
  return value;
}

export function normalizeInputs(dataset: DatasetInput): NormalizationResult {
  const warnings: SizingWarning[] = [];
  const avgEventBytes = safeNumber(dataset.ingest.avgEventBytes, 0);

  let gbPerHour = 0;
  let gbPerDay = 0;
  let bytesPerSec = 0;
  let eps = 0;

  if (dataset.ingest.mode === 'gb_per_hour') {
    gbPerHour = safeNumber(dataset.ingest.gbPerHour, 0);
    gbPerDay = gbPerHour * 24;
    bytesPerSec = (gbPerHour * 1e9) / 3600;
    eps = avgEventBytes > 0 ? bytesPerSec / avgEventBytes : 0;
  } else if (dataset.ingest.mode === 'gb_per_day') {
    gbPerDay = safeNumber(dataset.ingest.gbPerDay, 0);
    gbPerHour = gbPerDay / 24;
    bytesPerSec = (gbPerHour * 1e9) / 3600;
    eps = avgEventBytes > 0 ? bytesPerSec / avgEventBytes : 0;
  } else {
    eps = safeNumber(dataset.ingest.eps, 0);
    if (avgEventBytes <= 0) {
      warnings.push({
        level: 'error',
        code: 'MISSING_AVG_EVENT_BYTES',
        message: `El dataset ${dataset.name} usa EPS pero no define avg_event_bytes válido.`,
        datasetId: dataset.id,
      });
    }
    bytesPerSec = eps * avgEventBytes;
    gbPerHour = (bytesPerSec * 3600) / 1e9;
    gbPerDay = gbPerHour * 24;
  }

  if (gbPerDay <= 0) {
    warnings.push({
      level: 'warning',
      code: 'ZERO_INGEST',
      message: `El dataset ${dataset.name} tiene ingest diario igual o menor a cero.`,
      datasetId: dataset.id,
    });
  }

  return {
    metrics: {
      gbPerHour,
      gbPerDay,
      bytesPerSec,
      eps,
      avgEventBytesUsed: avgEventBytes,
    },
    warnings,
  };
}
