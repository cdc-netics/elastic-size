import { ByteUnitSystem, SelectedSourceItemInput } from '../models/sizing.models';
import { PRESET_SOURCES_CATALOG, PresetSource } from '../presets/catalog';
import { computeTotalsFromSelectedSources } from '../presets/selected-sources.store';

export const TYPICAL_SOURCES_TABLE: PresetSource[] = PRESET_SOURCES_CATALOG;

export function compute_typical_sources_workload(
  selectedSources: SelectedSourceItemInput[],
  unitSystem: ByteUnitSystem,
) {
  return computeTotalsFromSelectedSources(selectedSources, TYPICAL_SOURCES_TABLE, unitSystem);
}
