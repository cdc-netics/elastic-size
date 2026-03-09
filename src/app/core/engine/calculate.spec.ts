import { calculate, calculateAll } from './calculate';
import { normalizeInputs } from './conversions';
import { ScenarioInput } from '../models/sizing.models';
import { defaultConstraints, defaultNodeProfiles, defaultOverhead, sampleConfig } from '../data/defaults';

describe('Sizing engine', () => {
  it('normaliza gb_per_hour y calcula conversiones derivadas', () => {
    const dataset = {
      id: 'ds-1',
      name: 'Logs',
      kind: 'logs',
      ingest: {
        mode: 'gb_per_hour' as const,
        gbPerHour: 10,
        avgEventBytes: 1000,
      },
      retentionDaysByTier: { hot: 7, warm: 0, cold: 0, frozen: 0 },
      replicasByTier: { hot: 1, warm: 0, cold: 0, frozen: 0 },
      targetShardSizeGbByTier: { hot: 20, warm: 20, cold: 20, frozen: 20 },
      rolloverDaysByTier: { hot: 1, warm: 1, cold: 1, frozen: 1 },
    };

    const normalized = normalizeInputs(dataset);

    expect(normalized.metrics.gbPerDay).toBe(240);
    expect(normalized.metrics.bytesPerSec).toBeCloseTo(2777777.777, 2);
    expect(normalized.metrics.eps).toBeCloseTo(2777.777, 2);
  });

  it('calcula storage, shards y nodos por tier', () => {
    const scenario = buildScenario();
    const result = calculate(scenario);

    const hot = result.tiers.find((tier) => tier.tier === 'hot');
    expect(hot).toBeDefined();
    expect((hot?.totalStorageGb ?? 0)).toBeGreaterThan(0);
    expect((hot?.primaryShards ?? 0)).toBeGreaterThan(0);
    expect((hot?.nodesRecommended ?? 0)).toBeGreaterThan(0);
  });

  it('recomienda masters dedicados cuando data nodes supera el umbral', () => {
    const scenario = buildScenario();
    scenario.workloads[0].datasets[0].retentionDaysByTier.warm = 30;
    scenario.nodeSizing.manualNodesByTier.hot = 6;
    scenario.nodeSizing.manualNodesByTier.warm = 6;

    const result = calculate(scenario);

    expect(result.totals.dataNodes).toBeGreaterThan(scenario.constraints.requireDedicatedMastersWhenDataNodesGt);
    expect(result.totals.dedicatedMasters).toBe(3);
  });

  it('planner evita ubicar primario y replica del mismo shard en el mismo nodo cuando hay capacidad', () => {
    const scenario = buildScenario();
    scenario.workloads[0].datasets[0].replicasByTier.hot = 1;

    const result = calculate(scenario);
    const hotPlan = result.nodePlan.find((plan) => plan.tier === 'hot');
    expect(hotPlan).toBeDefined();

    const hasConflict = (hotPlan?.nodes ?? []).some((node) => {
      const seen = new Set<string>();
      for (const shard of node.shards) {
        if (seen.has(shard.shardKey)) {
          return true;
        }
        seen.add(shard.shardKey);
      }
      return false;
    });

    expect(hasConflict).toBeFalse();
  });

  it('no marca oversharding cuando shards por nodo está bajo el límite heap-aware', () => {
    const scenario = buildScenario();
    const result = calculate(scenario);

    const overshardingWarnings = result.warnings.filter((warning) => warning.code === 'OVERSHARDING');
    expect(overshardingWarnings.length).toBe(0);
  });

  it('sample de examen mantiene sizing cercano a 3 nodos por cluster', () => {
    const results = calculateAll(sampleConfig.scenarios);

    expect(results.length).toBe(2);
    expect(results[0].totals.dataNodes).toBe(3);
    expect(results[1].totals.dataNodes).toBe(3);
  });

  it('en modo auto aplica cap de frozen y emite warning de node count capped', () => {
    const scenario = buildScenario();
    scenario.nodeSizing.mode = 'auto';
    scenario.workloads[0].datasets[0].retentionDaysByTier.hot = 0;
    scenario.workloads[0].datasets[0].retentionDaysByTier.frozen = 365;
    scenario.workloads[0].datasets[0].targetShardSizeGbByTier.frozen = 1;
    scenario.workloads[0].datasets[0].rolloverDaysByTier.frozen = 1;
    scenario.nodeSizing.autoTargetShardsPerNodeByTier.frozen = 150;
    scenario.nodeSizing.autoNodesCapByTier.frozen = 50;

    const result = calculate(scenario);
    const frozen = result.tiers.find((tier) => tier.tier === 'frozen');

    expect((frozen?.nodesRecommended ?? 0)).toBe(50);
    expect(result.warnings.some((warning) => warning.code === 'NODE_COUNT_CAPPED')).toBeTrue();
  });

  it('en modo simple frozen respeta nodos manuales y no autoescala por shards', () => {
    const scenario = buildScenario();
    scenario.nodeSizing.mode = 'manual';
    scenario.workloads[0].datasets[0].retentionDaysByTier.hot = 0;
    scenario.workloads[0].datasets[0].retentionDaysByTier.warm = 0;
    scenario.workloads[0].datasets[0].retentionDaysByTier.cold = 0;
    scenario.workloads[0].datasets[0].retentionDaysByTier.frozen = 365;
    scenario.workloads[0].datasets[0].targetShardSizeGbByTier.frozen = 1;
    scenario.workloads[0].datasets[0].rolloverDaysByTier.frozen = 1;
    scenario.nodeSizing.manualNodesByTier.frozen = 7;

    const result = calculate(scenario);
    const frozen = result.tiers.find((tier) => tier.tier === 'frozen');

    expect((frozen?.nodesRecommended ?? 0)).toBe(7);
    expect(result.warnings.some((warning) => warning.code === 'NODE_COUNT_CAPPED')).toBeFalse();
  });

  it('detiene cálculo de nodos cuando supera guardrail de 1000 nodos', () => {
    const scenario = buildScenario();
    scenario.nodeSizing.mode = 'auto';
    scenario.workloads[0].datasets[0].retentionDaysByTier.hot = 0;
    scenario.workloads[0].datasets[0].retentionDaysByTier.warm = 0;
    scenario.workloads[0].datasets[0].retentionDaysByTier.cold = 0;
    scenario.workloads[0].datasets[0].retentionDaysByTier.frozen = 3650;
    scenario.workloads[0].datasets[0].targetShardSizeGbByTier.frozen = 1;
    scenario.workloads[0].datasets[0].rolloverDaysByTier.frozen = 1;
    scenario.nodeSizing.autoTargetShardsPerNodeByTier.frozen = 150;
    scenario.nodeSizing.autoNodesCapByTier.frozen = 1000;

    const result = calculate(scenario);
    const totalNodes = result.tiers.reduce((sum, tier) => sum + tier.nodesRecommended, 0);

    expect(totalNodes).toBe(0);
    expect(result.warnings.some((warning) => warning.code === 'NODE_LOGIC_ABORTED')).toBeTrue();
  });

  it('integra archivado/compression al cálculo principal (workloads/tiers/nodes)', () => {
    const scenario = buildScenario();
    scenario.workloads = [];
    scenario.archiveCompression.includeInSizing = true;
    scenario.archiveCompression.eps = 1000;
    scenario.archiveCompression.avgEventBytes = 800;
    scenario.archiveCompression.retentionHotDays = 60;
    scenario.archiveCompression.retentionArchivedDays = 305;
    scenario.archiveCompression.indexOverheadFactor = 0.45;
    scenario.archiveCompression.mode = 'indexed_to_archive';
    scenario.archiveCompression.compressionFactor = 0.12;

    const result = calculate(scenario);
    const archiveWorkload = result.workloads.find((workload) => workload.workloadName === 'Archivado/Compresión');
    const hotTier = result.tiers.find((tier) => tier.tier === 'hot');
    const frozenTier = result.tiers.find((tier) => tier.tier === 'frozen');

    expect(archiveWorkload).toBeDefined();
    expect((archiveWorkload?.totalStorageGb ?? 0)).toBeGreaterThan(0);
    expect((hotTier?.totalStorageGb ?? 0)).toBeGreaterThan(0);
    expect((frozenTier?.totalStorageGb ?? 0)).toBeGreaterThan(0);
    expect(result.totals.dataNodes).toBeGreaterThan(0);
  });

  it('en modo shards manuales respeta primarios y replicas configurados', () => {
    const scenario = buildScenario();
    scenario.manualShardPlan.enabled = true;
    scenario.manualShardPlan.primaryShardsPerCluster = 3;
    scenario.manualShardPlan.replicasPerPrimary = 2;
    scenario.deployment.clusterCount = 1;

    const result = calculate(scenario);

    expect(result.totals.totalShards).toBe(9);
    expect(result.totals.totalShards).toBeLessThan(1000);
    expect(result.warnings.some((warning) => warning.code === 'MANUAL_SHARD_PLAN_ACTIVE')).toBeTrue();
  });
});

function buildScenario(): ScenarioInput {
  return {
    id: 'scn-1',
    name: 'Escenario Test',
    mode: 'production',
    sizingApproach: 'normal',
    deployment: {
      clusterCount: 1,
      fixedDataNodesPerCluster: 3,
      clusterLoadMode: 'split',
    },
    machineProfile: {
      cpuCoresPerNode: 12,
      ramGbPerNode: 16,
      diskGbPerNode: 500,
      diskType: 'ssd',
      diskScope: 'per_node',
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
      machineCpuCores: 12,
      machineRamGb: 16,
      machineDiskGbUsable: 500,
      headroomPct: 30,
      result: { status: 'unknown', note: '' },
    },
    deploymentPlan: {
      mode: 'docker',
      services: { kibanaCount: 1, logstashCount: 0, apmCount: 0 },
      mapping: { esNodePerContainer: true },
    },
    overhead: { ...defaultOverhead },
    constraints: {
      ...defaultConstraints,
      recommendedShardSizeGbRange: [...defaultConstraints.recommendedShardSizeGbRange] as [number, number],
    },
    nodeProfiles: {
      hot: { ...defaultNodeProfiles.hot },
      warm: { ...defaultNodeProfiles.warm },
      cold: { ...defaultNodeProfiles.cold },
      frozen: { ...defaultNodeProfiles.frozen },
    },
    workloads: [
      {
        id: 'wl-1',
        name: 'SOC',
        datasets: [
          {
            id: 'ds-1',
            name: 'Syslog',
            kind: 'logs',
            ingest: {
              mode: 'gb_per_hour',
              gbPerHour: 40,
              avgEventBytes: 900,
            },
            retentionDaysByTier: { hot: 10, warm: 0, cold: 0, frozen: 0 },
            replicasByTier: { hot: 1, warm: 0, cold: 0, frozen: 0 },
            targetShardSizeGbByTier: { hot: 30, warm: 40, cold: 50, frozen: 50 },
            rolloverDaysByTier: { hot: 1, warm: 2, cold: 7, frozen: 14 },
          },
        ],
      },
    ],
  };
}
