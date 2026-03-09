export const TIERS = ['hot', 'warm', 'cold', 'frozen'] as const;

export type TierName = (typeof TIERS)[number];
export type AppMode = 'study' | 'production';
export type IngestInputMode = 'gb_per_hour' | 'gb_per_day' | 'eps_plus_avg_event_bytes';
export type WarningLevel = 'info' | 'warning' | 'error';
export type SizingApproach = 'normal' | 'machine_requirements';
export type DiskType = 'ssd' | 'hdd';
export type DiskScope = 'per_node' | 'total_cluster';
export type NodeSizingMode = 'manual' | 'auto';
export type DeploymentMode = 'docker' | 'vm' | 'baremetal';
export type MachineSpecMode = 'required_power' | 'fit_machine' | 'fit_machine_docker';
export type ArchiveCompressionMode = 'raw_to_archive' | 'indexed_to_archive';
export type ByteUnitSystem = 'GB10' | 'GiB2';
export type AvailabilityProfile = 'lab' | 'standard' | 'critical';
export type QueryProfile = 'low' | 'medium' | 'high';
export type PresetSourceCategory =
  | 'Firewall'
  | 'Switch'
  | 'Router'
  | 'EDR/XDR'
  | 'Windows'
  | 'Linux'
  | 'Cloud'
  | 'Email'
  | 'Proxy'
  | 'DNS'
  | 'VPN'
  | 'WAF'
  | 'IDS/IPS';
export type PresetUnitType = 'device' | 'agent' | 'user' | 'mailbox' | 'server' | 'ap';

export type TierRecord<T> = Record<TierName, T>;

export interface DatasetIngestInput {
  mode: IngestInputMode;
  gbPerHour?: number;
  gbPerDay?: number;
  eps?: number;
  avgEventBytes?: number;
}

export interface DatasetInput {
  id: string;
  name: string;
  kind: string;
  ingest: DatasetIngestInput;
  retentionDaysByTier: TierRecord<number>;
  replicasByTier: TierRecord<number>;
  targetShardSizeGbByTier: TierRecord<number>;
  rolloverDaysByTier: TierRecord<number>;
}

export interface WorkloadInput {
  id: string;
  name: string;
  datasets: DatasetInput[];
}

export interface OverheadFactors {
  indexOverheadFactor: number;
  headroomFactor: number;
  diskUsableFactor: number;
}

export interface Constraints {
  minDataNodesPerTier: number;
  requireDedicatedMastersWhenDataNodesGt: number;
  dedicatedMasters: number;
  maxShardsPerNodePerHeapGb: number;
  recommendedShardSizeGbRange: [number, number];
}

export interface TierNodeProfile {
  diskGb: number;
  heapGb: number;
}

export type NodeProfiles = TierRecord<TierNodeProfile>;

export interface DockerStackInput {
  enabled: boolean;
  kibanaCount: number;
  logstashCount: number;
  otherServicesCount: number;
}

export interface NodeSizingInput {
  mode: NodeSizingMode;
  applySuggestedDefaultsWhenMissing: boolean;
  manualNodesByTier: TierRecord<number | null>;
  autoTargetShardsPerNodeByTier: TierRecord<number>;
  autoNodesCapByTier: TierRecord<number>;
}

export interface ClusterPlanInput {
  eps: number;
  avgEventBytes: number;
  availabilityProfile?: AvailabilityProfile;
  queryProfile?: QueryProfile;
  retentionByTier: TierRecord<number>;
  shardTargetByTier: TierRecord<number>;
  replicasByTier: TierRecord<number>;
  computed: {
    tbByTier: TierRecord<number>;
    shardsByTier: TierRecord<number>;
    nodesByTier: TierRecord<number>;
  };
}

export interface CapacityCheckInput {
  mode: MachineSpecMode;
  compareAgainstWorkload?: boolean;
  machineCpuCores: number;
  machineRamGb: number;
  machineDiskGbUsable: number;
  headroomPct: number;
  result: {
    status: 'ok' | 'insufficient' | 'oversized' | 'unknown';
    note: string;
  };
}

export interface DeploymentPlanInput {
  mode: DeploymentMode;
  services: {
    kibanaCount: number;
    logstashCount: number;
    apmCount: number;
  };
  mapping: {
    esNodePerContainer: boolean;
  };
}

export interface ArchiveCompressionInput {
  includeInSizing: boolean;
  eps: number;
  avgEventBytes: number;
  retentionHotDays: number;
  retentionArchivedDays: number;
  compressionFactor: number;
  indexOverheadFactor: number;
  mode: ArchiveCompressionMode;
  unitSystem: ByteUnitSystem;
}

export interface SelectedSourceOverrides {
  avgEventBytes?: number;
  defaultEpsPerUnit?: number;
}

export interface SelectedSourceItemInput {
  id: string;
  presetId: string;
  quantity: number;
  unitType?: PresetUnitType;
  overrides?: SelectedSourceOverrides;
}

export interface PresetSourcesInput {
  catalogVersion: string;
  unitSystem: ByteUnitSystem;
  advancedMode: boolean;
  selectedItems: SelectedSourceItemInput[];
}

export interface ScenarioInput {
  id: string;
  name: string;
  mode: AppMode;
  sizingApproach: SizingApproach;
  deployment: {
    clusterCount: number;
    fixedDataNodesPerCluster: number;
    clusterLoadMode: 'split' | 'duplicate';
  };
  machineProfile: {
    cpuCoresPerNode: number;
    ramGbPerNode: number;
    diskGbPerNode: number;
    diskType: DiskType;
    diskScope: DiskScope;
    dockerStack: DockerStackInput;
  };
  manualShardPlan: {
    enabled: boolean;
    primaryShardsPerCluster: number;
    replicasPerPrimary: number;
  };
  nodeSizing: NodeSizingInput;
  clusterPlan: ClusterPlanInput;
  archiveCompression: ArchiveCompressionInput;
  presetSources: PresetSourcesInput;
  capacityCheck: CapacityCheckInput;
  deploymentPlan: DeploymentPlanInput;
  workloads: WorkloadInput[];
  overhead: OverheadFactors;
  constraints: Constraints;
  nodeProfiles: NodeProfiles;
}

export interface SizingConfig {
  schemaVersion?: number;
  project: {
    name: string;
    purpose: string;
    language: string;
  };
  scenarios: ScenarioInput[];
}

export interface NormalizedDatasetMetrics {
  gbPerHour: number;
  gbPerDay: number;
  bytesPerSec: number;
  eps: number;
  avgEventBytesUsed: number;
}

export interface TierDatasetStorage {
  scenarioId: string;
  workloadId: string;
  workloadName: string;
  datasetId: string;
  datasetName: string;
  tier: TierName;
  dailyGb: number;
  retentionDays: number;
  replicas: number;
  targetShardSizeGb: number;
  rolloverDays: number;
  primaryStorageGb: number;
  totalStorageGb: number;
  normalized: NormalizedDatasetMetrics;
}

export interface TierDatasetShard extends TierDatasetStorage {
  primaryShards: number;
  totalShards: number;
  avgPrimaryShardSizeGb: number;
}

export interface TierResult {
  tier: TierName;
  primaryStorageGb: number;
  totalStorageGb: number;
  primaryShards: number;
  totalShards: number;
  nodesByStorage: number;
  nodesByShardsHeap: number;
  nodesRecommended: number;
}

export interface WorkloadResult {
  workloadId: string;
  workloadName: string;
  totalStorageGb: number;
  totalShards: number;
  datasets: TierDatasetShard[];
}

export interface SizingWarning {
  level: WarningLevel;
  code: string;
  message: string;
  tier?: TierName;
  workloadId?: string;
  datasetId?: string;
}

export interface AssignedShard {
  shardKey: string;
  role: 'primary' | 'replica';
}

export interface NodeShardCard {
  nodeName: string;
  primaries: number;
  replicas: number;
  totalShards: number;
  shards: AssignedShard[];
}

export interface TierNodePlan {
  tier: TierName;
  nodes: NodeShardCard[];
}

export interface SizingResult {
  scenarioId: string;
  scenarioName: string;
  mode: AppMode;
  totals: {
    totalStorageGb: number;
    totalShards: number;
    totalEps: number;
    dataNodes: number;
    dedicatedMasters: number;
  };
  workloads: WorkloadResult[];
  tiers: TierResult[];
  warnings: SizingWarning[];
  nodePlan: TierNodePlan[];
}
