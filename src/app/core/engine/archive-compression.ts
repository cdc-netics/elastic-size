import { ArchiveCompressionInput, ArchiveCompressionMode, ByteUnitSystem } from '../models/sizing.models';

const BYTES_PER_HOUR = 3600;
const BYTES_PER_DAY = 86400;
const DAYS_PER_MONTH = 30;
const MIN_EVENT_BYTES = 50;
const MAX_EVENT_BYTES = 10_000;
const MIN_COMPRESSION_FACTOR = 0.01;
const MAX_COMPRESSION_FACTOR = 0.5;

export interface EpsRatesBytes {
  eventsPerDay: number;
  rawBytesPerSecond: number;
  rawBytesPerHour: number;
  rawBytesPerDay: number;
}

export interface RetentionTotalsBytes {
  onlineStorageBytes: number;
  archiveStorageBytes: number;
  totalRetainedBytes: number;
}

export interface ArchiveSizingReport {
  inputs: {
    eps: number;
    avgEventBytes: number;
    retention_hot_days: number;
    retention_archived_days: number;
    mode: ArchiveCompressionMode;
    compression_factor: number;
    index_overhead_factor: number;
    unit_system: ByteUnitSystem;
    online_storage_basis: 'indexed';
  };
  rates: {
    events_per_day: number;
    raw_gb_per_hour: number;
    raw_gb_per_day: number;
    raw_gb_per_month: number;
    indexed_gb_per_day: number;
    archive_gb_per_day: number;
  };
  totals: {
    online_total_gb: number;
    archive_total_gb: number;
    total_retained_gb: number;
  };
  warnings: string[];
}

export function computeRatesFromEps(eps: number, avgEventBytes: number): EpsRatesBytes {
  const safeEps = Math.max(0, Number.isFinite(eps) ? eps : 0);
  const safeAvgEventBytes = Math.max(0, Number.isFinite(avgEventBytes) ? avgEventBytes : 0);
  const rawBytesPerSecond = safeEps * safeAvgEventBytes;

  return {
    eventsPerDay: safeEps * BYTES_PER_DAY,
    rawBytesPerSecond,
    rawBytesPerHour: rawBytesPerSecond * BYTES_PER_HOUR,
    rawBytesPerDay: rawBytesPerSecond * BYTES_PER_DAY,
  };
}

export function computeIndexed(rawBytes: number, indexOverheadFactor: number): number {
  const safeRawBytes = Math.max(0, Number.isFinite(rawBytes) ? rawBytes : 0);
  const safeFactor = Math.max(0, Number.isFinite(indexOverheadFactor) ? indexOverheadFactor : 0);
  return safeRawBytes * safeFactor;
}

export function computeArchiveDaily(
  rawBytesPerDay: number,
  indexedBytesPerDay: number,
  mode: ArchiveCompressionMode,
  compressionFactor: number,
): number {
  const safeRawBytes = Math.max(0, Number.isFinite(rawBytesPerDay) ? rawBytesPerDay : 0);
  const safeIndexedBytes = Math.max(0, Number.isFinite(indexedBytesPerDay) ? indexedBytesPerDay : 0);
  const safeCompression = Math.max(0, Number.isFinite(compressionFactor) ? compressionFactor : 0);

  if (mode === 'raw_to_archive') {
    return safeRawBytes * safeCompression;
  }
  return safeIndexedBytes * safeCompression;
}

export function computeRetentionTotals(
  indexedBytesPerDay: number,
  archiveDailyBytes: number,
  hotDays: number,
  archivedDays: number,
): RetentionTotalsBytes {
  const safeIndexedDaily = Math.max(0, Number.isFinite(indexedBytesPerDay) ? indexedBytesPerDay : 0);
  const safeArchiveDaily = Math.max(0, Number.isFinite(archiveDailyBytes) ? archiveDailyBytes : 0);
  const safeHotDays = Math.max(0, Number.isFinite(hotDays) ? hotDays : 0);
  const safeArchivedDays = Math.max(0, Number.isFinite(archivedDays) ? archivedDays : 0);

  const onlineStorageBytes = safeIndexedDaily * safeHotDays;
  const archiveStorageBytes = safeArchiveDaily * safeArchivedDays;

  return {
    onlineStorageBytes,
    archiveStorageBytes,
    totalRetainedBytes: onlineStorageBytes + archiveStorageBytes,
  };
}

export function formatBytes(bytes: number, unitSystem: ByteUnitSystem): { value: number; unit: 'GB' | 'GiB' } {
  const safeBytes = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (unitSystem === 'GiB2') {
    return {
      value: safeBytes / (1024 ** 3),
      unit: 'GiB',
    };
  }
  return {
    value: safeBytes / 1_000_000_000,
    unit: 'GB',
  };
}

export function computeArchiveSizing(input: ArchiveCompressionInput): ArchiveSizingReport {
  const warnings: string[] = [];
  const eps = sanitizeNonNegative(input.eps);
  const hotDays = sanitizeWholeDays(input.retentionHotDays);
  const archivedDays = sanitizeWholeDays(input.retentionArchivedDays);
  const avgEventBytes = sanitizeBounded(input.avgEventBytes, MIN_EVENT_BYTES, MAX_EVENT_BYTES);
  const compressionFactor = sanitizeBounded(input.compressionFactor, MIN_COMPRESSION_FACTOR, MAX_COMPRESSION_FACTOR);
  const indexOverheadFactor = sanitizeNonNegative(input.indexOverheadFactor);
  const mode: ArchiveCompressionMode = input.mode === 'raw_to_archive' ? 'raw_to_archive' : 'indexed_to_archive';
  const unitSystem: ByteUnitSystem = input.unitSystem === 'GiB2' ? 'GiB2' : 'GB10';

  if (input.eps !== eps) {
    warnings.push('EPS debe ser >= 0. Se ajusto a un valor valido.');
  }
  if (input.retentionHotDays !== hotDays || input.retentionArchivedDays !== archivedDays) {
    warnings.push('Los dias de retencion deben ser enteros >= 0. Se ajustaron automaticamente.');
  }
  if (input.avgEventBytes !== avgEventBytes) {
    warnings.push(`avgEventBytes fuera de rango [${MIN_EVENT_BYTES}, ${MAX_EVENT_BYTES}] bytes. Se aplico ajuste.`);
  }
  if (input.compressionFactor !== compressionFactor) {
    warnings.push(`compressionFactor fuera de rango [${MIN_COMPRESSION_FACTOR}, ${MAX_COMPRESSION_FACTOR}]. Se aplico ajuste.`);
  }
  if (input.indexOverheadFactor !== indexOverheadFactor) {
    warnings.push('indexOverheadFactor debe ser >= 0. Se ajusto a un valor valido.');
  }

  const rates = computeRatesFromEps(eps, avgEventBytes);
  const indexedBytesPerDay = computeIndexed(rates.rawBytesPerDay, indexOverheadFactor);
  const archiveDailyBytes = computeArchiveDaily(rates.rawBytesPerDay, indexedBytesPerDay, mode, compressionFactor);
  const totals = computeRetentionTotals(indexedBytesPerDay, archiveDailyBytes, hotDays, archivedDays);

  return {
    inputs: {
      eps,
      avgEventBytes,
      retention_hot_days: hotDays,
      retention_archived_days: archivedDays,
      mode,
      compression_factor: compressionFactor,
      index_overhead_factor: indexOverheadFactor,
      unit_system: unitSystem,
      online_storage_basis: 'indexed',
    },
    rates: {
      events_per_day: rates.eventsPerDay,
      raw_gb_per_hour: formatBytes(rates.rawBytesPerHour, unitSystem).value,
      raw_gb_per_day: formatBytes(rates.rawBytesPerDay, unitSystem).value,
      raw_gb_per_month: formatBytes(rates.rawBytesPerDay * DAYS_PER_MONTH, unitSystem).value,
      indexed_gb_per_day: formatBytes(indexedBytesPerDay, unitSystem).value,
      archive_gb_per_day: formatBytes(archiveDailyBytes, unitSystem).value,
    },
    totals: {
      online_total_gb: formatBytes(totals.onlineStorageBytes, unitSystem).value,
      archive_total_gb: formatBytes(totals.archiveStorageBytes, unitSystem).value,
      total_retained_gb: formatBytes(totals.totalRetainedBytes, unitSystem).value,
    },
    warnings,
  };
}

function sanitizeNonNegative(value: number): number {
  const safe = Number(value);
  if (!Number.isFinite(safe)) {
    return 0;
  }
  return Math.max(0, safe);
}

function sanitizeWholeDays(value: number): number {
  const safe = sanitizeNonNegative(value);
  return Math.round(safe);
}

function sanitizeBounded(value: number, min: number, max: number): number {
  const safe = Number(value);
  if (!Number.isFinite(safe)) {
    return min;
  }
  return Math.max(min, Math.min(max, safe));
}
