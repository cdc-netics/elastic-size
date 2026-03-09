import { CommonModule } from '@angular/common';
import { Component, HostListener, computed, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';

import {
  cloneScenario,
  createDataset,
  createScenario,
  defaultArchiveCompression,
  createWorkload,
  defaultCapacityCheck,
  defaultClusterPlan,
  defaultDeploymentPlan,
  defaultNodeSizing,
  defaultPresetSources,
  sampleConfig,
  tierLabel,
  updateDatasetByPreset,
} from './core/data/defaults';
import {
  calculateAll,
  calculateMachineCapacityCheck,
  computeArchiveSizing,
  compute_typical_sources_workload,
  optional_assignShardsToNodes,
} from './core/engine';
import { MachineCapacityCheck } from './core/engine/machine-check';
import {
  DatasetInput,
  IngestInputMode,
  MachineSpecMode,
  NodeSizingMode,
  NodeShardCard,
  PresetSourceCategory,
  PresetUnitType,
  ScenarioInput,
  SizingResult,
  SizingConfig,
  TierDatasetShard,
  TierName,
  TierNodePlan,
  TIERS,
  WorkloadInput,
} from './core/models/sizing.models';
import { PRESET_CATALOG_VERSION, PRESET_SOURCES_CATALOG, PresetSource } from './core/presets/catalog';
import { unitTypeLabel } from './core/presets/selected-sources.store';

const STORAGE_KEY = 'elastic-sizing-next-config-v9';
type StorageUnit = 'auto' | 'GB' | 'TB' | 'PB';
type NodePlanViewMode = 'recommended' | 'deployment';
type UiMode = 'simple' | 'advanced';
type HostTargetOption = 'cluster_dedicado' | 'single_host' | 'docker_limits' | 'vm';

interface ClusterNodeGroup {
  clusterIndex: number;
  nodes: NodeShardCard[];
  primaries: number;
  replicas: number;
  totalShards: number;
}

@Component({
  selector: 'app-root',
  imports: [
    CommonModule,
    FormsModule,
    MatSidenavModule,
    MatToolbarModule,
    MatTabsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSelectModule,
    MatButtonModule,
    MatDividerModule,
    MatListModule,
    MatChipsModule,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  readonly tiers = TIERS;
  readonly tierLabel = tierLabel;
  readonly presetKinds = ['logs', 'endpoint', 'audit', 'netflow'];
  readonly storageUnitOptions: StorageUnit[] = ['auto', 'GB', 'TB', 'PB'];
  readonly presetCatalog: PresetSource[] = PRESET_SOURCES_CATALOG;

  readonly scenarios = signal<ScenarioInput[]>(this.loadInitialScenarios());
  readonly selectedScenarioId = signal<string>(this.scenarios()[0]?.id ?? '');
  readonly isCompact = signal<boolean>(this.detectCompactLayout());
  readonly sidebarOpened = signal<boolean>(!this.detectCompactLayout());
  readonly storageUnit = signal<StorageUnit>('auto');

  readonly importJson = signal<string>('');
  readonly importMessage = signal<string>('');
  readonly nodePlanViewMode = signal<NodePlanViewMode>('recommended');
  readonly uiMode = signal<UiMode>('simple');
  readonly presetsSearch = signal<string>('');
  readonly presetsCategoryFilter = signal<'all' | PresetSourceCategory>('all');
  readonly presetsVendorFilter = signal<'all' | string>('all');
  readonly presetActionMessage = signal<string>('');

  readonly results = computed(() => calculateAll(this.scenarios()));

  readonly selectedScenario = computed(() =>
    this.scenarios().find((scenario) => scenario.id === this.selectedScenarioId()) ?? null,
  );

  readonly selectedResult = computed(() =>
    this.results().find((result) => result.scenarioId === this.selectedScenarioId()) ?? null,
  );

  readonly archiveSizing = computed(() => {
    const scenario = this.selectedScenario();
    if (!scenario) {
      return null;
    }
    return computeArchiveSizing(scenario.archiveCompression);
  });

  readonly archiveSizingJson = computed(() => {
    const report = this.archiveSizing();
    if (!report) {
      return '';
    }
    return JSON.stringify(report, null, 2);
  });

  readonly presetCategories = computed(() => {
    const categories = new Set<PresetSourceCategory>();
    for (const preset of this.presetCatalog) {
      categories.add(preset.category);
    }
    return Array.from(categories).sort((a, b) => a.localeCompare(b));
  });

  readonly presetVendors = computed(() => {
    const category = this.presetsCategoryFilter();
    const vendors = new Set<string>();
    for (const preset of this.presetCatalog) {
      if (category === 'all' || preset.category === category) {
        vendors.add(preset.vendor);
      }
    }
    return Array.from(vendors).sort((a, b) => a.localeCompare(b));
  });

  readonly filteredPresetCatalog = computed(() => {
    const scenarios = this.scenarios();
    const selectedId = this.selectedScenarioId();
    const scenario = scenarios.find((item) => item.id === selectedId) ?? null;
    const search = this.presetsSearch().trim().toLowerCase();
    const category = this.presetsCategoryFilter();
    const vendor = this.presetsVendorFilter();
    const selected = scenario?.presetSources.selectedItems ?? [];
    const selectedPresetIds = new Set(selected.map((item) => item.presetId));

    return this.presetCatalog.filter((preset) => {
      if (category !== 'all' && preset.category !== category) {
        return false;
      }
      if (vendor !== 'all' && preset.vendor !== vendor) {
        return false;
      }
      if (selectedPresetIds.has(preset.id)) {
        return false;
      }
      if (!search) {
        return true;
      }
      const haystack = `${preset.vendor} ${preset.product} ${preset.category} ${preset.tags.join(' ')}`.toLowerCase();
      return haystack.includes(search);
    });
  });

  readonly selectedSourcesTotals = computed(() => {
    const scenarios = this.scenarios();
    const selectedId = this.selectedScenarioId();
    const scenario = scenarios.find((item) => item.id === selectedId) ?? null;
    if (!scenario) {
      return null;
    }
    return compute_typical_sources_workload(
      scenario.presetSources.selectedItems,
      scenario.presetSources.unitSystem,
    );
  });

  readonly deploymentPlan = computed(() => {
    const scenario = this.selectedScenario();
    const result = this.selectedResult();
    if (!scenario || !result) {
      return null;
    }

    const clusters = Math.max(1, Math.round(scenario.deployment.clusterCount || 1));
    const fixedPerCluster = Math.max(1, Math.round(scenario.deployment.fixedDataNodesPerCluster || 1));
    const recommendedTotal = result.totals.dataNodes;
    const recommendedPerCluster = Math.max(1, Math.ceil(recommendedTotal / clusters));
    const plannedPerCluster = fixedPerCluster;
    const plannedTotal = plannedPerCluster * clusters;

    return {
      clusters,
      plannedPerCluster,
      plannedTotal,
      recommendedPerCluster,
      recommendedTotal,
      deltaNodes: plannedTotal - recommendedTotal,
    };
  });

  readonly machineCapacityCheck = computed(() => {
    const scenario = this.selectedScenario();
    const result = this.selectedResult();
    if (!scenario || !result) {
      return null;
    }
    return calculateMachineCapacityCheck(scenario, result);
  });

  readonly deploymentNodePlan = computed(() => {
    const scenario = this.selectedScenario();
    const result = this.selectedResult();
    if (!scenario || !result) {
      return [];
    }

    const rows: TierDatasetShard[] = result.workloads.flatMap((workload) => workload.datasets);
    const clusterCount = Math.max(1, Math.round(Number(scenario.deployment.clusterCount) || 1));
    const fixedDataNodesPerCluster = Math.max(1, Math.round(Number(scenario.deployment.fixedDataNodesPerCluster) || 1));
    const forcedNodeCount = clusterCount * fixedDataNodesPerCluster;

    return optional_assignShardsToNodes(rows, result.tiers, {
      forcedNodeCount,
      clusterCount,
      nodesPerCluster: fixedDataNodesPerCluster,
    });
  });

  readonly activeNodePlan = computed(() => {
    const scenario = this.selectedScenario();
    const result = this.selectedResult();
    if (!scenario || !result) {
      return [];
    }

    const mode = this.nodePlanViewMode();
    return mode === 'deployment' ? this.deploymentNodePlan() : result.nodePlan;
  });

  readonly exportJson = computed(() => JSON.stringify(this.buildConfig(), null, 2));
  readonly exportElasticsearchApiJson = computed(() => JSON.stringify(this.buildElasticsearchApiPayload(), null, 2));

  constructor() {
    effect(() => {
      const payload = JSON.stringify(this.buildConfig());
      localStorage.setItem(STORAGE_KEY, payload);
    });

    effect(() => {
      const selected = this.selectedScenarioId();
      const exists = this.scenarios().some((scenario) => scenario.id === selected);
      if (!exists && this.scenarios().length > 0) {
        this.selectedScenarioId.set(this.scenarios()[0].id);
      }
    });

    effect(() => {
      if (!this.isCompact()) {
        this.sidebarOpened.set(true);
      }
    });
  }

  setSelectedScenario(id: string): void {
    this.selectedScenarioId.set(id);
    if (this.isCompact()) {
      this.sidebarOpened.set(false);
    }
  }

  markDirty(): void {
    this.scenarios.update((items) => [...items]);
  }

  addScenario(): void {
    const newScenario = createScenario(`Escenario ${this.scenarios().length + 1}`, 'study');
    this.scenarios.update((items) => [...items, newScenario]);
    this.selectedScenarioId.set(newScenario.id);
  }

  duplicateScenario(): void {
    const source = this.selectedScenario();
    if (!source) {
      return;
    }
    const duplicated = cloneScenario(source, `${source.name} (copia)`);
    this.scenarios.update((items) => [...items, duplicated]);
    this.selectedScenarioId.set(duplicated.id);
  }

  addWorkload(): void {
    const scenario = this.selectedScenario();
    if (!scenario) {
      return;
    }

    scenario.workloads.push(createWorkload(`Workload ${scenario.workloads.length + 1}`));
    this.markDirty();
  }

  addDataset(workload: WorkloadInput, kind: string = 'logs'): void {
    workload.datasets.push(createDataset(kind));
    this.markDirty();
  }

  applyPreset(dataset: DatasetInput, kind: string): void {
    const updated = updateDatasetByPreset(dataset, kind);
    Object.assign(dataset, updated);
    this.markDirty();
  }

  onIngestModeChange(dataset: DatasetInput, mode: IngestInputMode): void {
    dataset.ingest.mode = mode;
    if (mode === 'gb_per_hour') {
      dataset.ingest.gbPerHour = dataset.ingest.gbPerHour ?? 1;
    }
    if (mode === 'gb_per_day') {
      dataset.ingest.gbPerDay = dataset.ingest.gbPerDay ?? 24;
    }
    if (mode === 'eps_plus_avg_event_bytes') {
      dataset.ingest.eps = dataset.ingest.eps ?? 1000;
      dataset.ingest.avgEventBytes = dataset.ingest.avgEventBytes ?? 800;
    }
    this.markDirty();
  }

  removeWorkload(workloadId: string): void {
    const scenario = this.selectedScenario();
    if (!scenario) {
      return;
    }

    scenario.workloads = scenario.workloads.filter((workload) => workload.id !== workloadId);
    this.markDirty();
  }

  removeDataset(workload: WorkloadInput, datasetId: string): void {
    workload.datasets = workload.datasets.filter((dataset) => dataset.id !== datasetId);
    this.markDirty();
  }

  updateMode(mode: 'study' | 'production'): void {
    const scenario = this.selectedScenario();
    if (!scenario) {
      return;
    }
    scenario.mode = mode;
    this.markDirty();
  }

  updateDeployment(scenario: ScenarioInput): void {
    scenario.deployment.clusterCount = Math.max(1, Math.round(Number(scenario.deployment.clusterCount) || 1));
    scenario.deployment.fixedDataNodesPerCluster = Math.max(1, Math.round(Number(scenario.deployment.fixedDataNodesPerCluster) || 1));
    scenario.deployment.clusterLoadMode = scenario.deployment.clusterLoadMode === 'duplicate' ? 'duplicate' : 'split';
    this.markDirty();
  }

  updateSizingApproach(scenario: ScenarioInput, value: 'normal' | 'machine_requirements'): void {
    scenario.sizingApproach = value;
    if (value === 'machine_requirements' && scenario.capacityCheck.mode === 'required_power') {
      scenario.capacityCheck.mode = 'fit_machine';
      this.nodePlanViewMode.set('deployment');
    }
    if (value === 'normal') {
      scenario.capacityCheck.mode = 'required_power';
    }
    this.markDirty();
  }

  updateMachineSpecMode(scenario: ScenarioInput, mode: MachineSpecMode): void {
    scenario.capacityCheck.mode = mode;
    scenario.sizingApproach = 'machine_requirements';
    if (mode === 'fit_machine_docker') {
      scenario.deploymentPlan.mode = 'docker';
    }
    this.markDirty();
  }

  hostTargetForScenario(scenario: ScenarioInput): HostTargetOption {
    if (scenario.capacityCheck.mode === 'fit_machine_docker') {
      return 'docker_limits';
    }
    if (scenario.deploymentPlan.mode === 'vm') {
      return 'vm';
    }
    if (scenario.deployment.clusterCount === 1 && scenario.deployment.fixedDataNodesPerCluster === 1) {
      return 'single_host';
    }
    return 'cluster_dedicado';
  }

  setHostTarget(scenario: ScenarioInput, target: HostTargetOption): void {
    if (target === 'docker_limits') {
      scenario.capacityCheck.mode = 'fit_machine_docker';
      scenario.deploymentPlan.mode = 'docker';
      scenario.sizingApproach = 'machine_requirements';
    } else if (target === 'single_host') {
      scenario.capacityCheck.mode = 'fit_machine';
      scenario.deployment.clusterCount = 1;
      scenario.deployment.fixedDataNodesPerCluster = 1;
      scenario.sizingApproach = 'machine_requirements';
    } else if (target === 'vm') {
      scenario.capacityCheck.mode = 'fit_machine';
      scenario.deploymentPlan.mode = 'vm';
      scenario.sizingApproach = 'machine_requirements';
    } else {
      scenario.capacityCheck.mode = 'fit_machine';
      scenario.sizingApproach = 'machine_requirements';
      if (scenario.deployment.clusterCount < 1) {
        scenario.deployment.clusterCount = 1;
      }
      if (scenario.deployment.fixedDataNodesPerCluster < 1) {
        scenario.deployment.fixedDataNodesPerCluster = 1;
      }
    }
    this.markDirty();
  }

  setCompareAgainstWorkload(scenario: ScenarioInput, compare: boolean): void {
    scenario.capacityCheck.compareAgainstWorkload = Boolean(compare);
    this.markDirty();
  }

  updateAvailabilityProfile(scenario: ScenarioInput, profile: 'lab' | 'standard' | 'critical'): void {
    scenario.clusterPlan.availabilityProfile = profile;
    this.markDirty();
  }

  updateQueryProfile(scenario: ScenarioInput, profile: 'low' | 'medium' | 'high'): void {
    scenario.clusterPlan.queryProfile = profile;
    this.markDirty();
  }

  updateNodeSizingMode(scenario: ScenarioInput, mode: NodeSizingMode): void {
    scenario.nodeSizing.mode = mode === 'auto' ? 'auto' : 'manual';
    this.markDirty();
  }

  updateNodeSizingDefaultsToggle(scenario: ScenarioInput, enabled: boolean): void {
    scenario.nodeSizing.applySuggestedDefaultsWhenMissing = Boolean(enabled);
    this.markDirty();
  }

  updateManualTierNodes(scenario: ScenarioInput, tier: TierName, rawValue: number | null): void {
    const value = Number(rawValue);
    if (!Number.isFinite(value) || value <= 0) {
      scenario.nodeSizing.manualNodesByTier[tier] = null;
    } else {
      scenario.nodeSizing.manualNodesByTier[tier] = Math.min(1000, Math.round(value));
    }
    this.markDirty();
  }

  clearManualTierNodes(scenario: ScenarioInput, tier: TierName): void {
    scenario.nodeSizing.manualNodesByTier[tier] = null;
    this.markDirty();
  }

  updateAutoTargetShardsPerNode(scenario: ScenarioInput, tier: TierName, rawValue: number): void {
    const value = Math.max(1, Math.round(Number(rawValue) || 1));
    if (tier === 'frozen') {
      scenario.nodeSizing.autoTargetShardsPerNodeByTier[tier] = Math.min(300, Math.max(150, value));
    } else {
      scenario.nodeSizing.autoTargetShardsPerNodeByTier[tier] = Math.min(500, value);
    }
    this.markDirty();
  }

  updateAutoNodesCap(scenario: ScenarioInput, tier: TierName, rawValue: number): void {
    const value = Math.max(1, Math.round(Number(rawValue) || 1));
    scenario.nodeSizing.autoNodesCapByTier[tier] = Math.min(1000, value);
    this.markDirty();
  }

  updateMachineProfile(scenario: ScenarioInput): void {
    scenario.capacityCheck.machineCpuCores = Math.max(1, Math.round(Number(scenario.capacityCheck.machineCpuCores) || 1));
    scenario.capacityCheck.machineRamGb = Math.max(2, Math.round(Number(scenario.capacityCheck.machineRamGb) || 2));
    scenario.capacityCheck.machineDiskGbUsable = Math.max(10, Math.round(Number(scenario.capacityCheck.machineDiskGbUsable) || 10));
    scenario.capacityCheck.headroomPct = Math.max(0, Math.min(300, Math.round(Number(scenario.capacityCheck.headroomPct) || 0)));
    this.markDirty();
  }

  updateArchiveCompression(scenario: ScenarioInput): void {
    scenario.archiveCompression.includeInSizing = Boolean(scenario.archiveCompression.includeInSizing);
    scenario.archiveCompression.eps = Math.max(0, Number(scenario.archiveCompression.eps) || 0);
    scenario.archiveCompression.avgEventBytes = Math.max(1, Number(scenario.archiveCompression.avgEventBytes) || defaultArchiveCompression.avgEventBytes);
    scenario.archiveCompression.retentionHotDays = Math.max(0, Math.round(Number(scenario.archiveCompression.retentionHotDays) || 0));
    scenario.archiveCompression.retentionArchivedDays = Math.max(0, Math.round(Number(scenario.archiveCompression.retentionArchivedDays) || 0));
    scenario.archiveCompression.compressionFactor = Math.max(0.001, Number(scenario.archiveCompression.compressionFactor) || defaultArchiveCompression.compressionFactor);
    scenario.archiveCompression.indexOverheadFactor = Math.max(0, Number(scenario.archiveCompression.indexOverheadFactor) || 0);
    scenario.archiveCompression.mode = scenario.archiveCompression.mode === 'raw_to_archive' ? 'raw_to_archive' : 'indexed_to_archive';
    scenario.archiveCompression.unitSystem = scenario.archiveCompression.unitSystem === 'GiB2' ? 'GiB2' : 'GB10';
    this.markDirty();
  }

  updateDeploymentPlan(scenario: ScenarioInput): void {
    const mode = scenario.deploymentPlan.mode;
    scenario.deploymentPlan.mode = mode === 'vm' || mode === 'baremetal' ? mode : 'docker';
    scenario.deploymentPlan.services.kibanaCount = Math.max(0, Math.round(Number(scenario.deploymentPlan.services.kibanaCount) || 0));
    scenario.deploymentPlan.services.logstashCount = Math.max(0, Math.round(Number(scenario.deploymentPlan.services.logstashCount) || 0));
    scenario.deploymentPlan.services.apmCount = Math.max(0, Math.round(Number(scenario.deploymentPlan.services.apmCount) || 0));
    scenario.deploymentPlan.mapping.esNodePerContainer = Boolean(scenario.deploymentPlan.mapping.esNodePerContainer);
    this.markDirty();
  }

  updateManualShardPlan(scenario: ScenarioInput): void {
    scenario.manualShardPlan.primaryShardsPerCluster = Math.max(1, Math.round(Number(scenario.manualShardPlan.primaryShardsPerCluster) || 1));
    scenario.manualShardPlan.replicasPerPrimary = Math.max(0, Math.round(Number(scenario.manualShardPlan.replicasPerPrimary) || 0));
    this.markDirty();
  }

  importFromJson(): void {
    try {
      const parsed = JSON.parse(this.importJson()) as Partial<SizingConfig> | ScenarioInput[];
      if (Array.isArray(parsed)) {
        this.scenarios.set(this.normalizeScenarios(parsed as ScenarioInput[]));
      } else if (parsed && Array.isArray(parsed.scenarios)) {
        this.scenarios.set(this.normalizeScenarios(parsed.scenarios as ScenarioInput[]));
      } else {
        throw new Error('Formato inválido: se esperaba { scenarios: [] } o un array de escenarios.');
      }

      if (this.scenarios().length === 0) {
        throw new Error('El JSON no contiene escenarios.');
      }

      this.selectedScenarioId.set(this.scenarios()[0].id);
      this.importMessage.set('Importación OK');
    } catch (error) {
      this.importMessage.set(`Error de importación: ${(error as Error).message}`);
    }
  }

  resetWithSample(): void {
    const cloned = this.normalizeScenarios(this.deepClone(sampleConfig.scenarios));
    this.scenarios.set(cloned);
    this.selectedScenarioId.set(cloned[0]?.id ?? '');
  }

  downloadJson(): void {
    const blob = new Blob([this.exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'elastic-sizing-next-config.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  toggleSidebar(): void {
    this.sidebarOpened.update((value) => !value);
  }

  setStorageUnit(unit: StorageUnit): void {
    this.storageUnit.set(unit);
  }

  setNodePlanViewMode(mode: NodePlanViewMode): void {
    this.nodePlanViewMode.set(mode);
  }

  setUiMode(mode: UiMode): void {
    this.uiMode.set(mode);
    if (mode === 'simple') {
      const scenario = this.selectedScenario();
      if (scenario && scenario.nodeSizing.mode !== 'manual') {
        scenario.nodeSizing.mode = 'manual';
        this.markDirty();
      }
    }
  }

  setPresetsSearch(value: string): void {
    this.presetsSearch.set(value ?? '');
  }

  setPresetsCategoryFilter(value: 'all' | PresetSourceCategory): void {
    this.presetsCategoryFilter.set(value);
    const currentVendor = this.presetsVendorFilter();
    const availableVendors = this.presetVendors();
    if (currentVendor !== 'all' && !availableVendors.includes(currentVendor)) {
      this.presetsVendorFilter.set('all');
    }
  }

  setPresetsVendorFilter(value: 'all' | string): void {
    this.presetsVendorFilter.set(value);
  }

  addPresetSource(scenario: ScenarioInput, presetId: string): void {
    const preset = this.presetCatalog.find((item) => item.id === presetId);
    if (!preset) {
      return;
    }

    const index = scenario.presetSources.selectedItems.findIndex((item) => item.presetId === presetId);
    if (index >= 0) {
      const existing = scenario.presetSources.selectedItems[index];
      existing.quantity = Math.max(0, Math.round(Number(existing.quantity) || 0)) + 1;
      scenario.presetSources.selectedItems.splice(index, 1);
      scenario.presetSources.selectedItems.unshift(existing);
      this.presetActionMessage.set(`Actualizado: ${preset.vendor} ${preset.product} (cantidad ${existing.quantity}).`);
    } else {
      scenario.presetSources.selectedItems.unshift({
        id: this.generateUiId('src'),
        presetId,
        quantity: 1,
      });
      this.presetActionMessage.set(`Agregado: ${preset.vendor} ${preset.product}.`);
    }
    this.markDirty();
  }

  removePresetSource(scenario: ScenarioInput, itemId: string): void {
    const removed = scenario.presetSources.selectedItems.find((item) => item.id === itemId);
    scenario.presetSources.selectedItems = scenario.presetSources.selectedItems.filter((item) => item.id !== itemId);
    if (removed) {
      const preset = this.presetCatalog.find((entry) => entry.id === removed.presetId);
      this.presetActionMessage.set(`Eliminado: ${preset ? `${preset.vendor} ${preset.product}` : removed.presetId}.`);
    }
    this.markDirty();
  }

  updatePresetSourceQuantity(scenario: ScenarioInput, itemId: string, value: number): void {
    const item = scenario.presetSources.selectedItems.find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }
    item.quantity = Math.max(0, Math.round(Number(value) || 0));
    this.updatePresetSourceItem(scenario, itemId);
  }

  updatePresetSourceItem(scenario: ScenarioInput, itemId: string): void {
    const item = scenario.presetSources.selectedItems.find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }
    item.quantity = Math.max(0, Math.round(Number(item.quantity) || 0));
    if (item.overrides?.avgEventBytes !== undefined) {
      item.overrides.avgEventBytes = Math.max(1, Number(item.overrides.avgEventBytes) || 1);
    }
    if (item.overrides?.defaultEpsPerUnit !== undefined) {
      item.overrides.defaultEpsPerUnit = Math.max(0, Number(item.overrides.defaultEpsPerUnit) || 0);
    }
    this.markDirty();
  }

  setPresetSourceAvgEventBytes(scenario: ScenarioInput, itemId: string, value: number): void {
    const item = scenario.presetSources.selectedItems.find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }
    item.overrides = item.overrides ?? {};
    item.overrides.avgEventBytes = Math.max(1, Number(value) || 1);
    this.updatePresetSourceItem(scenario, itemId);
  }

  setPresetSourceDefaultEpsPerUnit(scenario: ScenarioInput, itemId: string, value: number): void {
    const item = scenario.presetSources.selectedItems.find((entry) => entry.id === itemId);
    if (!item) {
      return;
    }
    item.overrides = item.overrides ?? {};
    item.overrides.defaultEpsPerUnit = Math.max(0, Number(value) || 0);
    this.updatePresetSourceItem(scenario, itemId);
  }

  selectedSourceOverrideAvgEventBytes(scenario: ScenarioInput, itemId: string): number | null {
    const item = scenario.presetSources.selectedItems.find((entry) => entry.id === itemId);
    if (!item || item.overrides?.avgEventBytes === undefined) {
      return null;
    }
    return item.overrides.avgEventBytes;
  }

  selectedSourceOverrideDefaultEpsPerUnit(scenario: ScenarioInput, itemId: string): number | null {
    const item = scenario.presetSources.selectedItems.find((entry) => entry.id === itemId);
    if (!item || item.overrides?.defaultEpsPerUnit === undefined) {
      return null;
    }
    return item.overrides.defaultEpsPerUnit;
  }

  togglePresetSourcesAdvancedMode(scenario: ScenarioInput, enabled: boolean): void {
    scenario.presetSources.advancedMode = Boolean(enabled);
    this.markDirty();
  }

  setPresetSourcesUnitSystem(scenario: ScenarioInput, unitSystem: 'GB10' | 'GiB2'): void {
    scenario.presetSources.unitSystem = unitSystem === 'GiB2' ? 'GiB2' : 'GB10';
    this.markDirty();
  }

  sourceUnitInputLabel(unitType: PresetUnitType): string {
    if (unitType === 'device') {
      return '# Equipos';
    }
    if (unitType === 'agent') {
      return '# Agentes';
    }
    if (unitType === 'user') {
      return '# Usuarios';
    }
    if (unitType === 'mailbox') {
      return '# Mailboxes';
    }
    if (unitType === 'server') {
      return '# Servers';
    }
    return '# APs';
  }

  unitTypeDescription(unitType: PresetUnitType): string {
    return unitTypeLabel(unitType);
  }

  formatPresetNumber(value: number, decimals: number): string {
    return this.formatNumber(value, decimals);
  }

  archiveTierContributionNote(tier: TierName): string | null {
    const scenario = this.selectedScenario();
    const archive = this.archiveSizing();
    if (!scenario || !archive || !scenario.archiveCompression.includeInSizing) {
      return null;
    }

    const unit = this.archiveUnitLabel(archive.inputs.unit_system);
    if (tier === 'hot' && archive.rates.indexed_gb_per_day > 0) {
      return `Compresión online (indexed): ${this.formatArchiveValue(archive.rates.indexed_gb_per_day)} ${unit}/día.`;
    }
    if (tier === 'frozen' && archive.rates.archive_gb_per_day > 0) {
      return `Compresión archive: ${this.formatArchiveValue(archive.rates.archive_gb_per_day)} ${unit}/día.`;
    }
    return null;
  }

  nodeGroupsByCluster(plan: TierNodePlan): ClusterNodeGroup[] {
    const groups = new Map<number, NodeShardCard[]>();

    for (const node of plan.nodes) {
      const clusterIndex = this.clusterIndexFromNodeName(node.nodeName);
      const bucket = groups.get(clusterIndex) ?? [];
      bucket.push(node);
      groups.set(clusterIndex, bucket);
    }

    return Array.from(groups.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([clusterIndex, nodes]) => {
        const sortedNodes = [...nodes].sort((left, right) =>
          this.nodeIndexFromName(left.nodeName) - this.nodeIndexFromName(right.nodeName)
          || left.nodeName.localeCompare(right.nodeName),
        );

        return {
          clusterIndex,
          nodes: sortedNodes,
          primaries: sortedNodes.reduce((sum, node) => sum + node.primaries, 0),
          replicas: sortedNodes.reduce((sum, node) => sum + node.replicas, 0),
          totalShards: sortedNodes.reduce((sum, node) => sum + node.totalShards, 0),
        };
      });
  }

  nodeDisplayName(nodeName: string): string {
    const nodeIndex = this.nodeIndexFromName(nodeName);
    if (nodeIndex > 0) {
      return `node ${nodeIndex}`;
    }
    return nodeName;
  }

  nodeTitle(plan: TierNodePlan, nodeName: string): string {
    const clusters = this.nodeGroupsByCluster(plan);
    if (clusters.length <= 1) {
      return this.nodeDisplayName(nodeName);
    }
    const clusterIndex = this.clusterIndexFromNodeName(nodeName);
    return `cluster ${clusterIndex} · ${this.nodeDisplayName(nodeName)}`;
  }

  clusterLabel(clusterIndex: number): string {
    return `cluster ${clusterIndex}`;
  }

  tierAvgPrimaryShardSizeGb(tier: TierName): number {
    const result = this.selectedResult();
    if (!result) {
      return 0;
    }

    const rows = result.workloads
      .flatMap((workload) => workload.datasets)
      .filter((row) => row.tier === tier && row.primaryShards > 0);

    const totalPrimaryStorageGb = rows.reduce((sum, row) => sum + row.primaryStorageGb, 0);
    const totalPrimaryShards = rows.reduce((sum, row) => sum + row.primaryShards, 0);

    if (totalPrimaryShards <= 0) {
      return 0;
    }
    return totalPrimaryStorageGb / totalPrimaryShards;
  }

  nodeEstimatedStorageGb(node: NodeShardCard, tier: TierName): number {
    const avgPrimaryShardGb = this.tierAvgPrimaryShardSizeGb(tier);
    return node.totalShards * avgPrimaryShardGb;
  }

  clusterEstimatedStorageGb(cluster: ClusterNodeGroup, tier: TierName): number {
    const avgPrimaryShardGb = this.tierAvgPrimaryShardSizeGb(tier);
    return cluster.totalShards * avgPrimaryShardGb;
  }

  tierStorageFromResult(result: SizingResult, tier: TierName): number {
    return result.tiers.find((item) => item.tier === tier)?.totalStorageGb ?? 0;
  }

  tierShardsFromResult(result: SizingResult, tier: TierName): number {
    return result.tiers.find((item) => item.tier === tier)?.totalShards ?? 0;
  }

  tierNodesFromResult(result: SizingResult, tier: TierName): number {
    return result.tiers.find((item) => item.tier === tier)?.nodesRecommended ?? 0;
  }

  shardSizeAdvice(avgPrimaryShardGb: number): string {
    if (avgPrimaryShardGb > 32) {
      return 'More than 32GB, not a good idea.';
    }
    if (avgPrimaryShardGb > 28) {
      return 'More than 28GB, not a good idea.';
    }
    return '';
  }

  visibleShardPreviewCount(totalShards: number): number {
    if (totalShards <= 6) {
      return totalShards;
    }
    return 6;
  }

  tierEnabled(dataset: DatasetInput, tier: TierName): boolean {
    return (dataset.retentionDaysByTier[tier] ?? 0) > 0;
  }

  setTierEnabled(dataset: DatasetInput, tier: TierName, enabled: boolean): void {
    if (!enabled) {
      dataset.retentionDaysByTier[tier] = 0;
      if (tier === 'warm' || tier === 'cold' || tier === 'frozen') {
        dataset.replicasByTier[tier] = 0;
      }
      this.markDirty();
      return;
    }

    if ((dataset.retentionDaysByTier[tier] ?? 0) <= 0) {
      if (tier === 'hot') {
        dataset.retentionDaysByTier[tier] = 7;
      } else if (tier === 'warm') {
        dataset.retentionDaysByTier[tier] = 14;
      } else if (tier === 'cold') {
        dataset.retentionDaysByTier[tier] = 30;
      } else {
        dataset.retentionDaysByTier[tier] = 90;
      }
    }
    this.markDirty();
  }

  formatStorage(valueGb: number): string {
    const converted = this.convertStorageUnit(valueGb, this.storageUnit());
    return `${this.formatNumber(converted.value, converted.decimals)} ${converted.unit}`;
  }

  formatStorageDelta(valueGb: number): string {
    const sign = valueGb >= 0 ? '+' : '-';
    const converted = this.convertStorageUnit(Math.abs(valueGb), this.storageUnit());
    return `${sign}${this.formatNumber(converted.value, converted.decimals)} ${converted.unit}`;
  }

  formatRawGb(valueGb: number): string {
    return `${this.formatNumber(valueGb, 1)} GB base`;
  }

  formatCount(value: number): string {
    return this.formatNumber(value, 0);
  }

  archiveUnitLabel(unitSystem: 'GB10' | 'GiB2'): string {
    return unitSystem === 'GiB2' ? 'GiB' : 'GB';
  }

  formatArchiveValue(value: number): string {
    return this.formatNumber(value, 2);
  }

  machineStatusLabel(status: 'ok' | 'insufficient' | 'oversized'): string {
    if (status === 'insufficient') {
      return 'No alcanza (no corre estable)';
    }
    if (status === 'oversized') {
      return 'Sí corre (sobredimensionado)';
    }
    return 'Sí corre (dentro de capacidad)';
  }

  machineLimitingFactorLabel(factor: 'storage' | 'shards' | 'eps' | 'none'): string {
    if (factor === 'storage') {
      return 'DISK';
    }
    if (factor === 'shards') {
      return 'SHARDS';
    }
    if (factor === 'eps') {
      return 'CPU';
    }
    return 'NONE';
  }

  capacityVerdict(machine: MachineCapacityCheck, scenario: ScenarioInput): 'PASS' | 'WARNING' | 'FAIL' {
    const isMachineMode = scenario.sizingApproach === 'machine_requirements';
    const compareAgainstWorkload = scenario.capacityCheck.compareAgainstWorkload !== false;
    if (!isMachineMode) {
      return 'PASS';
    }
    if (!compareAgainstWorkload) {
      return 'WARNING';
    }
    if (machine.demand.noIngestDemand) {
      return 'WARNING';
    }
    if (!machine.fit.storageSufficient || !machine.fit.shardsSufficient || !machine.fit.epsSufficient) {
      return 'FAIL';
    }
    const storageRatio = machine.capacity.usableStorageGb > 0 ? machine.demand.storageGb / machine.capacity.usableStorageGb : 0;
    const shardRatio = machine.capacity.maxShards > 0 ? machine.demand.totalShards / machine.capacity.maxShards : 0;
    const epsRatio = machine.capacity.maxEps > 0 ? machine.demand.totalEps / machine.capacity.maxEps : 0;
    const maxRatio = Math.max(storageRatio, shardRatio, epsRatio);
    if (maxRatio >= 0.85) {
      return 'WARNING';
    }
    return 'PASS';
  }

  capacityPrimaryBottleneck(machine: MachineCapacityCheck, scenario: ScenarioInput): string {
    const isMachineMode = scenario.sizingApproach === 'machine_requirements';
    const compareAgainstWorkload = scenario.capacityCheck.compareAgainstWorkload !== false;
    const factor = isMachineMode && compareAgainstWorkload
      ? machine.fit.limitingFactor
      : machine.inverse.limitingFactor;

    if (factor === 'storage') {
      return 'DISK';
    }
    if (factor === 'shards') {
      return 'SHARDS';
    }
    if (factor === 'ram') {
      return 'RAM';
    }
    if (factor === 'eps' || factor === 'cpu') {
      return 'CPU';
    }
    return 'NONE';
  }

  capacityDeltaSummary(machine: MachineCapacityCheck, scenario: ScenarioInput): string {
    if (scenario.sizingApproach !== 'machine_requirements') {
      const cpuDelta = Math.max(0, machine.specTargets.recommended.totalCpuCores - machine.specTargets.minimum.totalCpuCores);
      const ramDelta = Math.max(0, machine.specTargets.recommended.totalRamGb - machine.specTargets.minimum.totalRamGb);
      const diskDelta = Math.max(0, machine.specTargets.recommended.totalDiskGbUsable - machine.specTargets.minimum.totalDiskGbUsable);
      return `Safe margin +${this.formatCount(cpuDelta)} vCPU, +${this.formatCount(ramDelta)} GB RAM, +${this.formatStorage(diskDelta)} disk`;
    }

    if (scenario.capacityCheck.compareAgainstWorkload === false) {
      return `Set a workload to compute deficit. Max sustainable now: ${this.formatCount(machine.inverse.maxEps)} EPS`;
    }
    if (machine.demand.noIngestDemand) {
      return 'Sin ingest/storage en workload: validación parcial (capacidad base y shards).';
    }

    const cpuDeficit = Math.max(0, machine.demand.totalCpuCores - machine.capacity.totalCpuCoresForElastic);
    const ramDeficit = Math.max(0, machine.demand.totalRamGb - machine.capacity.totalRamGbForElastic);
    const diskDeficit = Math.max(0, machine.demand.storageGb - machine.capacity.usableStorageGb);
    const shardDeficit = Math.max(0, machine.demand.totalShards - machine.capacity.maxShards);
    const epsDeficit = Math.max(0, machine.demand.totalEps - machine.capacity.maxEps);

    const deficits: string[] = [];
    if (cpuDeficit > 0.01) {
      deficits.push(`+${this.formatPresetNumber(cpuDeficit, 1)} vCPU`);
    }
    if (ramDeficit > 0.01) {
      deficits.push(`+${this.formatPresetNumber(ramDeficit, 1)} GB RAM`);
    }
    if (diskDeficit > 0.01) {
      deficits.push(`+${this.formatStorage(diskDeficit)} disk`);
    }
    if (shardDeficit > 0.01) {
      deficits.push(`+${this.formatCount(shardDeficit)} shards`);
    }
    if (epsDeficit > 0.01) {
      deficits.push(`+${this.formatCount(epsDeficit)} EPS`);
    }
    if (deficits.length > 0) {
      return `Need ${deficits.join(', ')}`;
    }

    const cpuSurplus = Math.max(0, machine.capacity.totalCpuCoresForElastic - machine.demand.totalCpuCores);
    const ramSurplus = Math.max(0, machine.capacity.totalRamGbForElastic - machine.demand.totalRamGb);
    const diskSurplus = Math.max(0, machine.capacity.usableStorageGb - machine.demand.storageGb);
    return `Surplus +${this.formatPresetNumber(cpuSurplus, 1)} vCPU, +${this.formatPresetNumber(ramSurplus, 1)} GB RAM, +${this.formatStorage(diskSurplus)} disk`;
  }

  capacityResourceStatus(required: number, available: number): 'OK' | 'WARNING' | 'FAIL' {
    if (required > available) {
      return 'FAIL';
    }
    if (available > 0 && required / available >= 0.85) {
      return 'WARNING';
    }
    return 'OK';
  }

  formatSpecSummary(nodes: number, cpu: number, ramGb: number, diskGb: number): string {
    return `${this.formatCount(nodes)} nodes | ${this.formatCount(cpu)} vCPU | ${this.formatCount(ramGb)} GB RAM | ${this.formatStorage(diskGb)} disk`;
  }

  formatSpecSummaryForScenario(
    scenario: ScenarioInput,
    nodes: number,
    cpu: number,
    ramGb: number,
    diskGb: number,
  ): string {
    const clusters = Math.max(1, Math.round(Number(scenario.deployment.clusterCount) || 1));
    const perCluster = Math.max(1, Math.ceil(Math.max(1, nodes) / clusters));
    return `${this.formatCount(nodes)} nodos total (${this.formatCount(perCluster)} por cluster x ${this.formatCount(clusters)} cluster) | `
      + `${this.formatCount(cpu)} vCPU | ${this.formatCount(ramGb)} GB RAM | ${this.formatStorage(diskGb)} disco`;
  }

  diskScopeLabel(scope: 'per_node' | 'total_cluster'): string {
    return scope === 'total_cluster' ? 'total cluster' : 'por nodo';
  }

  tierGuidanceLabel(tier: TierName): string {
    if (tier === 'hot') {
      return 'Datos recientes: más rápidos, más costo.';
    }
    if (tier === 'warm') {
      return 'Datos menos consultados: costo medio.';
    }
    if (tier === 'cold') {
      return 'Histórico: menor costo, más lento.';
    }
    return 'Archivo: muy lento, ideal con snapshots (réplicas 0).';
  }

  deploymentServiceLabel(scenario: ScenarioInput, service: 'kibana' | 'logstash' | 'apm'): string {
    const isDocker = scenario.capacityCheck.mode === 'fit_machine_docker';
    if (service === 'kibana') {
      return isDocker ? 'Kibana (contenedor)' : 'Instancias de Kibana';
    }
    if (service === 'logstash') {
      return isDocker ? 'Logstash (contenedor)' : 'Instancias de Logstash';
    }
    return isDocker ? 'APM (contenedor)' : 'Instancias de APM';
  }

  manualTierNodeSuggestion(scenario: ScenarioInput, tier: TierName): number {
    const configuredHot = scenario.nodeSizing.manualNodesByTier.hot;
    const hotNodes = configuredHot && configuredHot > 0 ? configuredHot : 3;

    if (tier === 'hot') {
      return hotNodes;
    }
    if (tier === 'warm') {
      return Math.min(12, Math.max(2, Math.ceil(hotNodes * 0.33)));
    }
    if (tier === 'cold') {
      return Math.min(8, Math.max(2, Math.ceil(hotNodes * 0.2)));
    }
    return Math.min(6, Math.max(2, Math.ceil(hotNodes * 0.1)));
  }

  manualTierNodeValue(scenario: ScenarioInput, tier: TierName): number | null {
    const value = scenario.nodeSizing.manualNodesByTier[tier];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }

  primaryShardsFromResult(result: SizingResult): number {
    return result.tiers.reduce((sum, tier) => sum + tier.primaryShards, 0);
  }

  formatDelta(value: number, unit: string): string {
    const sign = value >= 0 ? '+' : '-';
    return `${sign}${this.formatNumber(Math.abs(value), 1)} ${unit}`;
  }

  machineSpecBarPct(value: number, reference: number): number {
    if (reference <= 0) {
      return 0;
    }
    const pct = (Math.max(0, value) / reference) * 100;
    return Math.max(4, Math.min(100, pct));
  }

  trackById(index: number, item: { id: string }): string {
    return item.id;
  }

  tierRetention(dataset: DatasetInput, tier: TierName): number {
    return dataset.retentionDaysByTier[tier];
  }

  setImportJson(value: string): void {
    this.importJson.set(value);
    this.importMessage.set('');
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    const compact = this.detectCompactLayout();
    if (compact !== this.isCompact()) {
      this.isCompact.set(compact);
      if (!compact) {
        this.sidebarOpened.set(true);
      }
    }
  }

  private buildConfig(): SizingConfig {
    const resultsByScenario = new Map(this.results().map((result) => [result.scenarioId, result]));
    const scenarios = this.scenarios().map((scenario) => {
      const result = resultsByScenario.get(scenario.id);
      if (!result) {
        return scenario;
      }

      const computed = {
        tbByTier: {
          hot: this.tierStorageFromResult(result, 'hot') / 1000,
          warm: this.tierStorageFromResult(result, 'warm') / 1000,
          cold: this.tierStorageFromResult(result, 'cold') / 1000,
          frozen: this.tierStorageFromResult(result, 'frozen') / 1000,
        },
        shardsByTier: {
          hot: this.tierShardsFromResult(result, 'hot'),
          warm: this.tierShardsFromResult(result, 'warm'),
          cold: this.tierShardsFromResult(result, 'cold'),
          frozen: this.tierShardsFromResult(result, 'frozen'),
        },
        nodesByTier: {
          hot: this.tierNodesFromResult(result, 'hot'),
          warm: this.tierNodesFromResult(result, 'warm'),
          cold: this.tierNodesFromResult(result, 'cold'),
          frozen: this.tierNodesFromResult(result, 'frozen'),
        },
      };
      const machineCheck = calculateMachineCapacityCheck(scenario, result);
      const capacityResult = {
        status: machineCheck.fit.status,
        note: machineCheck.fit.status === 'insufficient'
          ? `Limita ${machineCheck.fit.limitingFactor}`
          : machineCheck.fit.status === 'oversized'
            ? 'Capacidad sobredimensionada'
            : 'Capacidad dentro de rango',
      };

      return {
        ...scenario,
        clusterPlan: {
          ...scenario.clusterPlan,
          computed,
        },
        capacityCheck: {
          ...scenario.capacityCheck,
          result: capacityResult,
        },
      };
    });

    return {
      schemaVersion: 2,
      project: {
        name: 'elastic-sizing-next',
        purpose: 'Capacity planning Elasticsearch/OpenSearch 2026 con ILM tiers, escenarios y export/import JSON',
        language: 'es',
      },
      scenarios,
    };
  }

  private buildElasticsearchApiPayload(): Record<string, unknown> {
    const scenario = this.selectedScenario() ?? this.scenarios()[0];
    if (!scenario) {
      return {};
    }

    const baseName = this.slugify(scenario.name || 'siem');
    const ilmPolicyName = `${baseName}-hot-warm-cold-frozen-120d`;
    const indexTemplateName = `${baseName}-template`;
    const dataStreamName = `logs-${baseName}-default`;
    const rolloverAlias = `logs-${baseName}`;

    return {
      ilmPolicy: {
        method: 'PUT',
        path: `/_ilm/policy/${ilmPolicyName}`,
        body: {
          policy: {
            phases: {
              hot: {
                min_age: '0ms',
                actions: {
                  set_priority: { priority: 100 },
                  rollover: {
                    max_primary_shard_size: '20gb',
                    max_age: '24h',
                  },
                },
              },
              warm: {
                min_age: '30d',
                actions: {
                  set_priority: { priority: 50 },
                },
              },
              cold: {
                min_age: '60d',
                actions: {
                  set_priority: { priority: 25 },
                },
              },
              frozen: {
                min_age: '90d',
                actions: {
                  searchable_snapshot: {
                    snapshot_repository: 'found-snapshots',
                  },
                },
              },
              delete: {
                min_age: '120d',
                actions: {
                  delete: {},
                },
              },
            },
          },
        },
      },
      indexTemplate: {
        method: 'PUT',
        path: `/_index_template/${indexTemplateName}`,
        body: {
          index_patterns: [`logs-${baseName}-*`],
          data_stream: {},
          priority: 500,
          template: {
            settings: {
              'index.lifecycle.name': ilmPolicyName,
              'index.lifecycle.rollover_alias': rolloverAlias,
              'index.number_of_shards': 1,
              'index.number_of_replicas': 1,
            },
          },
          _meta: {
            sourceScenario: scenario.name,
            sizingApproach: 'size-first rollover',
          },
        },
      },
      dataStream: {
        method: 'PUT',
        path: `/_data_stream/${dataStreamName}`,
        body: {},
      },
      sampleDocument: {
        method: 'POST',
        path: `/${dataStreamName}/_doc`,
        body: {
          '@timestamp': new Date().toISOString(),
          message: `bootstrap event for ${dataStreamName}`,
        },
      },
    };
  }

  private loadInitialScenarios(): ScenarioInput[] {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return this.normalizeScenarios(this.deepClone(sampleConfig.scenarios));
    }

    try {
      const parsed = JSON.parse(raw) as Partial<SizingConfig>;
      if (parsed && Array.isArray(parsed.scenarios) && parsed.scenarios.length > 0) {
        return this.normalizeScenarios(parsed.scenarios as ScenarioInput[]);
      }
      return this.normalizeScenarios(this.deepClone(sampleConfig.scenarios));
    } catch {
      return this.normalizeScenarios(this.deepClone(sampleConfig.scenarios));
    }
  }

  private detectCompactLayout(): boolean {
    return window.innerWidth < 1280;
  }

  private formatNumber(value: number, decimals: number): string {
    return new Intl.NumberFormat('es-CL', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  }

  private convertStorageUnit(gbValue: number, unitPreference: StorageUnit): { value: number; unit: 'GB' | 'TB' | 'PB'; decimals: number } {
    const abs = Math.abs(gbValue);
    let unit: 'GB' | 'TB' | 'PB';

    if (unitPreference === 'auto') {
      if (abs >= 1_000_000) {
        unit = 'PB';
      } else if (abs >= 1_000) {
        unit = 'TB';
      } else {
        unit = 'GB';
      }
    } else {
      unit = unitPreference;
    }

    if (unit === 'PB') {
      return { value: gbValue / 1_000_000, unit, decimals: 2 };
    }
    if (unit === 'TB') {
      return { value: gbValue / 1_000, unit, decimals: 2 };
    }
    return { value: gbValue, unit: 'GB', decimals: 1 };
  }

  private normalizeScenarios(list: ScenarioInput[]): ScenarioInput[] {
    return list.map((scenario) => this.normalizeScenario(scenario));
  }

  private normalizeScenario(scenario: ScenarioInput): ScenarioInput {
    const clusterCount = Math.max(1, Math.round(Number(scenario.deployment?.clusterCount) || 1));
    const fixedDataNodesPerCluster = Math.max(1, Math.round(Number(scenario.deployment?.fixedDataNodesPerCluster) || 1));
    const clusterLoadMode = scenario.deployment?.clusterLoadMode === 'duplicate' ? 'duplicate' : 'split';
    const sizingApproach = scenario.sizingApproach === 'machine_requirements' ? 'machine_requirements' : 'normal';
    const cpuCoresPerNode = Math.max(1, Math.round(Number(scenario.machineProfile?.cpuCoresPerNode) || 12));
    const ramGbPerNode = Math.max(2, Math.round(Number(scenario.machineProfile?.ramGbPerNode) || 16));
    const diskGbPerNode = Math.max(10, Math.round(Number(scenario.machineProfile?.diskGbPerNode) || 500));
    const diskType = scenario.machineProfile?.diskType === 'hdd' ? 'hdd' : 'ssd';
    const diskScope = scenario.machineProfile?.diskScope === 'per_node' ? 'per_node' : 'total_cluster';
    const dockerStack = scenario.machineProfile?.dockerStack;
    const dockerEnabled = Boolean(dockerStack?.enabled);
    const dockerKibana = Math.max(0, Math.round(Number(dockerStack?.kibanaCount) || 1));
    const dockerLogstash = Math.max(0, Math.round(Number(dockerStack?.logstashCount) || 0));
    const dockerOther = Math.max(0, Math.round(Number(dockerStack?.otherServicesCount) || 0));
    const manualShardEnabled = Boolean(scenario.manualShardPlan?.enabled);
    const manualPrimaryPerCluster = Math.max(1, Math.round(Number(scenario.manualShardPlan?.primaryShardsPerCluster) || 4));
    const manualReplicas = Math.max(0, Math.round(Number(scenario.manualShardPlan?.replicasPerPrimary) || 1));
    const nodeSizingMode: NodeSizingMode = scenario.nodeSizing?.mode === 'auto' ? 'auto' : 'manual';
    const applySuggestedDefaultsWhenMissing = scenario.nodeSizing?.applySuggestedDefaultsWhenMissing !== false;
    const manualHotRaw = Number(scenario.nodeSizing?.manualNodesByTier?.hot);
    const manualWarmRaw = Number(scenario.nodeSizing?.manualNodesByTier?.warm);
    const manualColdRaw = Number(scenario.nodeSizing?.manualNodesByTier?.cold);
    const manualFrozenRaw = Number(scenario.nodeSizing?.manualNodesByTier?.frozen);
    const autoTargetHot = Math.min(500, Math.max(1, Math.round(Number(scenario.nodeSizing?.autoTargetShardsPerNodeByTier?.hot) || defaultNodeSizing.autoTargetShardsPerNodeByTier.hot)));
    const autoTargetWarm = Math.min(500, Math.max(1, Math.round(Number(scenario.nodeSizing?.autoTargetShardsPerNodeByTier?.warm) || defaultNodeSizing.autoTargetShardsPerNodeByTier.warm)));
    const autoTargetCold = Math.min(500, Math.max(1, Math.round(Number(scenario.nodeSizing?.autoTargetShardsPerNodeByTier?.cold) || defaultNodeSizing.autoTargetShardsPerNodeByTier.cold)));
    const autoTargetFrozen = Math.min(300, Math.max(150, Math.round(Number(scenario.nodeSizing?.autoTargetShardsPerNodeByTier?.frozen) || defaultNodeSizing.autoTargetShardsPerNodeByTier.frozen)));
    const capHot = Math.min(1000, Math.max(1, Math.round(Number(scenario.nodeSizing?.autoNodesCapByTier?.hot) || defaultNodeSizing.autoNodesCapByTier.hot)));
    const capWarm = Math.min(1000, Math.max(1, Math.round(Number(scenario.nodeSizing?.autoNodesCapByTier?.warm) || defaultNodeSizing.autoNodesCapByTier.warm)));
    const capCold = Math.min(1000, Math.max(1, Math.round(Number(scenario.nodeSizing?.autoNodesCapByTier?.cold) || defaultNodeSizing.autoNodesCapByTier.cold)));
    const capFrozen = Math.min(1000, Math.max(1, Math.round(Number(scenario.nodeSizing?.autoNodesCapByTier?.frozen) || defaultNodeSizing.autoNodesCapByTier.frozen)));
    const clusterPlan = scenario.clusterPlan ?? defaultClusterPlan;
    const archiveCompression = scenario.archiveCompression ?? defaultArchiveCompression;
    const presetSources = scenario.presetSources ?? defaultPresetSources;
    const capacityCheck = scenario.capacityCheck;
    const deploymentPlan = scenario.deploymentPlan;
    const machineDiskUsableFallback = Math.round(diskGbPerNode * Math.max(0.05, scenario.overhead?.diskUsableFactor ?? 0.85));
    const deploymentMode = deploymentPlan?.mode === 'vm' || deploymentPlan?.mode === 'baremetal'
      ? deploymentPlan.mode
      : 'docker';
    const machineSpecMode: MachineSpecMode = capacityCheck?.mode === 'required_power'
      || capacityCheck?.mode === 'fit_machine_docker'
      ? capacityCheck.mode
      : (sizingApproach === 'normal' ? 'required_power' : 'fit_machine');

    return {
      ...scenario,
      sizingApproach,
      deployment: {
        clusterCount,
        fixedDataNodesPerCluster,
        clusterLoadMode,
      },
      machineProfile: {
        cpuCoresPerNode,
        ramGbPerNode,
        diskGbPerNode,
        diskType,
        diskScope,
        dockerStack: {
          enabled: dockerEnabled,
          kibanaCount: dockerKibana,
          logstashCount: dockerLogstash,
          otherServicesCount: dockerOther,
        },
      },
      manualShardPlan: {
        enabled: manualShardEnabled,
        primaryShardsPerCluster: manualPrimaryPerCluster,
        replicasPerPrimary: manualReplicas,
      },
      nodeSizing: {
        mode: nodeSizingMode,
        applySuggestedDefaultsWhenMissing,
        manualNodesByTier: {
          hot: Number.isFinite(manualHotRaw) && manualHotRaw > 0 ? Math.min(1000, Math.round(manualHotRaw)) : null,
          warm: Number.isFinite(manualWarmRaw) && manualWarmRaw > 0 ? Math.min(1000, Math.round(manualWarmRaw)) : null,
          cold: Number.isFinite(manualColdRaw) && manualColdRaw > 0 ? Math.min(1000, Math.round(manualColdRaw)) : null,
          frozen: Number.isFinite(manualFrozenRaw) && manualFrozenRaw > 0 ? Math.min(1000, Math.round(manualFrozenRaw)) : null,
        },
        autoTargetShardsPerNodeByTier: {
          hot: autoTargetHot,
          warm: autoTargetWarm,
          cold: autoTargetCold,
          frozen: autoTargetFrozen,
        },
        autoNodesCapByTier: {
          hot: capHot,
          warm: capWarm,
          cold: capCold,
          frozen: capFrozen,
        },
      },
      clusterPlan: {
        eps: Math.max(0, Number(clusterPlan?.eps) || defaultClusterPlan.eps),
        avgEventBytes: Math.max(1, Number(clusterPlan?.avgEventBytes) || defaultClusterPlan.avgEventBytes),
        availabilityProfile: clusterPlan?.availabilityProfile === 'lab'
          || clusterPlan?.availabilityProfile === 'critical'
          ? clusterPlan.availabilityProfile
          : 'standard',
        queryProfile: clusterPlan?.queryProfile === 'low'
          || clusterPlan?.queryProfile === 'high'
          ? clusterPlan.queryProfile
          : 'medium',
        retentionByTier: {
          hot: Math.max(0, Number(clusterPlan?.retentionByTier?.hot) || defaultClusterPlan.retentionByTier.hot),
          warm: Math.max(0, Number(clusterPlan?.retentionByTier?.warm) || defaultClusterPlan.retentionByTier.warm),
          cold: Math.max(0, Number(clusterPlan?.retentionByTier?.cold) || defaultClusterPlan.retentionByTier.cold),
          frozen: Math.max(0, Number(clusterPlan?.retentionByTier?.frozen) || defaultClusterPlan.retentionByTier.frozen),
        },
        shardTargetByTier: {
          hot: Math.max(1, Number(clusterPlan?.shardTargetByTier?.hot) || defaultClusterPlan.shardTargetByTier.hot),
          warm: Math.max(1, Number(clusterPlan?.shardTargetByTier?.warm) || defaultClusterPlan.shardTargetByTier.warm),
          cold: Math.max(1, Number(clusterPlan?.shardTargetByTier?.cold) || defaultClusterPlan.shardTargetByTier.cold),
          frozen: Math.max(1, Number(clusterPlan?.shardTargetByTier?.frozen) || defaultClusterPlan.shardTargetByTier.frozen),
        },
        replicasByTier: {
          hot: Math.max(0, Number(clusterPlan?.replicasByTier?.hot) || defaultClusterPlan.replicasByTier.hot),
          warm: Math.max(0, Number(clusterPlan?.replicasByTier?.warm) || defaultClusterPlan.replicasByTier.warm),
          cold: Math.max(0, Number(clusterPlan?.replicasByTier?.cold) || defaultClusterPlan.replicasByTier.cold),
          frozen: Math.max(0, Number(clusterPlan?.replicasByTier?.frozen) || defaultClusterPlan.replicasByTier.frozen),
        },
        computed: {
          tbByTier: {
            hot: Math.max(0, Number(clusterPlan?.computed?.tbByTier?.hot) || 0),
            warm: Math.max(0, Number(clusterPlan?.computed?.tbByTier?.warm) || 0),
            cold: Math.max(0, Number(clusterPlan?.computed?.tbByTier?.cold) || 0),
            frozen: Math.max(0, Number(clusterPlan?.computed?.tbByTier?.frozen) || 0),
          },
          shardsByTier: {
            hot: Math.max(0, Number(clusterPlan?.computed?.shardsByTier?.hot) || 0),
            warm: Math.max(0, Number(clusterPlan?.computed?.shardsByTier?.warm) || 0),
            cold: Math.max(0, Number(clusterPlan?.computed?.shardsByTier?.cold) || 0),
            frozen: Math.max(0, Number(clusterPlan?.computed?.shardsByTier?.frozen) || 0),
          },
          nodesByTier: {
            hot: Math.max(0, Number(clusterPlan?.computed?.nodesByTier?.hot) || 0),
            warm: Math.max(0, Number(clusterPlan?.computed?.nodesByTier?.warm) || 0),
            cold: Math.max(0, Number(clusterPlan?.computed?.nodesByTier?.cold) || 0),
            frozen: Math.max(0, Number(clusterPlan?.computed?.nodesByTier?.frozen) || 0),
          },
        },
      },
      archiveCompression: {
        includeInSizing: archiveCompression?.includeInSizing ?? true,
        eps: Math.max(0, Number(archiveCompression?.eps) || defaultArchiveCompression.eps),
        avgEventBytes: Math.max(1, Number(archiveCompression?.avgEventBytes) || defaultArchiveCompression.avgEventBytes),
        retentionHotDays: Math.max(0, Math.round(Number(archiveCompression?.retentionHotDays) || defaultArchiveCompression.retentionHotDays)),
        retentionArchivedDays: Math.max(
          0,
          Math.round(Number(archiveCompression?.retentionArchivedDays) || defaultArchiveCompression.retentionArchivedDays),
        ),
        compressionFactor: Math.max(0.001, Number(archiveCompression?.compressionFactor) || defaultArchiveCompression.compressionFactor),
        indexOverheadFactor: Math.max(0, Number(archiveCompression?.indexOverheadFactor) || defaultArchiveCompression.indexOverheadFactor),
        mode: archiveCompression?.mode === 'raw_to_archive' ? 'raw_to_archive' : 'indexed_to_archive',
        unitSystem: archiveCompression?.unitSystem === 'GiB2' ? 'GiB2' : 'GB10',
      },
      presetSources: {
        catalogVersion: presetSources?.catalogVersion || PRESET_CATALOG_VERSION,
        unitSystem: presetSources?.unitSystem === 'GiB2' ? 'GiB2' : 'GB10',
        advancedMode: Boolean(presetSources?.advancedMode),
        selectedItems: (presetSources?.selectedItems ?? []).map((item) => ({
          id: item.id || this.generateUiId('src'),
          presetId: item.presetId,
          quantity: Math.max(0, Math.round(Number(item.quantity) || 0)),
          unitType: item.unitType,
          overrides: {
            avgEventBytes: item.overrides?.avgEventBytes !== undefined
              ? Math.max(1, Number(item.overrides.avgEventBytes) || 1)
              : undefined,
            defaultEpsPerUnit: item.overrides?.defaultEpsPerUnit !== undefined
              ? Math.max(0, Number(item.overrides.defaultEpsPerUnit) || 0)
              : undefined,
          },
        })),
      },
      capacityCheck: {
        mode: machineSpecMode,
        compareAgainstWorkload: capacityCheck?.compareAgainstWorkload !== false,
        machineCpuCores: Math.max(1, Math.round(Number(capacityCheck?.machineCpuCores) || cpuCoresPerNode || defaultCapacityCheck.machineCpuCores)),
        machineRamGb: Math.max(2, Math.round(Number(capacityCheck?.machineRamGb) || ramGbPerNode || defaultCapacityCheck.machineRamGb)),
        machineDiskGbUsable: Math.max(
          10,
          Math.round(Number(capacityCheck?.machineDiskGbUsable) || machineDiskUsableFallback || defaultCapacityCheck.machineDiskGbUsable),
        ),
        headroomPct: Math.max(0, Math.min(300, Math.round(Number(capacityCheck?.headroomPct) || defaultCapacityCheck.headroomPct))),
        result: {
          status: capacityCheck?.result?.status ?? 'unknown',
          note: capacityCheck?.result?.note ?? '',
        },
      },
      deploymentPlan: {
        mode: deploymentMode,
        services: {
          kibanaCount: Math.max(0, Math.round(Number(deploymentPlan?.services?.kibanaCount) || dockerKibana || defaultDeploymentPlan.services.kibanaCount)),
          logstashCount: Math.max(0, Math.round(Number(deploymentPlan?.services?.logstashCount) || dockerLogstash || defaultDeploymentPlan.services.logstashCount)),
          apmCount: Math.max(0, Math.round(Number(deploymentPlan?.services?.apmCount) || dockerOther || defaultDeploymentPlan.services.apmCount)),
        },
        mapping: {
          esNodePerContainer: deploymentPlan?.mapping?.esNodePerContainer ?? defaultDeploymentPlan.mapping.esNodePerContainer,
        },
      },
    };
  }

  private deepClone<T>(value: T): T {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'siem';
  }

  private clusterIndexFromNodeName(nodeName: string): number {
    const match = /^c(\d+)-n\d+$/i.exec(nodeName);
    if (!match) {
      return 1;
    }
    return Math.max(1, Number(match[1]) || 1);
  }

  private nodeIndexFromName(nodeName: string): number {
    const clusterPattern = /^c\d+-n(\d+)$/i.exec(nodeName);
    if (clusterPattern) {
      return Math.max(1, Number(clusterPattern[1]) || 1);
    }
    const simplePattern = /^\w+-(\d+)$/i.exec(nodeName);
    if (simplePattern) {
      return Math.max(1, Number(simplePattern[1]) || 1);
    }
    return 0;
  }

  private generateUiId(prefix: string): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
  }
}
