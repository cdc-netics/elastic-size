import {
  ArchiveCompressionInput,
  AppMode,
  CapacityCheckInput,
  ClusterPlanInput,
  Constraints,
  DatasetInput,
  DeploymentPlanInput,
  NodeSizingInput,
  NodeProfiles,
  OverheadFactors,
  PresetSourcesInput,
  ScenarioInput,
  SizingConfig,
  TierName,
  TierRecord,
  WorkloadInput,
} from '../models/sizing.models';
import { PRESET_CATALOG_VERSION } from '../presets/catalog';

export const defaultOverhead: OverheadFactors = {
  indexOverheadFactor: 1.15,
  headroomFactor: 1.3,
  diskUsableFactor: 0.85,
};

export const defaultConstraints: Constraints = {
  minDataNodesPerTier: 3,
  requireDedicatedMastersWhenDataNodesGt: 5,
  dedicatedMasters: 3,
  maxShardsPerNodePerHeapGb: 20,
  recommendedShardSizeGbRange: [10, 50],
};

export const defaultNodeProfiles: NodeProfiles = {
  hot: { diskGb: 2000, heapGb: 32 },
  warm: { diskGb: 4000, heapGb: 32 },
  cold: { diskGb: 8000, heapGb: 16 },
  frozen: { diskGb: 12000, heapGb: 16 },
};

export const defaultNodeSizing: NodeSizingInput = {
  mode: 'manual',
  applySuggestedDefaultsWhenMissing: true,
  manualNodesByTier: {
    hot: 3,
    warm: null,
    cold: null,
    frozen: null,
  },
  autoTargetShardsPerNodeByTier: {
    hot: 120,
    warm: 140,
    cold: 170,
    frozen: 200,
  },
  autoNodesCapByTier: {
    hot: 300,
    warm: 200,
    cold: 100,
    frozen: 50,
  },
};

export const defaultClusterPlan: ClusterPlanInput = {
  eps: 1000,
  avgEventBytes: 1000,
  availabilityProfile: 'standard',
  queryProfile: 'medium',
  retentionByTier: { hot: 7, warm: 0, cold: 0, frozen: 0 },
  shardTargetByTier: { hot: 30, warm: 30, cold: 25, frozen: 20 },
  replicasByTier: { hot: 1, warm: 0, cold: 0, frozen: 0 },
  computed: {
    tbByTier: { hot: 0, warm: 0, cold: 0, frozen: 0 },
    shardsByTier: { hot: 0, warm: 0, cold: 0, frozen: 0 },
    nodesByTier: { hot: 0, warm: 0, cold: 0, frozen: 0 },
  },
};

export const defaultArchiveCompression: ArchiveCompressionInput = {
  includeInSizing: false,
  eps: 0,
  avgEventBytes: 800,
  retentionHotDays: 60,
  retentionArchivedDays: 305,
  compressionFactor: 0.12,
  indexOverheadFactor: 0.45,
  mode: 'indexed_to_archive',
  unitSystem: 'GB10',
};

export const defaultPresetSources: PresetSourcesInput = {
  catalogVersion: PRESET_CATALOG_VERSION,
  unitSystem: 'GB10',
  advancedMode: false,
  selectedItems: [],
};

export const defaultCapacityCheck: CapacityCheckInput = {
  mode: 'fit_machine',
  compareAgainstWorkload: true,
  machineCpuCores: 12,
  machineRamGb: 16,
  machineDiskGbUsable: 500,
  headroomPct: 30,
  result: {
    status: 'unknown',
    note: '',
  },
};

export const defaultDeploymentPlan: DeploymentPlanInput = {
  mode: 'docker',
  services: {
    kibanaCount: 1,
    logstashCount: 0,
    apmCount: 0,
  },
  mapping: {
    esNodePerContainer: true,
  },
};

export const datasetPresets: Array<Pick<DatasetInput, 'kind' | 'retentionDaysByTier' | 'replicasByTier' | 'targetShardSizeGbByTier' | 'rolloverDaysByTier'>> = [
  {
    kind: 'logs',
    retentionDaysByTier: { hot: 7, warm: 0, cold: 0, frozen: 0 },
    replicasByTier: { hot: 1, warm: 0, cold: 0, frozen: 0 },
    targetShardSizeGbByTier: { hot: 30, warm: 30, cold: 25, frozen: 20 },
    rolloverDaysByTier: { hot: 1, warm: 1, cold: 1, frozen: 1 },
  },
  {
    kind: 'endpoint',
    retentionDaysByTier: { hot: 7, warm: 0, cold: 0, frozen: 0 },
    replicasByTier: { hot: 1, warm: 0, cold: 0, frozen: 0 },
    targetShardSizeGbByTier: { hot: 30, warm: 30, cold: 25, frozen: 20 },
    rolloverDaysByTier: { hot: 1, warm: 1, cold: 1, frozen: 1 },
  },
  {
    kind: 'audit',
    retentionDaysByTier: { hot: 14, warm: 14, cold: 0, frozen: 0 },
    replicasByTier: { hot: 1, warm: 1, cold: 0, frozen: 0 },
    targetShardSizeGbByTier: { hot: 30, warm: 30, cold: 25, frozen: 20 },
    rolloverDaysByTier: { hot: 1, warm: 1, cold: 1, frozen: 1 },
  },
  {
    kind: 'netflow',
    retentionDaysByTier: { hot: 3, warm: 7, cold: 0, frozen: 0 },
    replicasByTier: { hot: 1, warm: 1, cold: 0, frozen: 0 },
    targetShardSizeGbByTier: { hot: 30, warm: 30, cold: 25, frozen: 20 },
    rolloverDaysByTier: { hot: 1, warm: 1, cold: 1, frozen: 1 },
  },
];

export function createTierRecord(value: number): TierRecord<number> {
  return {
    hot: value,
    warm: value,
    cold: value,
    frozen: value,
  };
}

function generateId(prefix: string): string {
  const uuid = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return `${prefix}-${uuid}`;
}

export function createDataset(kind = 'logs'): DatasetInput {
  const preset = datasetPresets.find((item) => item.kind === kind) ?? datasetPresets[0];

  return {
    id: generateId('ds'),
    name: `${kind.toUpperCase()} dataset`,
    kind,
    ingest: {
      mode: 'gb_per_hour',
      gbPerHour: 1,
      avgEventBytes: 900,
    },
    retentionDaysByTier: { ...preset.retentionDaysByTier },
    replicasByTier: { ...preset.replicasByTier },
    targetShardSizeGbByTier: { ...preset.targetShardSizeGbByTier },
    rolloverDaysByTier: { ...preset.rolloverDaysByTier },
  };
}

export function createWorkload(name = 'Nuevo workload'): WorkloadInput {
  return {
    id: generateId('wl'),
    name,
    datasets: [createDataset('logs')],
  };
}

export function createScenario(name: string, mode: AppMode = 'study'): ScenarioInput {
  return {
    id: generateId('scn'),
    name,
    mode,
    sizingApproach: 'normal',
    deployment: {
      clusterCount: 1,
      fixedDataNodesPerCluster: 3,
      clusterLoadMode: 'split',
    },
    machineProfile: {
      cpuCoresPerNode: 12,
      ramGbPerNode: 16,
      diskGbPerNode: 500,
      diskType: 'ssd',
      diskScope: 'total_cluster',
      dockerStack: {
        enabled: false,
        kibanaCount: 1,
        logstashCount: 0,
        otherServicesCount: 0,
      },
    },
    manualShardPlan: {
      enabled: false,
      primaryShardsPerCluster: 4,
      replicasPerPrimary: 1,
    },
    nodeSizing: {
      mode: defaultNodeSizing.mode,
      applySuggestedDefaultsWhenMissing: defaultNodeSizing.applySuggestedDefaultsWhenMissing,
      manualNodesByTier: { ...defaultNodeSizing.manualNodesByTier },
      autoTargetShardsPerNodeByTier: { ...defaultNodeSizing.autoTargetShardsPerNodeByTier },
      autoNodesCapByTier: { ...defaultNodeSizing.autoNodesCapByTier },
    },
    clusterPlan: {
      eps: defaultClusterPlan.eps,
      avgEventBytes: defaultClusterPlan.avgEventBytes,
      availabilityProfile: defaultClusterPlan.availabilityProfile,
      queryProfile: defaultClusterPlan.queryProfile,
      retentionByTier: { ...defaultClusterPlan.retentionByTier },
      shardTargetByTier: { ...defaultClusterPlan.shardTargetByTier },
      replicasByTier: { ...defaultClusterPlan.replicasByTier },
      computed: {
        tbByTier: { ...defaultClusterPlan.computed.tbByTier },
        shardsByTier: { ...defaultClusterPlan.computed.shardsByTier },
        nodesByTier: { ...defaultClusterPlan.computed.nodesByTier },
      },
    },
    archiveCompression: {
      includeInSizing: defaultArchiveCompression.includeInSizing,
      eps: defaultArchiveCompression.eps,
      avgEventBytes: defaultArchiveCompression.avgEventBytes,
      retentionHotDays: defaultArchiveCompression.retentionHotDays,
      retentionArchivedDays: defaultArchiveCompression.retentionArchivedDays,
      compressionFactor: defaultArchiveCompression.compressionFactor,
      indexOverheadFactor: defaultArchiveCompression.indexOverheadFactor,
      mode: defaultArchiveCompression.mode,
      unitSystem: defaultArchiveCompression.unitSystem,
    },
    presetSources: {
      catalogVersion: defaultPresetSources.catalogVersion,
      unitSystem: defaultPresetSources.unitSystem,
      advancedMode: defaultPresetSources.advancedMode,
      selectedItems: defaultPresetSources.selectedItems.map((item) => ({
        id: item.id,
        presetId: item.presetId,
        quantity: item.quantity,
        unitType: item.unitType,
        overrides: item.overrides ? { ...item.overrides } : undefined,
      })),
    },
    capacityCheck: {
      mode: defaultCapacityCheck.mode,
      compareAgainstWorkload: defaultCapacityCheck.compareAgainstWorkload,
      machineCpuCores: defaultCapacityCheck.machineCpuCores,
      machineRamGb: defaultCapacityCheck.machineRamGb,
      machineDiskGbUsable: defaultCapacityCheck.machineDiskGbUsable,
      headroomPct: defaultCapacityCheck.headroomPct,
      result: { ...defaultCapacityCheck.result },
    },
    deploymentPlan: {
      mode: defaultDeploymentPlan.mode,
      services: { ...defaultDeploymentPlan.services },
      mapping: { ...defaultDeploymentPlan.mapping },
    },
    workloads: [createWorkload('Cliente A')],
    overhead: { ...defaultOverhead },
    constraints: {
      ...defaultConstraints,
      recommendedShardSizeGbRange: [...defaultConstraints.recommendedShardSizeGbRange] as [number, number],
    },
    nodeProfiles: {
      hot: { ...defaultNodeProfiles.hot },
      warm: { ...defaultNodeProfiles.warm },
      cold: { ...defaultNodeProfiles.cold },
      frozen: { ...defaultNodeProfiles.frozen },
    },
  };
}

export const sampleConfig: SizingConfig = {
  project: {
    name: 'elastic-sizing-next',
    purpose: 'Capacity planning Elasticsearch/OpenSearch 2026 con ILM tiers, escenarios y export/import JSON',
    language: 'es',
  },
  scenarios: [
    {
      ...createScenario('Cluster A - Examen 1000 EPS', 'study'),
      sizingApproach: 'machine_requirements',
      deployment: {
        clusterCount: 1,
        fixedDataNodesPerCluster: 3,
        clusterLoadMode: 'split',
      },
      machineProfile: {
        cpuCoresPerNode: 12,
        ramGbPerNode: 16,
        diskGbPerNode: 500,
        diskType: 'ssd',
        diskScope: 'total_cluster',
        dockerStack: {
          enabled: true,
          kibanaCount: 1,
          logstashCount: 1,
          otherServicesCount: 0,
        },
      },
      manualShardPlan: {
        enabled: true,
        primaryShardsPerCluster: 4,
        replicasPerPrimary: 1,
      },
      nodeProfiles: {
        hot: { diskGb: 3000, heapGb: 32 },
        warm: { ...defaultNodeProfiles.warm },
        cold: { ...defaultNodeProfiles.cold },
        frozen: { ...defaultNodeProfiles.frozen },
      },
      workloads: [
        {
          id: generateId('wl'),
          name: 'Exam Workload A',
          datasets: [
            {
              ...createDataset('logs'),
              name: 'Logs 1000 EPS',
              ingest: {
                mode: 'eps_plus_avg_event_bytes',
                eps: 1000,
                avgEventBytes: 1000,
              },
              retentionDaysByTier: { hot: 7, warm: 0, cold: 0, frozen: 0 },
              replicasByTier: { hot: 1, warm: 0, cold: 0, frozen: 0 },
              targetShardSizeGbByTier: { hot: 20, warm: 30, cold: 40, frozen: 50 },
              rolloverDaysByTier: { hot: 1, warm: 1, cold: 5, frozen: 10 },
            },
          ],
        },
      ],
    },
    {
      ...createScenario('Cluster B - Examen 3000 EPS', 'study'),
      sizingApproach: 'machine_requirements',
      deployment: {
        clusterCount: 1,
        fixedDataNodesPerCluster: 3,
        clusterLoadMode: 'split',
      },
      machineProfile: {
        cpuCoresPerNode: 12,
        ramGbPerNode: 16,
        diskGbPerNode: 500,
        diskType: 'ssd',
        diskScope: 'total_cluster',
        dockerStack: {
          enabled: true,
          kibanaCount: 1,
          logstashCount: 1,
          otherServicesCount: 0,
        },
      },
      manualShardPlan: {
        enabled: true,
        primaryShardsPerCluster: 6,
        replicasPerPrimary: 1,
      },
      nodeProfiles: {
        hot: { diskGb: 3000, heapGb: 32 },
        warm: { ...defaultNodeProfiles.warm },
        cold: { ...defaultNodeProfiles.cold },
        frozen: { ...defaultNodeProfiles.frozen },
      },
      workloads: [
        {
          id: generateId('wl'),
          name: 'Exam Workload B',
          datasets: [
            {
              ...createDataset('logs'),
              name: 'Logs 3000 EPS',
              ingest: {
                mode: 'eps_plus_avg_event_bytes',
                eps: 3000,
                avgEventBytes: 1000,
              },
              retentionDaysByTier: { hot: 7, warm: 0, cold: 0, frozen: 0 },
              replicasByTier: { hot: 1, warm: 0, cold: 0, frozen: 0 },
              targetShardSizeGbByTier: { hot: 20, warm: 30, cold: 40, frozen: 50 },
              rolloverDaysByTier: { hot: 1, warm: 1, cold: 5, frozen: 10 },
            },
          ],
        },
      ],
    },
  ],
};

export function cloneScenario(source: ScenarioInput, name: string): ScenarioInput {
  return {
    ...source,
    id: generateId('scn'),
    name,
    workloads: source.workloads.map((workload) => ({
      ...workload,
      id: generateId('wl'),
      datasets: workload.datasets.map((dataset) => ({
        ...dataset,
        id: generateId('ds'),
        ingest: { ...dataset.ingest },
        retentionDaysByTier: { ...dataset.retentionDaysByTier },
        replicasByTier: { ...dataset.replicasByTier },
        targetShardSizeGbByTier: { ...dataset.targetShardSizeGbByTier },
        rolloverDaysByTier: { ...dataset.rolloverDaysByTier },
      })),
    })),
    overhead: { ...source.overhead },
    constraints: {
      ...source.constraints,
      recommendedShardSizeGbRange: [...source.constraints.recommendedShardSizeGbRange] as [number, number],
    },
    deployment: {
      clusterCount: source.deployment.clusterCount,
      fixedDataNodesPerCluster: source.deployment.fixedDataNodesPerCluster,
      clusterLoadMode: source.deployment.clusterLoadMode,
    },
    sizingApproach: source.sizingApproach,
    machineProfile: {
      cpuCoresPerNode: source.machineProfile.cpuCoresPerNode,
      ramGbPerNode: source.machineProfile.ramGbPerNode,
      diskGbPerNode: source.machineProfile.diskGbPerNode,
      diskType: source.machineProfile.diskType,
      diskScope: source.machineProfile.diskScope,
      dockerStack: {
        enabled: Boolean(source.machineProfile.dockerStack?.enabled),
        kibanaCount: Math.max(0, Math.round(Number(source.machineProfile.dockerStack?.kibanaCount) || 0)),
        logstashCount: Math.max(0, Math.round(Number(source.machineProfile.dockerStack?.logstashCount) || 0)),
        otherServicesCount: Math.max(0, Math.round(Number(source.machineProfile.dockerStack?.otherServicesCount) || 0)),
      },
    },
    manualShardPlan: {
      enabled: source.manualShardPlan.enabled,
      primaryShardsPerCluster: source.manualShardPlan.primaryShardsPerCluster,
      replicasPerPrimary: source.manualShardPlan.replicasPerPrimary,
    },
    nodeSizing: {
      mode: source.nodeSizing?.mode === 'auto' ? 'auto' : 'manual',
      applySuggestedDefaultsWhenMissing: source.nodeSizing?.applySuggestedDefaultsWhenMissing !== false,
      manualNodesByTier: {
        hot: source.nodeSizing?.manualNodesByTier?.hot ?? null,
        warm: source.nodeSizing?.manualNodesByTier?.warm ?? null,
        cold: source.nodeSizing?.manualNodesByTier?.cold ?? null,
        frozen: source.nodeSizing?.manualNodesByTier?.frozen ?? null,
      },
      autoTargetShardsPerNodeByTier: {
        hot: source.nodeSizing?.autoTargetShardsPerNodeByTier?.hot ?? defaultNodeSizing.autoTargetShardsPerNodeByTier.hot,
        warm: source.nodeSizing?.autoTargetShardsPerNodeByTier?.warm ?? defaultNodeSizing.autoTargetShardsPerNodeByTier.warm,
        cold: source.nodeSizing?.autoTargetShardsPerNodeByTier?.cold ?? defaultNodeSizing.autoTargetShardsPerNodeByTier.cold,
        frozen: source.nodeSizing?.autoTargetShardsPerNodeByTier?.frozen ?? defaultNodeSizing.autoTargetShardsPerNodeByTier.frozen,
      },
      autoNodesCapByTier: {
        hot: source.nodeSizing?.autoNodesCapByTier?.hot ?? defaultNodeSizing.autoNodesCapByTier.hot,
        warm: source.nodeSizing?.autoNodesCapByTier?.warm ?? defaultNodeSizing.autoNodesCapByTier.warm,
        cold: source.nodeSizing?.autoNodesCapByTier?.cold ?? defaultNodeSizing.autoNodesCapByTier.cold,
        frozen: source.nodeSizing?.autoNodesCapByTier?.frozen ?? defaultNodeSizing.autoNodesCapByTier.frozen,
      },
    },
    clusterPlan: {
      eps: source.clusterPlan?.eps ?? defaultClusterPlan.eps,
      avgEventBytes: source.clusterPlan?.avgEventBytes ?? defaultClusterPlan.avgEventBytes,
      availabilityProfile: source.clusterPlan?.availabilityProfile ?? defaultClusterPlan.availabilityProfile,
      queryProfile: source.clusterPlan?.queryProfile ?? defaultClusterPlan.queryProfile,
      retentionByTier: {
        hot: source.clusterPlan?.retentionByTier?.hot ?? defaultClusterPlan.retentionByTier.hot,
        warm: source.clusterPlan?.retentionByTier?.warm ?? defaultClusterPlan.retentionByTier.warm,
        cold: source.clusterPlan?.retentionByTier?.cold ?? defaultClusterPlan.retentionByTier.cold,
        frozen: source.clusterPlan?.retentionByTier?.frozen ?? defaultClusterPlan.retentionByTier.frozen,
      },
      shardTargetByTier: {
        hot: source.clusterPlan?.shardTargetByTier?.hot ?? defaultClusterPlan.shardTargetByTier.hot,
        warm: source.clusterPlan?.shardTargetByTier?.warm ?? defaultClusterPlan.shardTargetByTier.warm,
        cold: source.clusterPlan?.shardTargetByTier?.cold ?? defaultClusterPlan.shardTargetByTier.cold,
        frozen: source.clusterPlan?.shardTargetByTier?.frozen ?? defaultClusterPlan.shardTargetByTier.frozen,
      },
      replicasByTier: {
        hot: source.clusterPlan?.replicasByTier?.hot ?? defaultClusterPlan.replicasByTier.hot,
        warm: source.clusterPlan?.replicasByTier?.warm ?? defaultClusterPlan.replicasByTier.warm,
        cold: source.clusterPlan?.replicasByTier?.cold ?? defaultClusterPlan.replicasByTier.cold,
        frozen: source.clusterPlan?.replicasByTier?.frozen ?? defaultClusterPlan.replicasByTier.frozen,
      },
      computed: {
        tbByTier: {
          hot: source.clusterPlan?.computed?.tbByTier?.hot ?? defaultClusterPlan.computed.tbByTier.hot,
          warm: source.clusterPlan?.computed?.tbByTier?.warm ?? defaultClusterPlan.computed.tbByTier.warm,
          cold: source.clusterPlan?.computed?.tbByTier?.cold ?? defaultClusterPlan.computed.tbByTier.cold,
          frozen: source.clusterPlan?.computed?.tbByTier?.frozen ?? defaultClusterPlan.computed.tbByTier.frozen,
        },
        shardsByTier: {
          hot: source.clusterPlan?.computed?.shardsByTier?.hot ?? defaultClusterPlan.computed.shardsByTier.hot,
          warm: source.clusterPlan?.computed?.shardsByTier?.warm ?? defaultClusterPlan.computed.shardsByTier.warm,
          cold: source.clusterPlan?.computed?.shardsByTier?.cold ?? defaultClusterPlan.computed.shardsByTier.cold,
          frozen: source.clusterPlan?.computed?.shardsByTier?.frozen ?? defaultClusterPlan.computed.shardsByTier.frozen,
        },
        nodesByTier: {
          hot: source.clusterPlan?.computed?.nodesByTier?.hot ?? defaultClusterPlan.computed.nodesByTier.hot,
          warm: source.clusterPlan?.computed?.nodesByTier?.warm ?? defaultClusterPlan.computed.nodesByTier.warm,
          cold: source.clusterPlan?.computed?.nodesByTier?.cold ?? defaultClusterPlan.computed.nodesByTier.cold,
          frozen: source.clusterPlan?.computed?.nodesByTier?.frozen ?? defaultClusterPlan.computed.nodesByTier.frozen,
        },
      },
    },
    archiveCompression: {
      includeInSizing: source.archiveCompression?.includeInSizing ?? defaultArchiveCompression.includeInSizing,
      eps: source.archiveCompression?.eps ?? defaultArchiveCompression.eps,
      avgEventBytes: source.archiveCompression?.avgEventBytes ?? defaultArchiveCompression.avgEventBytes,
      retentionHotDays: source.archiveCompression?.retentionHotDays ?? defaultArchiveCompression.retentionHotDays,
      retentionArchivedDays: source.archiveCompression?.retentionArchivedDays ?? defaultArchiveCompression.retentionArchivedDays,
      compressionFactor: source.archiveCompression?.compressionFactor ?? defaultArchiveCompression.compressionFactor,
      indexOverheadFactor: source.archiveCompression?.indexOverheadFactor ?? defaultArchiveCompression.indexOverheadFactor,
      mode: source.archiveCompression?.mode ?? defaultArchiveCompression.mode,
      unitSystem: source.archiveCompression?.unitSystem ?? defaultArchiveCompression.unitSystem,
    },
    presetSources: {
      catalogVersion: source.presetSources?.catalogVersion ?? defaultPresetSources.catalogVersion,
      unitSystem: source.presetSources?.unitSystem ?? defaultPresetSources.unitSystem,
      advancedMode: source.presetSources?.advancedMode ?? defaultPresetSources.advancedMode,
      selectedItems: (source.presetSources?.selectedItems ?? []).map((item) => ({
        id: item.id,
        presetId: item.presetId,
        quantity: item.quantity,
        unitType: item.unitType,
        overrides: item.overrides ? { ...item.overrides } : undefined,
      })),
    },
    capacityCheck: {
      mode: source.capacityCheck?.mode ?? defaultCapacityCheck.mode,
      compareAgainstWorkload: source.capacityCheck?.compareAgainstWorkload ?? defaultCapacityCheck.compareAgainstWorkload,
      machineCpuCores: source.capacityCheck?.machineCpuCores ?? defaultCapacityCheck.machineCpuCores,
      machineRamGb: source.capacityCheck?.machineRamGb ?? defaultCapacityCheck.machineRamGb,
      machineDiskGbUsable: source.capacityCheck?.machineDiskGbUsable ?? defaultCapacityCheck.machineDiskGbUsable,
      headroomPct: source.capacityCheck?.headroomPct ?? defaultCapacityCheck.headroomPct,
      result: {
        status: source.capacityCheck?.result?.status ?? defaultCapacityCheck.result.status,
        note: source.capacityCheck?.result?.note ?? defaultCapacityCheck.result.note,
      },
    },
    deploymentPlan: {
      mode: source.deploymentPlan?.mode ?? defaultDeploymentPlan.mode,
      services: {
        kibanaCount: source.deploymentPlan?.services?.kibanaCount ?? defaultDeploymentPlan.services.kibanaCount,
        logstashCount: source.deploymentPlan?.services?.logstashCount ?? defaultDeploymentPlan.services.logstashCount,
        apmCount: source.deploymentPlan?.services?.apmCount ?? defaultDeploymentPlan.services.apmCount,
      },
      mapping: {
        esNodePerContainer: source.deploymentPlan?.mapping?.esNodePerContainer ?? defaultDeploymentPlan.mapping.esNodePerContainer,
      },
    },
    nodeProfiles: {
      hot: { ...source.nodeProfiles.hot },
      warm: { ...source.nodeProfiles.warm },
      cold: { ...source.nodeProfiles.cold },
      frozen: { ...source.nodeProfiles.frozen },
    },
  };
}

export function buildTierPreset(kind: string): Pick<DatasetInput, 'kind' | 'retentionDaysByTier' | 'replicasByTier' | 'targetShardSizeGbByTier' | 'rolloverDaysByTier'> {
  return datasetPresets.find((preset) => preset.kind === kind) ?? datasetPresets[0];
}

export function updateDatasetByPreset(dataset: DatasetInput, kind: string): DatasetInput {
  const preset = buildTierPreset(kind);
  return {
    ...dataset,
    kind,
    retentionDaysByTier: { ...preset.retentionDaysByTier },
    replicasByTier: { ...preset.replicasByTier },
    targetShardSizeGbByTier: { ...preset.targetShardSizeGbByTier },
    rolloverDaysByTier: { ...preset.rolloverDaysByTier },
  };
}

export function tierLabel(tier: TierName): string {
  if (tier === 'hot') {
    return 'Hot';
  }
  if (tier === 'warm') {
    return 'Warm';
  }
  if (tier === 'cold') {
    return 'Cold';
  }
  return 'Frozen';
}
