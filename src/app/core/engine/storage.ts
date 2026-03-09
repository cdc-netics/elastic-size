import { ScenarioInput, TierDatasetStorage, WorkloadInput, DatasetInput, NormalizedDatasetMetrics, TIERS } from '../models/sizing.models';

const LOCAL_STORAGE_FACTOR_BY_TIER = {
  hot: 1,
  warm: 0.9,
  cold: 0.75,
  frozen: 0.15,
} as const;

export function calculateStorageByTier(
  scenario: ScenarioInput,
  workload: WorkloadInput,
  dataset: DatasetInput,
  normalized: NormalizedDatasetMetrics,
): TierDatasetStorage[] {
  return TIERS.map((tier) => {
    const retentionDays = Math.max(0, dataset.retentionDaysByTier[tier]);
    const configuredReplicas = Math.max(0, dataset.replicasByTier[tier]);
    const replicas = tier === 'frozen' ? 0 : configuredReplicas;
    const targetShardSizeGb = Math.max(1, dataset.targetShardSizeGbByTier[tier]);
    const rolloverDays = Math.max(1, dataset.rolloverDaysByTier[tier]);

    const basePrimaryGb = normalized.gbPerDay * retentionDays * scenario.overhead.indexOverheadFactor * scenario.overhead.headroomFactor;
    const localStorageFactor = LOCAL_STORAGE_FACTOR_BY_TIER[tier];
    const primaryStorageGb = basePrimaryGb * localStorageFactor;
    const totalStorageGb = primaryStorageGb * (1 + replicas);

    return {
      scenarioId: scenario.id,
      workloadId: workload.id,
      workloadName: workload.name,
      datasetId: dataset.id,
      datasetName: dataset.name,
      tier,
      dailyGb: normalized.gbPerDay,
      retentionDays,
      replicas,
      targetShardSizeGb,
      rolloverDays,
      primaryStorageGb,
      totalStorageGb,
      normalized,
    };
  });
}
