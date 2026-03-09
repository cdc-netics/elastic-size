import { CapacityCheckerInput, LimitingFactor, SolveInverseResult, WorkloadDemand } from '../../domain/sizing.types';

export interface CapacityCheckerEvaluation {
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
  perNode: {
    cpuCores: number;
    cpuCoresEffective: number;
    ramGb: number;
    ramGbEffective: number;
    inputDiskGb: number;
    diskGbEffective: number;
    diskType: 'ssd' | 'hdd';
    diskScope: 'per_node';
    heapGbEstimated: number;
    usableDiskGb: number;
    maxShards: number;
    epsCapacity: number;
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
    requiredNodesByCpu: number;
    requiredNodesByRam: number;
    requiredNodesFinal: number;
  };
  fit: {
    status: 'ok' | 'insufficient' | 'oversized';
    limitingFactor: LimitingFactor;
    nodeDelta: number;
    storageGapGb: number;
    shardsGap: number;
    epsGap: number;
    cpuGap: number;
    ramGap: number;
    storageSufficient: boolean;
    shardsSufficient: boolean;
    epsSufficient: boolean;
    cpuSufficient: boolean;
    ramSufficient: boolean;
    storageHardLimit: boolean;
    canScaleOutFixStorage: boolean;
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
  requiredMachine: {
    nodes: number;
    totalCpuCores: number;
    totalRamGb: number;
    totalDiskGbUsable: number;
  };
  inverse: SolveInverseResult;
}

interface CapacityContext {
  availableNodes: number;
  cpuCoresPerNode: number;
  ramGbPerNode: number;
  diskGbPerNode: number;
  effectiveCpuPerNode: number;
  effectiveRamPerNode: number;
  effectiveDiskPerNode: number;
  maxShardsPerNode: number;
  epsPerNode: number;
  dockerOverhead: CapacityCheckerEvaluation['dockerOverhead'];
  systemOverhead: CapacityCheckerEvaluation['systemOverhead'];
}

function roundUpDivision(numerator: number, denominator: number): number {
  if (denominator <= 0 || numerator <= 0) {
    return 0;
  }
  return Math.ceil(numerator / denominator);
}

function clampReserve(base: number, reserve: number, minEffective: number): number {
  return Math.min(Math.max(0, reserve), Math.max(0, base - minEffective));
}

function dockerOverheadFromServices(input: CapacityCheckerInput['docker']): CapacityCheckerEvaluation['dockerOverhead'] {
  const kibanaCount = Math.max(0, Math.round(Number(input.kibanaCount) || 0));
  const logstashCount = Math.max(0, Math.round(Number(input.logstashCount) || 0));
  const apmCount = Math.max(0, Math.round(Number(input.apmCount) || 0));

  return {
    enabled: Boolean(input.enabled) && kibanaCount + logstashCount + apmCount > 0,
    reservedCpuCores: kibanaCount * 1 + logstashCount * 2 + apmCount * 1,
    reservedRamGb: kibanaCount * 2 + logstashCount * 4 + apmCount * 2,
    reservedDiskGb: kibanaCount * 10 + logstashCount * 25 + apmCount * 10,
    kibanaCount,
    logstashCount,
    apmCount,
  };
}

function buildCapacityContext(input: CapacityCheckerInput): CapacityContext {
  const OS_RESERVED_CPU_CORES_PER_NODE = 0.5;
  const OS_RESERVED_RAM_GB_PER_NODE = 2;
  const OS_RESERVED_DISK_GB_PER_NODE = 20;

  const clusterCount = Math.max(1, Math.round(Number(input.clusterCount) || 1));
  const nodesPerCluster = Math.max(1, Math.round(Number(input.nodesPerCluster) || 1));
  const availableNodes = clusterCount * nodesPerCluster;

  const cpuCoresPerNode = Math.max(1, Number(input.machine.cpuCoresPerNode) || 1);
  const ramGbPerNode = Math.max(2, Number(input.machine.ramGbPerNode) || 2);
  const diskGbPerNode = Math.max(10, Number(input.machine.diskGbUsablePerNode) || 10);

  const dockerOverhead = dockerOverheadFromServices(input.docker);
  const effectiveDockerCpu = dockerOverhead.enabled ? dockerOverhead.reservedCpuCores : 0;
  const effectiveDockerRam = dockerOverhead.enabled ? dockerOverhead.reservedRamGb : 0;
  const effectiveDockerDisk = dockerOverhead.enabled ? dockerOverhead.reservedDiskGb : 0;

  const osReservedCpuPerNode = clampReserve(cpuCoresPerNode, OS_RESERVED_CPU_CORES_PER_NODE, 0.1);
  const osReservedRamPerNode = clampReserve(ramGbPerNode, OS_RESERVED_RAM_GB_PER_NODE, 0.5);
  const osReservedDiskPerNode = clampReserve(diskGbPerNode, OS_RESERVED_DISK_GB_PER_NODE, 1);
  const dockerReservedCpuPerNode = effectiveDockerCpu / availableNodes;
  const dockerReservedRamPerNode = effectiveDockerRam / availableNodes;
  const dockerReservedDiskPerNode = effectiveDockerDisk / availableNodes;

  const effectiveCpuPerNode = Math.max(0.1, cpuCoresPerNode - osReservedCpuPerNode - dockerReservedCpuPerNode);
  const effectiveRamPerNode = Math.max(0.5, ramGbPerNode - osReservedRamPerNode - dockerReservedRamPerNode);
  const effectiveDiskPerNode = Math.max(1, diskGbPerNode - osReservedDiskPerNode - dockerReservedDiskPerNode);
  const heapGbEstimated = Math.min(31, Math.max(1, effectiveRamPerNode * 0.5));
  const maxShardsPerNode = heapGbEstimated * Math.max(1, input.maxShardsPerNodePerHeapGb);
  const epsPerCore = input.machine.diskType === 'ssd' ? 900 : 450;
  const epsPerNode = effectiveCpuPerNode * epsPerCore;

  return {
    availableNodes,
    cpuCoresPerNode,
    ramGbPerNode,
    diskGbPerNode,
    effectiveCpuPerNode,
    effectiveRamPerNode,
    effectiveDiskPerNode,
    maxShardsPerNode,
    epsPerNode,
    dockerOverhead: {
      ...dockerOverhead,
      reservedCpuCores: effectiveDockerCpu,
      reservedRamGb: effectiveDockerRam,
      reservedDiskGb: effectiveDockerDisk,
    },
    systemOverhead: {
      reservedCpuCoresPerNode: osReservedCpuPerNode,
      reservedRamGbPerNode: osReservedRamPerNode,
      reservedDiskGbPerNode: osReservedDiskPerNode,
      totalReservedCpuCores: availableNodes * osReservedCpuPerNode,
      totalReservedRamGb: availableNodes * osReservedRamPerNode,
      totalReservedDiskGb: availableNodes * osReservedDiskPerNode,
    },
  };
}

function limitingFactorFromRatios(
  storageRatio: number,
  shardsRatio: number,
  epsRatio: number,
  cpuRatio: number,
  ramRatio: number,
): LimitingFactor {
  const ranked = [
    { factor: 'storage' as const, ratio: storageRatio },
    { factor: 'shards' as const, ratio: shardsRatio },
    { factor: 'eps' as const, ratio: epsRatio },
    { factor: 'cpu' as const, ratio: cpuRatio },
    { factor: 'ram' as const, ratio: ramRatio },
  ].sort((left, right) => right.ratio - left.ratio);

  const top = ranked[0];
  if (!top || top.ratio <= 0) {
    return 'none';
  }
  return top.factor;
}

function demandForEps(
  eps: number,
  baseline: WorkloadDemand,
): WorkloadDemand {
  const safeBaselineEps = Math.max(1e-6, baseline.totalEps);
  const factor = Math.max(0, eps) / safeBaselineEps;
  return {
    storageGb: baseline.storageGb * factor,
    totalShards: baseline.totalShards * factor,
    totalEps: eps,
    totalCpuCores: baseline.totalCpuCores * factor,
    totalRamGb: baseline.totalRamGb * factor,
    avgEventBytes: baseline.avgEventBytes,
  };
}

function isDemandFeasible(
  demand: WorkloadDemand,
  capacity: CapacityCheckerEvaluation['capacity'],
): boolean {
  return demand.storageGb <= capacity.usableStorageGb
    && demand.totalShards <= capacity.maxShards
    && demand.totalEps <= capacity.maxEps
    && demand.totalCpuCores <= capacity.totalCpuCoresForElastic
    && demand.totalRamGb <= capacity.totalRamGbForElastic;
}

export function solve_inverse(
  baselineDemand: WorkloadDemand,
  capacity: CapacityCheckerEvaluation['capacity'],
): SolveInverseResult {
  const sanitizedBaseline: WorkloadDemand = {
    storageGb: Math.max(0, baselineDemand.storageGb),
    totalShards: Math.max(1, baselineDemand.totalShards || 1),
    totalEps: Math.max(1, baselineDemand.totalEps || 1),
    totalCpuCores: Math.max(0.1, baselineDemand.totalCpuCores || (baselineDemand.totalEps / 900) || 0.1),
    totalRamGb: Math.max(0.1, baselineDemand.totalRamGb || 1),
    avgEventBytes: Math.max(1, baselineDemand.avgEventBytes || 1000),
  };

  let low = 0;
  let high = Math.max(1000, sanitizedBaseline.totalEps);
  let iterations = 0;

  while (iterations < 32) {
    const candidate = demandForEps(high, sanitizedBaseline);
    if (!isDemandFeasible(candidate, capacity) || high >= 1_000_000_000) {
      break;
    }
    low = high;
    high *= 2;
    iterations += 1;
  }

  for (let index = 0; index < 48; index += 1) {
    const mid = (low + high) / 2;
    const candidate = demandForEps(mid, sanitizedBaseline);
    if (isDemandFeasible(candidate, capacity)) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const maxDemand = demandForEps(low, sanitizedBaseline);
  const storageRatio = capacity.usableStorageGb > 0 ? maxDemand.storageGb / capacity.usableStorageGb : 0;
  const shardsRatio = capacity.maxShards > 0 ? maxDemand.totalShards / capacity.maxShards : 0;
  const epsRatio = capacity.maxEps > 0 ? maxDemand.totalEps / capacity.maxEps : 0;
  const cpuRatio = capacity.totalCpuCoresForElastic > 0 ? maxDemand.totalCpuCores / capacity.totalCpuCoresForElastic : 0;
  const ramRatio = capacity.totalRamGbForElastic > 0 ? maxDemand.totalRamGb / capacity.totalRamGbForElastic : 0;

  return {
    maxEps: low,
    maxGbPerHour: (low * sanitizedBaseline.avgEventBytes * 3600) / 1_000_000_000,
    limitingFactor: limitingFactorFromRatios(storageRatio, shardsRatio, epsRatio, cpuRatio, ramRatio),
    iterations: 48 + iterations,
  };
}

export function evaluate_capacity(input: CapacityCheckerInput): CapacityCheckerEvaluation {
  const RECOMMENDED_NODE_BUFFER_RATIO = 0.2;
  const context = buildCapacityContext(input);
  const loadMode: 'split' | 'duplicate' = input.clusterLoadMode === 'duplicate' ? 'duplicate' : 'split';
  const demandFactor = loadMode === 'duplicate' ? Math.max(1, Math.round(Number(input.clusterCount) || 1)) : 1;
  const headroomFactor = 1 + Math.max(0, Number(input.headroomPct) || 0) / 100;

  const capacity = {
    usableStorageGb: context.availableNodes * context.effectiveDiskPerNode,
    maxShards: context.availableNodes * context.maxShardsPerNode,
    maxEps: context.availableNodes * context.epsPerNode,
    totalRawDiskGb: context.availableNodes * context.diskGbPerNode,
    totalCpuCoresForElastic: context.availableNodes * context.effectiveCpuPerNode,
    totalRamGbForElastic: context.availableNodes * context.effectiveRamPerNode,
  };

  const baseline = {
    storageGb: Math.max(0, input.baselineDemand.storageGb),
    totalShards: Math.max(0, input.baselineDemand.totalShards),
    totalEps: Math.max(0, input.baselineDemand.totalEps),
    totalCpuCores: Math.max(0, input.baselineDemand.totalCpuCores),
    totalRamGb: Math.max(0, input.baselineDemand.totalRamGb),
    avgEventBytes: Math.max(1, input.baselineDemand.avgEventBytes || 1000),
  };

  const demand = input.compareAgainstWorkload
    ? {
      storageGb: baseline.storageGb * demandFactor * headroomFactor,
      autoShards: baseline.totalShards * demandFactor,
      manualShards: baseline.totalShards * demandFactor,
      usingManualShardDemand: false,
      totalShards: baseline.totalShards * demandFactor,
      totalEps: baseline.totalEps * demandFactor * headroomFactor,
      totalCpuCores: baseline.totalCpuCores * demandFactor * headroomFactor,
      totalRamGb: baseline.totalRamGb * demandFactor * headroomFactor,
    }
    : {
      storageGb: 0,
      autoShards: 0,
      manualShards: 0,
      usingManualShardDemand: false,
      totalShards: 0,
      totalEps: 0,
      totalCpuCores: 0,
      totalRamGb: 0,
    };

  const requiredNodesByStorage = roundUpDivision(demand.storageGb, context.effectiveDiskPerNode);
  const requiredNodesByShards = roundUpDivision(demand.totalShards, context.maxShardsPerNode);
  const requiredNodesByEps = roundUpDivision(demand.totalEps, context.epsPerNode);
  const requiredNodesByCpu = roundUpDivision(demand.totalCpuCores, context.effectiveCpuPerNode);
  const requiredNodesByRam = roundUpDivision(demand.totalRamGb, context.effectiveRamPerNode);
  const requiredNodesFinal = Math.max(
    1,
    requiredNodesByStorage,
    requiredNodesByShards,
    requiredNodesByEps,
    requiredNodesByCpu,
    requiredNodesByRam,
  );

  const nodeDelta = context.availableNodes - requiredNodesFinal;
  const storageGapGb = capacity.usableStorageGb - demand.storageGb;
  const shardsGap = capacity.maxShards - demand.totalShards;
  const epsGap = capacity.maxEps - demand.totalEps;
  const cpuGap = capacity.totalCpuCoresForElastic - demand.totalCpuCores;
  const ramGap = capacity.totalRamGbForElastic - demand.totalRamGb;

  const storageSufficient = storageGapGb >= 0;
  const shardsSufficient = shardsGap >= 0;
  const epsSufficient = epsGap >= 0;
  const cpuSufficient = cpuGap >= 0;
  const ramSufficient = ramGap >= 0;
  const allSufficient = storageSufficient && shardsSufficient && epsSufficient && cpuSufficient && ramSufficient;

  let status: 'ok' | 'insufficient' | 'oversized' = 'ok';
  if (input.compareAgainstWorkload && input.evaluationMode !== 'required_power' && (!allSufficient || nodeDelta < 0)) {
    status = 'insufficient';
  } else if (input.compareAgainstWorkload
    && input.evaluationMode !== 'required_power'
    && nodeDelta > Math.max(2, Math.ceil(requiredNodesFinal * 1.2))) {
    status = 'oversized';
  }

  const demandAsEnvelope: WorkloadDemand = {
    storageGb: demand.storageGb,
    totalShards: Math.max(0, demand.totalShards),
    totalEps: Math.max(0, demand.totalEps),
    totalCpuCores: Math.max(0, demand.totalCpuCores),
    totalRamGb: Math.max(0, demand.totalRamGb),
    avgEventBytes: baseline.avgEventBytes,
  };
  const inverse = solve_inverse({
    storageGb: Math.max(0.001, demandAsEnvelope.storageGb || baseline.storageGb || 0.001),
    totalShards: Math.max(1, demandAsEnvelope.totalShards || baseline.totalShards || 1),
    totalEps: Math.max(1, demandAsEnvelope.totalEps || baseline.totalEps || 1),
    totalCpuCores: Math.max(0.1, demandAsEnvelope.totalCpuCores || baseline.totalCpuCores || 0.1),
    totalRamGb: Math.max(0.1, demandAsEnvelope.totalRamGb || baseline.totalRamGb || 0.1),
    avgEventBytes: baseline.avgEventBytes,
  }, capacity);

  const limitingFactor = status === 'insufficient' || input.evaluationMode === 'required_power'
    ? limitingFactorFromRatios(
      capacity.usableStorageGb > 0 ? demand.storageGb / capacity.usableStorageGb : 0,
      capacity.maxShards > 0 ? demand.totalShards / capacity.maxShards : 0,
      capacity.maxEps > 0 ? demand.totalEps / capacity.maxEps : 0,
      capacity.totalCpuCoresForElastic > 0 ? demand.totalCpuCores / capacity.totalCpuCoresForElastic : 0,
      capacity.totalRamGbForElastic > 0 ? demand.totalRamGb / capacity.totalRamGbForElastic : 0,
    )
    : 'none';

  const minimumNodes = requiredNodesFinal;
  const recommendedNodes = minimumNodes <= 1
    ? 1
    : Math.max(minimumNodes + 1, Math.ceil(minimumNodes * (1 + RECOMMENDED_NODE_BUFFER_RATIO)));

  const buildSpecTarget = (nodes: number) => {
    const totalCpuCores = Math.ceil(nodes * context.cpuCoresPerNode + context.dockerOverhead.reservedCpuCores);
    const totalRamGb = Math.ceil(nodes * context.ramGbPerNode + context.dockerOverhead.reservedRamGb);
    const totalDiskGbUsable = Math.ceil(nodes * context.diskGbPerNode + context.dockerOverhead.reservedDiskGb);

    return {
      nodes,
      totalCpuCores,
      totalRamGb,
      totalDiskGbUsable,
      elasticCpuCores: Math.max(0, nodes * context.cpuCoresPerNode
        - nodes * context.systemOverhead.reservedCpuCoresPerNode
        - context.dockerOverhead.reservedCpuCores),
      elasticRamGb: Math.max(0, nodes * context.ramGbPerNode
        - nodes * context.systemOverhead.reservedRamGbPerNode
        - context.dockerOverhead.reservedRamGb),
      elasticDiskGb: Math.max(0, nodes * context.diskGbPerNode
        - nodes * context.systemOverhead.reservedDiskGbPerNode
        - context.dockerOverhead.reservedDiskGb),
    };
  };

  const specTargets = {
    minimum: buildSpecTarget(minimumNodes),
    recommended: buildSpecTarget(recommendedNodes),
  };

  return {
    availableNodes: context.availableNodes,
    systemOverhead: context.systemOverhead,
    dockerOverhead: context.dockerOverhead,
    perNode: {
      cpuCores: context.cpuCoresPerNode,
      cpuCoresEffective: context.effectiveCpuPerNode,
      ramGb: context.ramGbPerNode,
      ramGbEffective: context.effectiveRamPerNode,
      inputDiskGb: context.diskGbPerNode,
      diskGbEffective: context.effectiveDiskPerNode,
      diskType: input.machine.diskType,
      diskScope: 'per_node',
      heapGbEstimated: Math.min(31, Math.max(1, context.effectiveRamPerNode * 0.5)),
      usableDiskGb: context.effectiveDiskPerNode,
      maxShards: context.maxShardsPerNode,
      epsCapacity: context.epsPerNode,
    },
    capacity,
    demand: {
      loadMode,
      demandFactor,
      storageGb: demand.storageGb,
      autoShards: demand.autoShards,
      manualShards: demand.manualShards,
      usingManualShardDemand: false,
      totalShards: demand.totalShards,
      totalEps: demand.totalEps,
      totalCpuCores: demand.totalCpuCores,
      totalRamGb: demand.totalRamGb,
      noIngestDemand: demand.storageGb <= 0.0001 && demand.totalEps <= 0.0001,
      storageScalesWithNodes: true,
      requiredNodesByStorage,
      requiredNodesByShards,
      requiredNodesByEps,
      requiredNodesByCpu,
      requiredNodesByRam,
      requiredNodesFinal,
    },
    fit: {
      status,
      limitingFactor,
      nodeDelta,
      storageGapGb,
      shardsGap,
      epsGap,
      cpuGap,
      ramGap,
      storageSufficient,
      shardsSufficient,
      epsSufficient,
      cpuSufficient,
      ramSufficient,
      storageHardLimit: false,
      canScaleOutFixStorage: true,
    },
    specTargets,
    requiredMachine: {
      nodes: specTargets.minimum.nodes,
      totalCpuCores: specTargets.minimum.totalCpuCores,
      totalRamGb: specTargets.minimum.totalRamGb,
      totalDiskGbUsable: specTargets.minimum.totalDiskGbUsable,
    },
    inverse,
  };
}
