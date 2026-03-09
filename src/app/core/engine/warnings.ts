import { AppMode, Constraints, NodeProfiles, SizingWarning, TierDatasetShard, TierResult } from '../models/sizing.models';

const SHARD_RANGE_BY_TIER = {
  hot: [20, 40],
  warm: [25, 40],
  cold: [20, 30],
  frozen: [10, 20],
} as const;

export function generateWarnings(
  mode: AppMode,
  rows: TierDatasetShard[],
  tierResults: TierResult[],
  nodeProfiles: NodeProfiles,
  constraints: Constraints,
  dedicatedMasters: number,
): SizingWarning[] {
  const warnings: SizingWarning[] = [];
  const [globalMinShardSize, globalMaxShardSize] = constraints.recommendedShardSizeGbRange;

  for (const row of rows) {
    const [minShardSize, maxShardSize] = SHARD_RANGE_BY_TIER[row.tier] ?? [globalMinShardSize, globalMaxShardSize];
    if (row.avgPrimaryShardSizeGb > 0 && (row.avgPrimaryShardSizeGb < minShardSize || row.avgPrimaryShardSizeGb > maxShardSize)) {
      warnings.push({
        level: 'warning',
        code: 'SHARD_SIZE_RANGE',
        message: `${row.datasetName} (${row.tier}) tiene shard promedio ${row.avgPrimaryShardSizeGb.toFixed(2)} GB fuera del rango recomendado ${minShardSize}-${maxShardSize} GB.`,
        tier: row.tier,
        workloadId: row.workloadId,
        datasetId: row.datasetId,
      });
    }
  }

  for (const tierResult of tierResults) {
    if (tierResult.nodesRecommended <= 0) {
      continue;
    }

    const shardsPerNode = tierResult.totalShards / tierResult.nodesRecommended;

    if (tierResult.nodesByShardsHeap > tierResult.nodesByStorage) {
      warnings.push({
        level: 'warning',
        code: 'SHARDS_DRIVEN_CLUSTER',
        message: `Tier ${tierResult.tier}: el dimensionamiento final está guiado por shards objetivo (${tierResult.nodesByShardsHeap} nodos).`,
        tier: tierResult.tier,
      });
    }

    const shardLimitPerNode = nodeProfiles[tierResult.tier].heapGb * constraints.maxShardsPerNodePerHeapGb;
    if (shardsPerNode > shardLimitPerNode * 1.1) {
      warnings.push({
        level: 'error',
        code: 'OVERSHARDING',
        message: `Tier ${tierResult.tier}: oversharding detectado (${shardsPerNode.toFixed(1)} shards por nodo, límite ${shardLimitPerNode}).`,
        tier: tierResult.tier,
      });
    }
  }

  if (dedicatedMasters > 0) {
    warnings.push({
      level: 'warning',
      code: 'DEDICATED_MASTERS_REQUIRED',
      message: `Se recomiendan ${dedicatedMasters} masters dedicados por cantidad de data nodes.`,
    });
  }

  if (mode === 'production') {
    const hotTier = tierResults.find((tier) => tier.tier === 'hot');
    if (!hotTier || hotTier.totalStorageGb <= 0) {
      warnings.push({
        level: 'error',
        code: 'PROD_WITHOUT_HOT',
        message: 'Modo Producción requiere al menos un tier hot con datos.',
        tier: 'hot',
      });
    }
  }

  return warnings;
}
