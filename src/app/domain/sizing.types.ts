import { TierName } from '../core/models/sizing.models';

export type SolverMode = 'simple' | 'advanced';
export type AvailabilityProfile = 'lab' | 'standard' | 'critical';
export type QueryProfile = 'low' | 'medium' | 'high';
export type HostTargetType = 'cluster_dedicado' | 'single_host' | 'docker_limits' | 'vm';
export type EvaluationMode = 'required_power' | 'fit_machine' | 'fit_machine_docker';
export type LimitingFactor = 'storage' | 'shards' | 'eps' | 'cpu' | 'ram' | 'none';

export interface TierDemand {
  tier: TierName;
  totalStorageGb: number;
  primaryShards: number;
  totalShards: number;
  avgPrimaryShardSizeGb: number;
}

export interface TierComputeProfile {
  diskGb: number;
  heapGb: number;
  manualNodes: number | null;
  targetShardsPerNode: number;
  autoNodesCap: number;
}

export type TierComputeProfiles = Record<TierName, TierComputeProfile>;

export interface WorkloadEnvelope {
  totalEps: number;
  avgEventBytes: number;
}

export interface ClusterSizerInput {
  mode: SolverMode;
  availability: AvailabilityProfile;
  queryProfile: QueryProfile;
  demand: TierDemand[];
  workload: WorkloadEnvelope;
  diskUsableFactor: number;
  maxShardsPerNodePerHeapGb: number;
  shardSizeRangeGb: [number, number];
  minDataNodesPerTier: number;
  tierProfiles: TierComputeProfiles;
  applySuggestedDefaultsWhenMissing: boolean;
  nodeSizingMode: 'manual' | 'auto';
}

export interface TierSolveResult {
  tier: TierName;
  totalStorageGb: number;
  primaryShards: number;
  totalShards: number;
  avgPrimaryShardSizeGb: number;
  nodesByStorage: number;
  nodesByShards: number;
  nodesRecommended: number;
}

export interface ClusterRequirements {
  totalCpuCores: number;
  totalRamGb: number;
  totalDiskGbUsable: number;
  byNode: {
    cpuCores: number;
    ramGb: number;
    diskGbUsable: number;
  };
}

export interface ClusterSizerOutput {
  tiers: TierSolveResult[];
  topology: Record<TierName, number>;
  dataNodes: number;
  dedicatedMasters: number;
  frozenPlan: {
    snapshotRepoRequiredGb: number;
    cacheRequiredGb: number;
    note?: string;
  };
  requirements: ClusterRequirements;
  warnings: string[];
}

export interface CapacityEnvelope {
  usableStorageGb: number;
  maxShards: number;
  maxEps: number;
  totalCpuCoresForElastic: number;
  totalRamGbForElastic: number;
  totalRawDiskGb: number;
}

export interface WorkloadDemand {
  storageGb: number;
  totalShards: number;
  totalEps: number;
  totalCpuCores: number;
  totalRamGb: number;
  avgEventBytes: number;
}

export interface SolveInverseResult {
  maxEps: number;
  maxGbPerHour: number;
  limitingFactor: LimitingFactor;
  iterations: number;
}

export interface CapacityCheckerInput {
  evaluationMode: EvaluationMode;
  hostTarget: HostTargetType;
  clusterCount: number;
  nodesPerCluster: number;
  clusterLoadMode?: 'split' | 'duplicate';
  machine: {
    cpuCoresPerNode: number;
    ramGbPerNode: number;
    diskGbUsablePerNode: number;
    diskType: 'ssd' | 'hdd';
  };
  docker: {
    enabled: boolean;
    kibanaCount: number;
    logstashCount: number;
    apmCount: number;
  };
  maxShardsPerNodePerHeapGb: number;
  headroomPct: number;
  compareAgainstWorkload: boolean;
  baselineDemand: WorkloadDemand;
}

export interface CapacityFit {
  status: 'ok' | 'insufficient' | 'oversized';
  limitingFactor: LimitingFactor;
  storageSufficient: boolean;
  shardsSufficient: boolean;
  epsSufficient: boolean;
  cpuSufficient: boolean;
  ramSufficient: boolean;
}

export interface CapacityCheckerOutput {
  availableNodes: number;
  capacity: CapacityEnvelope;
  demand: WorkloadDemand;
  fit: CapacityFit;
  inverse: SolveInverseResult;
}
