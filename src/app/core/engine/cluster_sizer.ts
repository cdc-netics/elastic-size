import {
  AvailabilityProfile,
  ClusterSizerInput,
  ClusterSizerOutput,
  QueryProfile,
  TierSolveResult,
} from '../../domain/sizing.types';
import { TIERS, TierName } from '../models/sizing.models';

const QUERY_EPS_PER_CORE: Record<QueryProfile, number> = {
  low: 1200,
  medium: 900,
  high: 600,
};

const QUERY_RAM_MULTIPLIER: Record<QueryProfile, number> = {
  low: 0.9,
  medium: 1,
  high: 1.2,
};

const AVAILABILITY_CPU_MULTIPLIER: Record<AvailabilityProfile, number> = {
  lab: 0.9,
  standard: 1,
  critical: 1.2,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hasTierDemand(tier: TierSolveResult): boolean {
  return tier.totalStorageGb > 0 || tier.totalShards > 0;
}

function suggestedManualNodesByTier(hotNodes: number, tier: TierName): number {
  if (tier === 'hot') {
    return hotNodes;
  }
  if (tier === 'warm') {
    return Math.min(12, Math.max(2, Math.ceil(hotNodes * 0.33)));
  }
  if (tier === 'cold') {
    return Math.min(8, Math.max(2, Math.ceil(hotNodes * 0.2)));
  }
  return Math.min(6, Math.max(1, Math.ceil(hotNodes * 0.1)));
}

function dedicatedMastersForAvailability(availability: AvailabilityProfile, dataNodes: number): number {
  if (availability === 'lab') {
    return 0;
  }
  if (availability === 'critical') {
    return dataNodes > 0 ? 3 : 0;
  }
  return dataNodes >= 6 ? 3 : 0;
}

function frozenCacheRatio(profile: QueryProfile): number {
  if (profile === 'high') {
    return 0.1;
  }
  if (profile === 'medium') {
    return 0.05;
  }
  return 0.02;
}

function computeTierRows(input: ClusterSizerInput): { rows: TierSolveResult[]; warnings: string[] } {
  const safeDiskUsableFactor = Math.max(0.05, input.diskUsableFactor);
  const warnings: string[] = [];
  const demandByTier = new Map(input.demand.map((tier) => [tier.tier, tier]));

  const hotManualRaw = input.tierProfiles.hot.manualNodes;
  const hotManual = hotManualRaw && hotManualRaw > 0 ? Math.round(hotManualRaw) : 3;
  const minNodesPerTier = input.availability === 'lab' ? 1 : Math.max(1, input.minDataNodesPerTier);

  const rows = TIERS.map((tier) => {
    const row = demandByTier.get(tier);
    const profile = input.tierProfiles[tier];
    const totalStorageGb = row?.totalStorageGb ?? 0;
    const totalShards = row?.totalShards ?? 0;
    const primaryShards = row?.primaryShards ?? 0;
    const avgPrimaryShardSizeGb = row?.avgPrimaryShardSizeGb ?? 0;

    const capacityPerNodeGb = Math.max(1, profile.diskGb * safeDiskUsableFactor);
    const nodesByStorage = totalStorageGb > 0 ? Math.ceil(totalStorageGb / capacityPerNodeGb) : 0;
    const shardLimitPerNode = Math.max(1, profile.heapGb * Math.max(1, input.maxShardsPerNodePerHeapGb));
    const nodesByShards = totalShards > 0 ? Math.ceil(totalShards / shardLimitPerNode) : 0;

    let nodesRecommended = 0;
    const tierHasDemand = totalStorageGb > 0 || totalShards > 0;

    if (tier === 'frozen' && input.mode === 'simple') {
      const manualNodes = profile.manualNodes && profile.manualNodes > 0 ? Math.round(profile.manualNodes) : 0;
      nodesRecommended = manualNodes;
      if (tierHasDemand && manualNodes <= 0) {
        warnings.push('Frozen en modo simple no se autoescala por shards; define nodos frozen manuales si necesitas compute local.');
      }
    } else if (input.nodeSizingMode === 'manual') {
      const manualNodes = profile.manualNodes && profile.manualNodes > 0 ? Math.round(profile.manualNodes) : 0;
      if (manualNodes > 0) {
        nodesRecommended = manualNodes;
      } else if (tierHasDemand && input.applySuggestedDefaultsWhenMissing) {
        nodesRecommended = suggestedManualNodesByTier(hotManual, tier);
      } else if (tierHasDemand) {
        warnings.push(`Tier ${tier}: sin nodos manuales definidos.`);
      }
    } else {
      const rawTarget = Math.max(1, Math.round(profile.targetShardsPerNode));
      const targetShardsPerNode = tier === 'frozen'
        ? clamp(rawTarget, 150, 300)
        : clamp(rawTarget, 1, 500);
      const rawByShardsTarget = totalShards > 0 ? Math.ceil(totalShards / targetShardsPerNode) : 0;
      const cap = clamp(Math.round(profile.autoNodesCap || 1), 1, 1000);
      if (rawByShardsTarget > 1000) {
        warnings.push(`NODE_LOGIC_ABORTED: Tier ${tier} superó 1000 nodos (${rawByShardsTarget}).`);
      }
      nodesRecommended = Math.min(rawByShardsTarget, cap, 1000);
      if (rawByShardsTarget > cap) {
        warnings.push(`NODE_COUNT_CAPPED: Tier ${tier} capped en ${cap} nodos.`);
      }
    }

    if (tierHasDemand && tier !== 'frozen') {
      nodesRecommended = Math.max(nodesRecommended, minNodesPerTier);
    }
    nodesRecommended = Math.min(1000, Math.max(0, nodesRecommended));

    return {
      tier,
      totalStorageGb,
      primaryShards,
      totalShards,
      avgPrimaryShardSizeGb,
      nodesByStorage,
      nodesByShards,
      nodesRecommended,
    };
  });

  return {
    rows: rows.map((row) => ({
      ...row,
      nodesByStorage: Math.max(0, row.nodesByStorage),
      nodesByShards: Math.max(0, row.nodesByShards),
    })),
    warnings,
  };
}

function collectWarnings(
  input: ClusterSizerInput,
  tiers: TierSolveResult[],
  dedicatedMasters: number,
): string[] {
  const warnings: string[] = [];
  const [minShardSize, maxShardSize] = input.shardSizeRangeGb;

  for (const tier of tiers) {
    if (tier.avgPrimaryShardSizeGb > 0
      && (tier.avgPrimaryShardSizeGb < minShardSize || tier.avgPrimaryShardSizeGb > maxShardSize)) {
      warnings.push(
        `Tier ${tier.tier}: shard promedio ${tier.avgPrimaryShardSizeGb.toFixed(2)} GB fuera de rango (${minShardSize}-${maxShardSize}).`,
      );
    }

    if (!hasTierDemand(tier) || tier.nodesRecommended <= 0) {
      continue;
    }

    const profile = input.tierProfiles[tier.tier];
    const shardLimitPerNode = Math.max(1, profile.heapGb * Math.max(1, input.maxShardsPerNodePerHeapGb));
    const shardsPerNode = tier.totalShards / tier.nodesRecommended;
    if (shardsPerNode > shardLimitPerNode) {
      warnings.push(`Tier ${tier.tier}: shard density alta (${shardsPerNode.toFixed(1)} shards/nodo).`);
    }

    const safeDiskUsableFactor = Math.max(0.05, input.diskUsableFactor);
    const capacityPerNodeGb = Math.max(1, profile.diskGb * safeDiskUsableFactor);
    const storagePerNode = tier.totalStorageGb / tier.nodesRecommended;
    const diskUsagePct = (storagePerNode / capacityPerNodeGb) * 100;
    if (diskUsagePct > 85) {
      warnings.push(`Tier ${tier.tier}: uso de disco ${diskUsagePct.toFixed(1)}% (watermark > 85%).`);
    }
  }

  if (input.availability === 'lab') {
    warnings.push('Perfil LAB: existe riesgo de single point of failure.');
  }
  if (input.availability !== 'lab' && dedicatedMasters <= 0) {
    warnings.push('Para alta disponibilidad se recomiendan masters dedicados.');
  }
  if (input.mode === 'simple' && (tiers.find((tier) => tier.tier === 'frozen')?.totalStorageGb ?? 0) > 0) {
    warnings.push('Frozen depende del repositorio (S3/NFS) y cache; no se escala como hot.');
  }

  return warnings;
}

export function solve_forward(input: ClusterSizerInput): ClusterSizerOutput {
  const tierRows = computeTierRows(input);
  const fatalNodeLogic = tierRows.warnings.some((warning) => warning.startsWith('NODE_LOGIC_ABORTED:'));
  const rows = fatalNodeLogic
    ? tierRows.rows.map((tier) => ({ ...tier, nodesRecommended: 0 }))
    : tierRows.rows;
  const topology: Record<TierName, number> = {
    hot: rows.find((tier) => tier.tier === 'hot')?.nodesRecommended ?? 0,
    warm: rows.find((tier) => tier.tier === 'warm')?.nodesRecommended ?? 0,
    cold: rows.find((tier) => tier.tier === 'cold')?.nodesRecommended ?? 0,
    frozen: rows.find((tier) => tier.tier === 'frozen')?.nodesRecommended ?? 0,
  };

  const dataNodes = rows.reduce((sum, row) => sum + row.nodesRecommended, 0);
  const dedicatedMasters = dedicatedMastersForAvailability(input.availability, dataNodes);

  const epsPerCore = QUERY_EPS_PER_CORE[input.queryProfile];
  const availabilityCpuMultiplier = AVAILABILITY_CPU_MULTIPLIER[input.availability];
  const totalCpuCores = Math.ceil((Math.max(0, input.workload.totalEps) / Math.max(1, epsPerCore)) * availabilityCpuMultiplier);

  const ramMultiplier = QUERY_RAM_MULTIPLIER[input.queryProfile];
  const totalRamGb = Math.ceil(rows.reduce((sum, row) => {
    if (row.nodesRecommended <= 0) {
      return sum;
    }
    const profile = input.tierProfiles[row.tier];
    const nodeRam = profile.heapGb * 2;
    return sum + (nodeRam * row.nodesRecommended);
  }, 0) * ramMultiplier);

  const safeDiskUsableFactor = Math.max(0.05, input.diskUsableFactor);
  const totalDiskGbUsable = Math.ceil(rows.reduce((sum, row) => sum + row.totalStorageGb, 0) / safeDiskUsableFactor);

  const referenceNodes = Math.max(1, dataNodes);
  const perNodeCpu = Math.max(1, Math.ceil(totalCpuCores / referenceNodes));
  const perNodeRam = Math.max(2, Math.ceil(totalRamGb / referenceNodes));
  const perNodeDisk = Math.max(10, Math.ceil(totalDiskGbUsable / referenceNodes));

  const frozenStorageGb = rows.find((tier) => tier.tier === 'frozen')?.totalStorageGb ?? 0;
  const cacheRequiredGb = frozenStorageGb * frozenCacheRatio(input.queryProfile);
  const frozenPlan = {
    snapshotRepoRequiredGb: frozenStorageGb,
    cacheRequiredGb,
    note: input.mode === 'simple' && frozenStorageGb > 0
      ? 'Frozen depende de throughput del repositorio y cache local.'
      : undefined,
  };

  const warnings = [...tierRows.warnings, ...collectWarnings(input, rows, dedicatedMasters)];
  return {
    tiers: rows,
    topology,
    dataNodes,
    dedicatedMasters,
    frozenPlan,
    requirements: {
      totalCpuCores,
      totalRamGb,
      totalDiskGbUsable,
      byNode: {
        cpuCores: perNodeCpu,
        ramGb: perNodeRam,
        diskGbUsable: perNodeDisk,
      },
    },
    warnings,
  };
}
