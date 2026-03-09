import { calculateMachineCapacityCheck } from './machine-check';
import { ScenarioInput, SizingResult } from '../models/sizing.models';

describe('Machine capacity check', () => {
  it('marca storage insuficiente cuando falta disco usable por nodo', () => {
    const scenario = baseScenario();
    scenario.deployment.clusterCount = 1;
    scenario.deployment.fixedDataNodesPerCluster = 2;
    scenario.capacityCheck.machineDiskGbUsable = 100;

    const result = baseResult();
    result.totals.totalStorageGb = 2000;

    const check = calculateMachineCapacityCheck(scenario, result);

    expect(check.fit.status).toBe('insufficient');
    expect(check.fit.limitingFactor).toBe('storage');
    expect(check.fit.storageHardLimit).toBeFalse();
    expect(check.fit.canScaleOutFixStorage).toBeTrue();
    expect(check.demand.requiredNodesByStorage).toBeGreaterThan(0);
  });

  it('calcula nodos requeridos por storage con disco usable por nodo', () => {
    const scenario = baseScenario();
    scenario.capacityCheck.machineDiskGbUsable = 200;

    const result = baseResult();
    result.totals.totalStorageGb = 1000;

    const check = calculateMachineCapacityCheck(scenario, result);

    expect(check.demand.storageScalesWithNodes).toBeTrue();
    expect(check.demand.requiredNodesByStorage).toBeGreaterThan(0);
    expect(check.fit.canScaleOutFixStorage).toBeTrue();
  });

  it('detecta cuello de botella por CPU (EPS)', () => {
    const scenario = baseScenario();
    scenario.capacityCheck.machineCpuCores = 2;
    scenario.capacityCheck.machineDiskGbUsable = 4000;

    const result = baseResult();
    result.totals.totalEps = 5_000_000;
    result.totals.totalStorageGb = 100;

    const check = calculateMachineCapacityCheck(scenario, result);

    expect(check.fit.status).toBe('insufficient');
    expect(check.fit.limitingFactor).toBe('eps');
    expect(check.fit.epsSufficient).toBeFalse();
  });

  it('aumenta demanda al subir headroom', () => {
    const scenario = baseScenario();
    const result = baseResult();
    scenario.capacityCheck.headroomPct = 0;
    const withoutHeadroom = calculateMachineCapacityCheck(scenario, result);

    scenario.capacityCheck.headroomPct = 50;
    const withHeadroom = calculateMachineCapacityCheck(scenario, result);

    expect(withHeadroom.demand.storageGb).toBeGreaterThan(withoutHeadroom.demand.storageGb);
    expect(withHeadroom.demand.totalEps).toBeGreaterThan(withoutHeadroom.demand.totalEps);
  });

  it('modo dockerizado descuenta capacidad por servicios', () => {
    const scenario = baseScenario();
    const result = baseResult();
    scenario.capacityCheck.mode = 'fit_machine';
    const normal = calculateMachineCapacityCheck(scenario, result);

    scenario.capacityCheck.mode = 'fit_machine_docker';
    scenario.deploymentPlan.services.kibanaCount = 2;
    scenario.deploymentPlan.services.logstashCount = 2;
    scenario.deploymentPlan.services.apmCount = 1;
    const dockerized = calculateMachineCapacityCheck(scenario, result);

    expect(dockerized.dockerOverhead.enabled).toBeTrue();
    expect(dockerized.systemOverhead.reservedCpuCoresPerNode).toBeGreaterThan(0);
    expect(dockerized.perNode.cpuCoresEffective).toBeLessThan(dockerized.perNode.cpuCores);
    expect(dockerized.capacity.maxEps).toBeLessThan(normal.capacity.maxEps);
  });

  it('modo required_power calcula requerimiento sin marcar insuficiente por defecto', () => {
    const scenario = baseScenario();
    const result = baseResult();
    scenario.capacityCheck.mode = 'required_power';

    const check = calculateMachineCapacityCheck(scenario, result);

    expect(check.evaluationMode).toBe('required_power');
    expect(check.requiredMachine.nodes).toBeGreaterThan(0);
    expect(check.specTargets.minimum.nodes).toBe(check.requiredMachine.nodes);
    expect(check.specTargets.recommended.nodes).toBeGreaterThanOrEqual(check.specTargets.minimum.nodes);
    expect(check.systemOverhead.totalReservedRamGb).toBeGreaterThan(0);
    expect(check.fit.status).toBe('ok');
  });

  it('evita sobreestimar RAM en cargas bajas (500 EPS, 1 tier con 1 nodo de demanda)', () => {
    const scenario = baseScenario();
    scenario.capacityCheck.machineRamGb = 16;
    scenario.capacityCheck.machineDiskGbUsable = 100;
    scenario.capacityCheck.headroomPct = 30;
    scenario.deployment.clusterCount = 1;
    scenario.deployment.fixedDataNodesPerCluster = 3;

    const result = baseResult();
    result.totals.totalEps = 500;
    result.totals.totalStorageGb = 130;
    result.totals.totalShards = 8;
    result.tiers = [{
      tier: 'hot',
      primaryStorageGb: 65,
      totalStorageGb: 130,
      primaryShards: 4,
      totalShards: 8,
      nodesByStorage: 1,
      nodesByShardsHeap: 1,
      nodesRecommended: 3,
    }];

    const check = calculateMachineCapacityCheck(scenario, result);
    expect(check.demand.totalRamGb).toBeLessThan(40);
    expect(check.demand.totalRamGb).toBeLessThanOrEqual(check.capacity.totalRamGbForElastic);
  });
});

function baseScenario(): ScenarioInput {
  return {
    id: 'scn-test',
    name: 'Escenario test',
    mode: 'study',
    sizingApproach: 'machine_requirements',
    deployment: {
      clusterCount: 1,
      fixedDataNodesPerCluster: 3,
      clusterLoadMode: 'split',
    },
    machineProfile: {
      cpuCoresPerNode: 16,
      ramGbPerNode: 64,
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
      mode: 'manual',
      applySuggestedDefaultsWhenMissing: true,
      manualNodesByTier: { hot: 3, warm: null, cold: null, frozen: null },
      autoTargetShardsPerNodeByTier: { hot: 120, warm: 140, cold: 170, frozen: 200 },
      autoNodesCapByTier: { hot: 300, warm: 200, cold: 100, frozen: 50 },
    },
    clusterPlan: {
      eps: 1000,
      avgEventBytes: 1000,
      retentionByTier: { hot: 7, warm: 0, cold: 0, frozen: 0 },
      shardTargetByTier: { hot: 30, warm: 30, cold: 25, frozen: 20 },
      replicasByTier: { hot: 1, warm: 0, cold: 0, frozen: 0 },
      computed: {
        tbByTier: { hot: 0, warm: 0, cold: 0, frozen: 0 },
        shardsByTier: { hot: 0, warm: 0, cold: 0, frozen: 0 },
        nodesByTier: { hot: 0, warm: 0, cold: 0, frozen: 0 },
      },
    },
    archiveCompression: {
      includeInSizing: false,
      eps: 1000,
      avgEventBytes: 800,
      retentionHotDays: 60,
      retentionArchivedDays: 305,
      compressionFactor: 0.12,
      indexOverheadFactor: 0.45,
      mode: 'indexed_to_archive',
      unitSystem: 'GB10',
    },
    presetSources: {
      catalogVersion: '2026.02',
      unitSystem: 'GB10',
      advancedMode: false,
      selectedItems: [],
    },
    capacityCheck: {
      mode: 'fit_machine',
      machineCpuCores: 16,
      machineRamGb: 64,
      machineDiskGbUsable: 425,
      headroomPct: 30,
      result: { status: 'unknown', note: '' },
    },
    deploymentPlan: {
      mode: 'docker',
      services: { kibanaCount: 1, logstashCount: 0, apmCount: 0 },
      mapping: { esNodePerContainer: true },
    },
    workloads: [],
    overhead: {
      indexOverheadFactor: 1.15,
      headroomFactor: 1.3,
      diskUsableFactor: 0.85,
    },
    constraints: {
      minDataNodesPerTier: 3,
      requireDedicatedMastersWhenDataNodesGt: 5,
      dedicatedMasters: 3,
      maxShardsPerNodePerHeapGb: 20,
      recommendedShardSizeGbRange: [10, 50],
    },
    nodeProfiles: {
      hot: { diskGb: 2000, heapGb: 32 },
      warm: { diskGb: 4000, heapGb: 32 },
      cold: { diskGb: 8000, heapGb: 16 },
      frozen: { diskGb: 12000, heapGb: 16 },
    },
  };
}

function baseResult(): SizingResult {
  return {
    scenarioId: 'scn-test',
    scenarioName: 'Escenario test',
    mode: 'study',
    totals: {
      totalStorageGb: 200,
      totalShards: 200,
      totalEps: 1000,
      dataNodes: 3,
      dedicatedMasters: 0,
    },
    workloads: [],
    tiers: [],
    warnings: [],
    nodePlan: [],
  };
}
