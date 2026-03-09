import { evaluate_capacity, solve_inverse } from './capacity_checker';

describe('capacity_checker', () => {
  it('solve_inverse encuentra mayor EPS cuando aumenta capacidad', () => {
    const baseline = {
      storageGb: 500,
      totalShards: 300,
      totalEps: 2000,
      totalCpuCores: 3,
      totalRamGb: 16,
      avgEventBytes: 1000,
    };

    const small = solve_inverse(baseline, {
      usableStorageGb: 2000,
      maxShards: 1200,
      maxEps: 9000,
      totalRawDiskGb: 2500,
      totalCpuCoresForElastic: 10,
      totalRamGbForElastic: 64,
    });
    const large = solve_inverse(baseline, {
      usableStorageGb: 4000,
      maxShards: 2400,
      maxEps: 18000,
      totalRawDiskGb: 5000,
      totalCpuCoresForElastic: 20,
      totalRamGbForElastic: 128,
    });

    expect(large.maxEps).toBeGreaterThan(small.maxEps);
    expect(large.maxGbPerHour).toBeGreaterThan(small.maxGbPerHour);
  });

  it('evaluate_capacity permite modo sin comparación de workload', () => {
    const report = evaluate_capacity({
      evaluationMode: 'fit_machine',
      hostTarget: 'single_host',
      clusterCount: 1,
      nodesPerCluster: 1,
      clusterLoadMode: 'split',
      machine: {
        cpuCoresPerNode: 8,
        ramGbPerNode: 32,
        diskGbUsablePerNode: 500,
        diskType: 'ssd',
      },
      docker: {
        enabled: false,
        kibanaCount: 0,
        logstashCount: 0,
        apmCount: 0,
      },
      maxShardsPerNodePerHeapGb: 20,
      headroomPct: 30,
      compareAgainstWorkload: false,
      baselineDemand: {
        storageGb: 100,
        totalShards: 50,
        totalEps: 1000,
        totalCpuCores: 2,
        totalRamGb: 8,
        avgEventBytes: 1000,
      },
    });

    expect(report.demand.totalEps).toBe(0);
    expect(report.fit.status).toBe('ok');
    expect(report.inverse.maxEps).toBeGreaterThan(0);
  });
});
