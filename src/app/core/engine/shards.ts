import { TierDatasetShard, TierDatasetStorage } from '../models/sizing.models';

export interface TierDatasetPrimaryShards extends TierDatasetStorage {
  primaryShards: number;
  avgPrimaryShardSizeGb: number;
}

export interface ManualShardPlanOptions {
  primaryShardsPerCluster: number;
  replicasPerPrimary: number;
  clusterCount?: number;
}

export function calculatePrimaryShardsByTier(rows: TierDatasetStorage[]): TierDatasetPrimaryShards[] {
  return rows.map((row) => {
    if (row.primaryStorageGb <= 0 || row.retentionDays <= 0) {
      return {
        ...row,
        primaryShards: 0,
        avgPrimaryShardSizeGb: 0,
      };
    }

    const shardsByTargetSize = Math.max(1, Math.ceil(row.primaryStorageGb / row.targetShardSizeGb));
    const primaryShards = shardsByTargetSize;
    const avgPrimaryShardSizeGb = row.primaryStorageGb / primaryShards;

    return {
      ...row,
      primaryShards,
      avgPrimaryShardSizeGb,
    };
  });
}

export function calculateTotalShardsByTier(rows: TierDatasetPrimaryShards[]): TierDatasetShard[] {
  return rows.map((row) => {
    const totalShards = row.primaryShards * (1 + row.replicas);

    return {
      ...row,
      totalShards,
    };
  });
}

export function calculateShardsWithManualPlan(
  rows: TierDatasetStorage[],
  options: ManualShardPlanOptions,
): TierDatasetShard[] {
  const clusterCount = Math.max(1, Math.round(Number(options.clusterCount) || 1));
  const requestedPrimaryShards = Math.max(1, Math.round(Number(options.primaryShardsPerCluster) || 1)) * clusterCount;
  const replicas = Math.max(0, Math.round(Number(options.replicasPerPrimary) || 0));
  const rowsWithData = rows.filter((row) => row.primaryStorageGb > 0 && row.retentionDays > 0);

  if (rowsWithData.length === 0) {
    return rows.map((row) => ({
      ...row,
      replicas,
      primaryShards: 0,
      avgPrimaryShardSizeGb: 0,
      totalShards: 0,
    }));
  }

  const totalPrimaryStorageGb = rowsWithData.reduce((sum, row) => sum + row.primaryStorageGb, 0);
  const primaryShardsByRowKey = allocatePrimaryShards(rowsWithData, requestedPrimaryShards, totalPrimaryStorageGb);

  return rows.map((row) => {
    const primaryShards = primaryShardsByRowKey.get(rowKey(row)) ?? 0;
    const avgPrimaryShardSizeGb = primaryShards > 0 ? row.primaryStorageGb / primaryShards : 0;
    const totalShards = primaryShards * (1 + replicas);

    return {
      ...row,
      replicas,
      primaryShards,
      avgPrimaryShardSizeGb,
      totalShards,
    };
  });
}

function allocatePrimaryShards(
  rowsWithData: TierDatasetStorage[],
  requestedPrimaryShards: number,
  totalPrimaryStorageGb: number,
): Map<string, number> {
  const allocations = new Map<string, number>();

  if (requestedPrimaryShards <= rowsWithData.length) {
    const sorted = [...rowsWithData].sort((a, b) => b.primaryStorageGb - a.primaryStorageGb);
    for (let index = 0; index < sorted.length; index += 1) {
      const row = sorted[index];
      allocations.set(rowKey(row), index < requestedPrimaryShards ? 1 : 0);
    }
    return allocations;
  }

  const remainders: Array<{ datasetId: string; remainder: number; size: number }> = [];
  let assigned = 0;

  for (const row of rowsWithData) {
    const ratio = totalPrimaryStorageGb > 0 ? row.primaryStorageGb / totalPrimaryStorageGb : 1 / rowsWithData.length;
    const exact = ratio * requestedPrimaryShards;
    const base = Math.max(1, Math.floor(exact));
    allocations.set(rowKey(row), base);
    assigned += base;
    remainders.push({ datasetId: rowKey(row), remainder: exact - Math.floor(exact), size: row.primaryStorageGb });
  }

  if (assigned < requestedPrimaryShards) {
    remainders.sort((a, b) => b.remainder - a.remainder || b.size - a.size);
    let cursor = 0;
    while (assigned < requestedPrimaryShards && remainders.length > 0) {
      const target = remainders[cursor % remainders.length];
      allocations.set(target.datasetId, (allocations.get(target.datasetId) ?? 0) + 1);
      assigned += 1;
      cursor += 1;
    }
  } else if (assigned > requestedPrimaryShards) {
    const removable = [...rowsWithData]
      .map((row) => ({
        datasetId: rowKey(row),
        size: row.primaryStorageGb,
      }))
      .sort((a, b) => a.size - b.size);

    let cursor = 0;
    while (assigned > requestedPrimaryShards && removable.length > 0) {
      const target = removable[cursor % removable.length];
      const current = allocations.get(target.datasetId) ?? 0;
      if (current > 1) {
        allocations.set(target.datasetId, current - 1);
        assigned -= 1;
      }
      cursor += 1;
      if (cursor > removable.length * 4) {
        break;
      }
    }
  }

  return allocations;
}

function rowKey(row: TierDatasetStorage): string {
  return `${row.workloadId}::${row.datasetId}::${row.tier}`;
}
