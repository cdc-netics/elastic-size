import { ByteUnitSystem, PresetUnitType, SelectedSourceItemInput } from '../models/sizing.models';
import { PresetSource } from './catalog';

const MIN_AVG_EVENT_BYTES = 50;
const MAX_AVG_EVENT_BYTES = 10_000;

export interface SelectedSourceComputedItem {
  itemId: string;
  presetId: string;
  sourceName: string;
  category: string;
  vendor: string;
  product: string;
  unitType: PresetUnitType;
  quantity: number;
  defaultEpsPerUnit: number;
  avgEventBytes: number;
  epsRange: { min: number; max: number };
  epsTypical: number;
  epsMin: number;
  epsMax: number;
  gbPerHourTypical: number;
  gbPerDayTypical: number;
  gbPerDayMin: number;
  gbPerDayMax: number;
  contributionPct: number;
  notes: string;
  knownPreset: boolean;
}

export interface SelectedSourcesTotals {
  totalEps: number;
  totalEpsMin: number;
  totalEpsMax: number;
  totalGbPerHour: number;
  totalGbPerDay: number;
  totalGbPerDayMin: number;
  totalGbPerDayMax: number;
  unitLabel: 'GB' | 'GiB';
}

export interface SelectedSourcesComputed {
  items: SelectedSourceComputedItem[];
  totals: SelectedSourcesTotals;
  warnings: string[];
}

export function computeTotalsFromSelectedSources(
  selectedSources: SelectedSourceItemInput[],
  catalog: PresetSource[],
  unitSystem: ByteUnitSystem,
): SelectedSourcesComputed {
  const warnings: string[] = [];
  const catalogById = new Map(catalog.map((entry) => [entry.id, entry]));
  const unknownPresetIds = new Set<string>();
  const computedItems: SelectedSourceComputedItem[] = [];

  for (const item of selectedSources) {
    const preset = catalogById.get(item.presetId);
    if (!preset) {
      unknownPresetIds.add(item.presetId);
      computedItems.push({
        itemId: item.id,
        presetId: item.presetId,
        sourceName: `${item.presetId} (desconocido)`,
        category: 'N/A',
        vendor: 'N/A',
        product: 'N/A',
        unitType: item.unitType ?? 'device',
        quantity: Math.max(0, Math.round(Number(item.quantity) || 0)),
        defaultEpsPerUnit: 0,
        avgEventBytes: 0,
        epsRange: { min: 0, max: 0 },
        epsTypical: 0,
        epsMin: 0,
        epsMax: 0,
        gbPerHourTypical: 0,
        gbPerDayTypical: 0,
        gbPerDayMin: 0,
        gbPerDayMax: 0,
        contributionPct: 0,
        notes: 'Preset no encontrado en el catalogo actual.',
        knownPreset: false,
      });
      continue;
    }

    const quantity = Math.max(0, Math.round(Number(item.quantity) || 0));
    const defaultEpsPerUnit = sanitizeNonNegative(item.overrides?.defaultEpsPerUnit ?? preset.defaultEpsPerUnit);
    const avgEventBytesRaw = sanitizeNonNegative(item.overrides?.avgEventBytes ?? preset.avgEventBytes);
    const avgEventBytes = clamp(avgEventBytesRaw, MIN_AVG_EVENT_BYTES, MAX_AVG_EVENT_BYTES);
    const epsMinPerUnit = sanitizeNonNegative(preset.epsRange.min);
    const epsMaxPerUnit = Math.max(epsMinPerUnit, sanitizeNonNegative(preset.epsRange.max));

    if (item.unitType && item.unitType !== preset.unitType) {
      warnings.push(
        `La fuente ${preset.vendor} ${preset.product} se modela por "${unitTypeLabel(preset.unitType)}", no por "${unitTypeLabel(item.unitType)}".`,
      );
    }

    if (avgEventBytesRaw !== avgEventBytes) {
      warnings.push(
        `avgEventBytes fuera de rango [${MIN_AVG_EVENT_BYTES}, ${MAX_AVG_EVENT_BYTES}] en ${preset.vendor} ${preset.product}. Se aplico ajuste.`,
      );
    }

    const epsTypical = quantity * defaultEpsPerUnit;
    const epsMin = quantity * epsMinPerUnit;
    const epsMax = quantity * epsMaxPerUnit;
    const bytesPerSecTypical = epsTypical * avgEventBytes;
    const bytesPerSecMin = epsMin * avgEventBytes;
    const bytesPerSecMax = epsMax * avgEventBytes;

    computedItems.push({
      itemId: item.id,
      presetId: item.presetId,
      sourceName: `${preset.vendor} ${preset.product}`,
      category: preset.category,
      vendor: preset.vendor,
      product: preset.product,
      unitType: preset.unitType,
      quantity,
      defaultEpsPerUnit,
      avgEventBytes,
      epsRange: { min: epsMinPerUnit, max: epsMaxPerUnit },
      epsTypical,
      epsMin,
      epsMax,
      gbPerHourTypical: bytesToUnit(bytesPerSecTypical * 3600, unitSystem),
      gbPerDayTypical: bytesToUnit(bytesPerSecTypical * 86400, unitSystem),
      gbPerDayMin: bytesToUnit(bytesPerSecMin * 86400, unitSystem),
      gbPerDayMax: bytesToUnit(bytesPerSecMax * 86400, unitSystem),
      contributionPct: 0,
      notes: preset.notes,
      knownPreset: true,
    });
  }

  if (unknownPresetIds.size > 0) {
    warnings.push(`Preset desconocido en import: ${Array.from(unknownPresetIds).join(', ')}.`);
  }

  const totalEps = computedItems.reduce((sum, item) => sum + item.epsTypical, 0);
  const totalEpsMin = computedItems.reduce((sum, item) => sum + item.epsMin, 0);
  const totalEpsMax = computedItems.reduce((sum, item) => sum + item.epsMax, 0);
  const totalGbPerHour = computedItems.reduce((sum, item) => sum + item.gbPerHourTypical, 0);
  const totalGbPerDay = computedItems.reduce((sum, item) => sum + item.gbPerDayTypical, 0);
  const totalGbPerDayMin = computedItems.reduce((sum, item) => sum + item.gbPerDayMin, 0);
  const totalGbPerDayMax = computedItems.reduce((sum, item) => sum + item.gbPerDayMax, 0);

  for (const item of computedItems) {
    item.contributionPct = totalEps > 0 ? (item.epsTypical / totalEps) * 100 : 0;
  }

  return {
    items: computedItems,
    totals: {
      totalEps,
      totalEpsMin,
      totalEpsMax,
      totalGbPerHour,
      totalGbPerDay,
      totalGbPerDayMin,
      totalGbPerDayMax,
      unitLabel: unitSystem === 'GiB2' ? 'GiB' : 'GB',
    },
    warnings,
  };
}

function bytesToUnit(bytes: number, unitSystem: ByteUnitSystem): number {
  const safeBytes = sanitizeNonNegative(bytes);
  if (unitSystem === 'GiB2') {
    return safeBytes / (1024 ** 3);
  }
  return safeBytes / 1_000_000_000;
}

function sanitizeNonNegative(value: number): number {
  const safe = Number(value);
  if (!Number.isFinite(safe)) {
    return 0;
  }
  return Math.max(0, safe);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function unitTypeLabel(unitType: PresetUnitType): string {
  if (unitType === 'device') {
    return 'equipos';
  }
  if (unitType === 'agent') {
    return 'agentes';
  }
  if (unitType === 'user') {
    return 'usuarios';
  }
  if (unitType === 'mailbox') {
    return 'mailboxes';
  }
  if (unitType === 'server') {
    return 'servidores';
  }
  return 'APs';
}
