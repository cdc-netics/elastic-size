import { normalizeInputs } from './conversions';
import { calculateStorageByTier } from './storage';
import { calculatePrimaryShardsByTier, calculateShardsWithManualPlan, calculateTotalShardsByTier } from './shards';
import { summarizeTier } from './nodes';
import { generateWarnings } from './warnings';
import { optional_assignShardsToNodes } from './planner';
import { computeArchiveSizing } from './archive-compression';
import { solve_forward } from './cluster_sizer';
import {
  NormalizedDatasetMetrics,
  ScenarioInput,
  SizingWarning,
  SizingResult,
  TierDatasetStorage,
  TierDatasetShard,
  TierName,
  WorkloadResult,
} from '../models/sizing.models';

const ARCHIVE_WORKLOAD_ID = 'wl-archive-compression';
const ARCHIVE_WORKLOAD_NAME = 'Archivado/Compresión';
const ARCHIVE_ONLINE_DATASET_ID = 'ds-archive-online-hot';
const ARCHIVE_ONLINE_DATASET_NAME = 'Online indexado (hot)';
const ARCHIVE_ARCHIVE_DATASET_ID = 'ds-archive-frozen';
const ARCHIVE_ARCHIVE_DATASET_NAME = 'Archivado comprimido (frozen)';

export function calculate(scenario: ScenarioInput): SizingResult {
  const normalizationWarnings: SizingWarning[] = [];
  const storageRows: TierDatasetStorage[] = [];
  let totalEps = 0;

  for (const workload of scenario.workloads) {
    for (const dataset of workload.datasets) {
      const normalized = normalizeInputs(dataset);
      normalizationWarnings.push(...normalized.warnings.map((warning) => ({ ...warning, workloadId: workload.id })));
      totalEps += normalized.metrics.eps;
      storageRows.push(...calculateStorageByTier(scenario, workload, dataset, normalized.metrics));
    }
  }

  const archiveAugmentation = buildArchiveCompressionRows(scenario);
  storageRows.push(...archiveAugmentation.rows);
  normalizationWarnings.push(...archiveAugmentation.warnings);
  totalEps += archiveAugmentation.totalEps;

  const shardRows = scenario.manualShardPlan.enabled
    ? calculateShardsWithManualPlan(storageRows, {
      primaryShardsPerCluster: scenario.manualShardPlan.primaryShardsPerCluster,
      replicasPerPrimary: scenario.manualShardPlan.replicasPerPrimary,
      clusterCount: scenario.deployment.clusterCount,
    })
    : calculateTotalShardsByTier(calculatePrimaryShardsByTier(storageRows));

  const tierSummaryBase = summarizeTier(shardRows);
  const avgPrimaryShardByTier = averagePrimaryShardByTier(shardRows);
  const forward = solve_forward({
    mode: scenario.nodeSizing.mode === 'auto' ? 'advanced' : 'simple',
    availability: scenario.clusterPlan.availabilityProfile ?? 'standard',
    queryProfile: scenario.clusterPlan.queryProfile ?? 'medium',
    demand: tierSummaryBase.map((tier) => ({
      tier: tier.tier,
      totalStorageGb: tier.totalStorageGb,
      primaryShards: tier.primaryShards,
      totalShards: tier.totalShards,
      avgPrimaryShardSizeGb: avgPrimaryShardByTier.get(tier.tier) ?? 0,
    })),
    workload: {
      totalEps,
      avgEventBytes: weightedAvgEventBytes(shardRows),
    },
    diskUsableFactor: scenario.overhead.diskUsableFactor,
    maxShardsPerNodePerHeapGb: scenario.constraints.maxShardsPerNodePerHeapGb,
    shardSizeRangeGb: scenario.constraints.recommendedShardSizeGbRange,
    minDataNodesPerTier: scenario.constraints.minDataNodesPerTier,
    tierProfiles: {
      hot: {
        diskGb: scenario.nodeProfiles.hot.diskGb,
        heapGb: scenario.nodeProfiles.hot.heapGb,
        manualNodes: scenario.nodeSizing.manualNodesByTier.hot,
        targetShardsPerNode: scenario.nodeSizing.autoTargetShardsPerNodeByTier.hot,
        autoNodesCap: scenario.nodeSizing.autoNodesCapByTier.hot,
      },
      warm: {
        diskGb: scenario.nodeProfiles.warm.diskGb,
        heapGb: scenario.nodeProfiles.warm.heapGb,
        manualNodes: scenario.nodeSizing.manualNodesByTier.warm,
        targetShardsPerNode: scenario.nodeSizing.autoTargetShardsPerNodeByTier.warm,
        autoNodesCap: scenario.nodeSizing.autoNodesCapByTier.warm,
      },
      cold: {
        diskGb: scenario.nodeProfiles.cold.diskGb,
        heapGb: scenario.nodeProfiles.cold.heapGb,
        manualNodes: scenario.nodeSizing.manualNodesByTier.cold,
        targetShardsPerNode: scenario.nodeSizing.autoTargetShardsPerNodeByTier.cold,
        autoNodesCap: scenario.nodeSizing.autoNodesCapByTier.cold,
      },
      frozen: {
        diskGb: scenario.nodeProfiles.frozen.diskGb,
        heapGb: scenario.nodeProfiles.frozen.heapGb,
        manualNodes: scenario.nodeSizing.manualNodesByTier.frozen,
        targetShardsPerNode: scenario.nodeSizing.autoTargetShardsPerNodeByTier.frozen,
        autoNodesCap: scenario.nodeSizing.autoNodesCapByTier.frozen,
      },
    },
    applySuggestedDefaultsWhenMissing: scenario.nodeSizing.applySuggestedDefaultsWhenMissing,
    nodeSizingMode: scenario.nodeSizing.mode,
  });
  const byTier = new Map(forward.tiers.map((tier) => [tier.tier, tier]));
  const tierResults = tierSummaryBase.map((tier) => {
    const solved = byTier.get(tier.tier);
    return {
      ...tier,
      nodesByStorage: solved?.nodesByStorage ?? tier.nodesByStorage,
      nodesByShardsHeap: solved?.nodesByShards ?? tier.nodesByShardsHeap,
      nodesRecommended: solved?.nodesRecommended ?? tier.nodesRecommended,
    };
  });

  const workloadNameById = new Map<string, string>();
  for (const workload of scenario.workloads) {
    workloadNameById.set(workload.id, workload.name);
  }
  for (const row of shardRows) {
    if (!workloadNameById.has(row.workloadId)) {
      workloadNameById.set(row.workloadId, row.workloadName);
    }
  }

  const workloads: WorkloadResult[] = Array.from(workloadNameById.entries()).map(([workloadId, workloadName]) => {
    const workloadRows = shardRows.filter((row) => row.workloadId === workloadId);
    return {
      workloadId,
      workloadName,
      totalStorageGb: workloadRows.reduce((sum, row) => sum + row.totalStorageGb, 0),
      totalShards: workloadRows.reduce((sum, row) => sum + row.totalShards, 0),
      datasets: workloadRows,
    };
  });

  const dataNodes = forward.dataNodes;
  const dedicatedMasters = forward.dedicatedMasters;

  const engineWarnings = generateWarnings(
    scenario.mode,
    shardRows,
    tierResults,
    scenario.nodeProfiles,
    scenario.constraints,
    dedicatedMasters,
  );

  const manualShardWarning: SizingWarning[] = scenario.manualShardPlan.enabled
    ? [{
      level: 'info',
      code: 'MANUAL_SHARD_PLAN_ACTIVE',
      message: `Shards manuales activos: ${scenario.manualShardPlan.primaryShardsPerCluster} primarios por cluster x `
        + `${Math.max(1, Math.round(Number(scenario.deployment.clusterCount) || 1))} cluster(s), `
        + `${scenario.manualShardPlan.replicasPerPrimary} replicas por primario.`,
    }]
    : [];

  const clusterWarnings: SizingWarning[] = forward.warnings.map((rawMessage, index) => {
    let code = `CLUSTER_SIZER_${index + 1}`;
    let message = rawMessage;
    if (rawMessage.startsWith('NODE_COUNT_CAPPED:')) {
      code = 'NODE_COUNT_CAPPED';
      message = rawMessage.replace('NODE_COUNT_CAPPED:', '').trim();
    } else if (rawMessage.startsWith('NODE_LOGIC_ABORTED:')) {
      code = 'NODE_LOGIC_ABORTED';
      message = rawMessage.replace('NODE_LOGIC_ABORTED:', '').trim();
    }
    return {
      level: code === 'NODE_LOGIC_ABORTED' ? 'error' : 'warning',
      code,
      message,
    };
  });
  const warnings = [...normalizationWarnings, ...clusterWarnings, ...engineWarnings, ...manualShardWarning];
  const nodePlan = optional_assignShardsToNodes(shardRows, tierResults);

  const totalStorageGb = shardRows.reduce((sum, row) => sum + row.totalStorageGb, 0);
  const totalShards = shardRows.reduce((sum, row) => sum + row.totalShards, 0);

  return {
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    mode: scenario.mode,
    totals: {
      totalStorageGb,
      totalShards,
      totalEps,
      dataNodes,
      dedicatedMasters,
    },
    workloads,
    tiers: tierResults,
    warnings,
    nodePlan,
  };
}

function averagePrimaryShardByTier(rows: TierDatasetShard[]): Map<TierName, number> {
  const accum = new Map<TierName, { primaryStorage: number; primaryShards: number }>();
  for (const row of rows) {
    const current = accum.get(row.tier) ?? { primaryStorage: 0, primaryShards: 0 };
    current.primaryStorage += row.primaryStorageGb;
    current.primaryShards += row.primaryShards;
    accum.set(row.tier, current);
  }

  const avg = new Map<TierName, number>();
  for (const [tier, values] of accum.entries()) {
    avg.set(tier, values.primaryShards > 0 ? values.primaryStorage / values.primaryShards : 0);
  }
  return avg;
}

function weightedAvgEventBytes(rows: TierDatasetShard[]): number {
  let totalEps = 0;
  let totalWeightedBytes = 0;
  for (const row of rows) {
    totalEps += row.normalized.eps;
    totalWeightedBytes += row.normalized.eps * row.normalized.avgEventBytesUsed;
  }
  if (totalEps <= 0) {
    return 1000;
  }
  return Math.max(1, totalWeightedBytes / totalEps);
}

export function calculateAll(scenarios: ScenarioInput[]): SizingResult[] {
  return scenarios.map((scenario) => calculate(scenario));
}

export function datasetRowsForTier(rows: TierDatasetShard[], tier: string): TierDatasetShard[] {
  return rows.filter((row) => row.tier === tier);
}

function buildArchiveCompressionRows(
  scenario: ScenarioInput,
): { rows: TierDatasetStorage[]; warnings: SizingWarning[]; totalEps: number } {
  const config = scenario.archiveCompression;
  if (!config.includeInSizing) {
    return { rows: [], warnings: [], totalEps: 0 };
  }

  const report = computeArchiveSizing(config);
  const warnings: SizingWarning[] = report.warnings.map((message, index) => ({
    level: 'warning',
    code: `ARCHIVE_INPUT_ADJUSTED_${index + 1}`,
    message,
  }));

  const unitToGb10Factor = report.inputs.unit_system === 'GiB2'
    ? (1024 ** 3) / 1_000_000_000
    : 1;

  const indexedGbPerDay = report.rates.indexed_gb_per_day * unitToGb10Factor;
  const archiveGbPerDay = report.rates.archive_gb_per_day * unitToGb10Factor;
  const onlineTotalGb = report.totals.online_total_gb * unitToGb10Factor;
  const archiveTotalGb = report.totals.archive_total_gb * unitToGb10Factor;
  const rawGbPerHour = report.rates.raw_gb_per_hour * unitToGb10Factor;
  const rawGbPerDay = report.rates.raw_gb_per_day * unitToGb10Factor;
  const bytesPerSec = report.inputs.eps * report.inputs.avgEventBytes;

  const normalizedBase: NormalizedDatasetMetrics = {
    gbPerHour: rawGbPerHour,
    gbPerDay: rawGbPerDay,
    bytesPerSec,
    eps: report.inputs.eps,
    avgEventBytesUsed: report.inputs.avgEventBytes,
  };

  const hotRetention = Math.max(0, report.inputs.retention_hot_days);
  const archivedRetention = Math.max(0, report.inputs.retention_archived_days);

  const rows: TierDatasetStorage[] = [];

  if (hotRetention > 0 && indexedGbPerDay > 0) {
    rows.push({
      scenarioId: scenario.id,
      workloadId: ARCHIVE_WORKLOAD_ID,
      workloadName: ARCHIVE_WORKLOAD_NAME,
      datasetId: ARCHIVE_ONLINE_DATASET_ID,
      datasetName: ARCHIVE_ONLINE_DATASET_NAME,
      tier: 'hot',
      dailyGb: indexedGbPerDay,
      retentionDays: hotRetention,
      replicas: 0,
      targetShardSizeGb: Math.max(1, scenario.clusterPlan.shardTargetByTier.hot),
      rolloverDays: 1,
      primaryStorageGb: onlineTotalGb,
      totalStorageGb: onlineTotalGb,
      normalized: normalizedBase,
    });
  }

  if (archivedRetention > 0 && archiveGbPerDay > 0) {
    rows.push({
      scenarioId: scenario.id,
      workloadId: ARCHIVE_WORKLOAD_ID,
      workloadName: ARCHIVE_WORKLOAD_NAME,
      datasetId: ARCHIVE_ARCHIVE_DATASET_ID,
      datasetName: ARCHIVE_ARCHIVE_DATASET_NAME,
      tier: 'frozen',
      dailyGb: archiveGbPerDay,
      retentionDays: archivedRetention,
      replicas: 0,
      targetShardSizeGb: Math.max(1, scenario.clusterPlan.shardTargetByTier.frozen),
      rolloverDays: 1,
      primaryStorageGb: archiveTotalGb,
      totalStorageGb: archiveTotalGb,
      normalized: normalizedBase,
    });
  }

  if (rows.length === 0) {
    warnings.push({
      level: 'info',
      code: 'ARCHIVE_NO_EFFECT',
      message: 'Archivado/Compresión habilitado pero sin volumen efectivo (revisa EPS o retención).',
    });
  }

  return {
    rows,
    warnings,
    totalEps: report.inputs.eps,
  };
}
