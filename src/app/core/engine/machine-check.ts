import { HostTargetType } from '../../domain/sizing.types';
import { ScenarioInput, SizingResult } from '../models/sizing.models';
import { evaluate_capacity } from './capacity_checker';

export interface MachineCapacityCheck {
  evaluationMode: 'required_power' | 'fit_machine' | 'fit_machine_docker';
  availableNodes: number;
  systemOverhead: {
    reservedCpuCoresPerNode: number;
    reservedRamGbPerNode: number;
    reservedDiskGbPerNode: number;
    totalReservedCpuCores: number;
    totalReservedRamGb: number;
    totalReservedDiskGb: number;
  };
  dockerOverhead: {
    enabled: boolean;
    reservedCpuCores: number;
    reservedRamGb: number;
    reservedDiskGb: number;
    kibanaCount: number;
    logstashCount: number;
    apmCount: number;
  };
  requiredMachine: {
    nodes: number;
    totalCpuCores: number;
    totalRamGb: number;
    totalDiskGbUsable: number;
  };
  perNode: {
    cpuCores: number;
    cpuCoresEffective: number;
    ramGb: number;
    ramGbEffective: number;
    inputDiskGb: number;
    diskGbEffective: number;
    diskType: 'ssd' | 'hdd';
    diskScope: 'per_node' | 'total_cluster';
    heapGbEstimated: number;
    usableDiskGb: number;
    maxShards: number;
    epsCapacity: number;
  };
  specTargets: {
    minimum: {
      nodes: number;
      totalCpuCores: number;
      totalRamGb: number;
      totalDiskGbUsable: number;
      elasticCpuCores: number;
      elasticRamGb: number;
      elasticDiskGb: number;
    };
    recommended: {
      nodes: number;
      totalCpuCores: number;
      totalRamGb: number;
      totalDiskGbUsable: number;
      elasticCpuCores: number;
      elasticRamGb: number;
      elasticDiskGb: number;
    };
  };
  capacity: {
    usableStorageGb: number;
    maxShards: number;
    maxEps: number;
    totalRawDiskGb: number;
    totalCpuCoresForElastic: number;
    totalRamGbForElastic: number;
  };
  demand: {
    loadMode: 'split' | 'duplicate';
    demandFactor: number;
    storageGb: number;
    autoShards: number;
    manualShards: number;
    usingManualShardDemand: boolean;
    totalShards: number;
    totalEps: number;
    totalCpuCores: number;
    totalRamGb: number;
    noIngestDemand: boolean;
    storageScalesWithNodes: boolean;
    requiredNodesByStorage: number;
    requiredNodesByShards: number;
    requiredNodesByEps: number;
    requiredNodesFinal: number;
  };
  fit: {
    status: 'ok' | 'insufficient' | 'oversized';
    limitingFactor: 'storage' | 'shards' | 'eps' | 'none';
    nodeDelta: number;
    storageGapGb: number;
    shardsGap: number;
    epsGap: number;
    storageSufficient: boolean;
    shardsSufficient: boolean;
    epsSufficient: boolean;
    storageHardLimit: boolean;
    canScaleOutFixStorage: boolean;
  };
  inverse: {
    maxEps: number;
    maxGbPerHour: number;
    limitingFactor: 'storage' | 'shards' | 'eps' | 'cpu' | 'ram' | 'none';
    iterations: number;
  };
}

function deriveHostTarget(scenario: ScenarioInput): HostTargetType {
  if (scenario.capacityCheck.mode === 'fit_machine_docker') {
    return 'docker_limits';
  }
  if (scenario.deploymentPlan.mode === 'vm') {
    return 'vm';
  }
  const clusters = Math.max(1, Math.round(Number(scenario.deployment.clusterCount) || 1));
  const nodesPerCluster = Math.max(1, Math.round(Number(scenario.deployment.fixedDataNodesPerCluster) || 1));
  if (clusters === 1 && nodesPerCluster === 1) {
    return 'single_host';
  }
  return 'cluster_dedicado';
}

function weightedAvgEventBytes(result: SizingResult): number {
  const rows = result.workloads.flatMap((workload) => workload.datasets);
  const totalEps = rows.reduce((sum, row) => sum + row.normalized.eps, 0);
  if (totalEps <= 0) {
    return 1000;
  }
  const totalWeighted = rows.reduce((sum, row) => sum + (row.normalized.eps * row.normalized.avgEventBytesUsed), 0);
  return Math.max(1, totalWeighted / totalEps);
}

function estimateDemandCpuByEps(totalEps: number, scenario: ScenarioInput): number {
  const queryProfile = scenario.clusterPlan.queryProfile ?? 'medium';
  const epsPerCore = queryProfile === 'high' ? 600 : queryProfile === 'low' ? 1200 : 900;
  return Math.max(0, totalEps / epsPerCore);
}

function estimateDemandRamByNodes(result: SizingResult, scenario: ScenarioInput): number {
  const hasRealDemand = result.tiers.some((tier) => tier.totalStorageGb > 0 || tier.totalShards > 0);
  if (!hasRealDemand) {
    return 0;
  }

  const queryProfile = scenario.clusterPlan.queryProfile ?? 'medium';
  const queryRamMultiplier = queryProfile === 'high' ? 1.2 : queryProfile === 'low' ? 0.8 : 1;
  const minNodeRamForDemandGb = 4;
  const maxNodeRamForDemandGb = 24;

  // Demand RAM should follow workload pressure, not manual node counts.
  const total = result.tiers.reduce((sum, tier) => {
    if (tier.totalStorageGb <= 0 && tier.totalShards <= 0) {
      return sum;
    }
    const profile = scenario.nodeProfiles[tier.tier];
    const rawNodeRam = Math.max(2, profile.heapGb * 2);
    const boundedNodeRam = Math.max(minNodeRamForDemandGb, Math.min(maxNodeRamForDemandGb, rawNodeRam));
    const nodeRam = boundedNodeRam * queryRamMultiplier;
    const demandNodes = Math.max(1, tier.nodesByStorage, tier.nodesByShardsHeap);
    return sum + (nodeRam * demandNodes);
  }, 0);
  return Math.max(0, total);
}

export function calculateMachineCapacityCheck(
  scenario: ScenarioInput,
  result: SizingResult,
): MachineCapacityCheck {
  const clusters = Math.max(1, Math.round(Number(scenario.deployment.clusterCount) || 1));
  const loadMode = scenario.deployment.clusterLoadMode === 'duplicate' ? 'duplicate' : 'split';
  const demandFactor = loadMode === 'duplicate' ? clusters : 1;
  const manualPrimary = Math.max(1, Math.round(Number(scenario.manualShardPlan.primaryShardsPerCluster) || 1)) * clusters;
  const manualReplicas = Math.max(0, Math.round(Number(scenario.manualShardPlan.replicasPerPrimary) || 0));
  const manualTotalShards = manualPrimary * (1 + manualReplicas);
  const usingManualShardDemand = Boolean(scenario.manualShardPlan.enabled);
  const compareAgainstWorkload = scenario.capacityCheck.compareAgainstWorkload !== false;
  const baselineTotalShards = usingManualShardDemand ? manualTotalShards : result.totals.totalShards;

  const evaluation = evaluate_capacity({
    evaluationMode: scenario.capacityCheck.mode,
    hostTarget: deriveHostTarget(scenario),
    clusterCount: scenario.deployment.clusterCount,
    nodesPerCluster: scenario.deployment.fixedDataNodesPerCluster,
    clusterLoadMode: loadMode,
    machine: {
      cpuCoresPerNode: scenario.capacityCheck.machineCpuCores,
      ramGbPerNode: scenario.capacityCheck.machineRamGb,
      diskGbUsablePerNode: scenario.capacityCheck.machineDiskGbUsable,
      diskType: scenario.machineProfile.diskType,
    },
    docker: {
      enabled: scenario.capacityCheck.mode === 'fit_machine_docker',
      kibanaCount: scenario.deploymentPlan.services.kibanaCount,
      logstashCount: scenario.deploymentPlan.services.logstashCount,
      apmCount: scenario.deploymentPlan.services.apmCount,
    },
    maxShardsPerNodePerHeapGb: scenario.constraints.maxShardsPerNodePerHeapGb,
    headroomPct: scenario.capacityCheck.headroomPct,
    compareAgainstWorkload,
    baselineDemand: {
      storageGb: result.totals.totalStorageGb,
      totalShards: baselineTotalShards,
      totalEps: result.totals.totalEps,
      totalCpuCores: estimateDemandCpuByEps(result.totals.totalEps, scenario),
      totalRamGb: estimateDemandRamByNodes(result, scenario),
      avgEventBytes: weightedAvgEventBytes(result),
    },
  });

  const safeLimitingFactor = evaluation.fit.limitingFactor === 'cpu' || evaluation.fit.limitingFactor === 'ram'
    ? 'eps'
    : evaluation.fit.limitingFactor;
  const effectiveTotalShards = usingManualShardDemand ? manualTotalShards : evaluation.demand.totalShards;
  const requiredNodesByShards = usingManualShardDemand
    ? Math.ceil((manualTotalShards || 0) / Math.max(1, evaluation.perNode.maxShards))
    : evaluation.demand.requiredNodesByShards;
  const requiredNodesFinal = Math.max(
    evaluation.demand.requiredNodesByStorage,
    requiredNodesByShards,
    evaluation.demand.requiredNodesByEps,
  );
  const nodeDelta = evaluation.availableNodes - requiredNodesFinal;
  const shardsGap = evaluation.capacity.maxShards - effectiveTotalShards;
  const shardsSufficient = shardsGap >= 0;
  const status = scenario.capacityCheck.mode !== 'required_power'
    && scenario.capacityCheck.compareAgainstWorkload !== false
    && (!evaluation.fit.storageSufficient || !evaluation.fit.epsSufficient || !shardsSufficient || nodeDelta < 0)
    ? 'insufficient'
    : evaluation.fit.status;

  return {
    evaluationMode: scenario.capacityCheck.mode,
    availableNodes: evaluation.availableNodes,
    systemOverhead: evaluation.systemOverhead,
    dockerOverhead: evaluation.dockerOverhead,
    requiredMachine: evaluation.requiredMachine,
    perNode: {
      ...evaluation.perNode,
      diskScope: scenario.machineProfile.diskScope,
    },
    specTargets: evaluation.specTargets,
    capacity: evaluation.capacity,
    demand: {
      ...evaluation.demand,
      loadMode,
      demandFactor,
      autoShards: result.totals.totalShards * demandFactor,
      manualShards: manualTotalShards,
      usingManualShardDemand,
      totalShards: effectiveTotalShards,
      requiredNodesByShards,
      requiredNodesFinal,
    },
    fit: {
      ...evaluation.fit,
      status,
      limitingFactor: safeLimitingFactor,
      nodeDelta,
      shardsGap,
      shardsSufficient,
      epsSufficient: evaluation.fit.epsSufficient && evaluation.fit.cpuSufficient && evaluation.fit.ramSufficient,
      epsGap: Math.min(evaluation.fit.epsGap, evaluation.fit.cpuGap, evaluation.fit.ramGap),
    },
    inverse: evaluation.inverse,
  };
}
