import {
  Constraints,
  NodeProfiles,
  ScenarioInput,
  SizingWarning,
  TIERS,
  TierName,
  TierResult,
} from '../models/sizing.models';

interface TierAccumulator {
  primaryStorageGb: number;
  totalStorageGb: number;
  primaryShards: number;
  totalShards: number;
}

interface TierNodeResolution {
  tiers: TierResult[];
  warnings: SizingWarning[];
  fatalNodeLogic: boolean;
}

function safePositiveInt(value: number | null | undefined, fallback: number): number {
  const numeric = Math.round(Number(value) || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return Math.max(1, fallback);
  }
  return numeric;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hasTierData(tierResult: TierResult): boolean {
  return tierResult.totalStorageGb > 0 || tierResult.totalShards > 0;
}

function suggestedManualNodesByTier(hotNodes: number, tier: TierName): number {
  if (tier === 'hot') {
    return hotNodes;
  }
  if (tier === 'warm') {
    return Math.min(12, Math.max(2, Math.ceil(hotNodes * 0.33)));
  }
  if (tier === 'cold') {
    return Math.min(8, Math.max(2, Math.ceil(hotNodes * 0.2)));
  }
  return Math.min(6, Math.max(2, Math.ceil(hotNodes * 0.1)));
}

function normalizedTargetShardsPerNode(scenario: ScenarioInput, tier: TierName): number {
  const raw = safePositiveInt(scenario.nodeSizing.autoTargetShardsPerNodeByTier[tier], tier === 'frozen' ? 200 : 120);
  if (tier === 'frozen') {
    return clamp(raw, 150, 300);
  }
  return clamp(raw, 1, 500);
}

function normalizedTierCap(scenario: ScenarioInput, tier: TierName): number {
  const fallback = tier === 'warm' ? 200 : tier === 'cold' ? 100 : tier === 'frozen' ? 50 : 300;
  return clamp(safePositiveInt(scenario.nodeSizing.autoNodesCapByTier[tier], fallback), 1, 1000);
}

function buildStorageReference(tierResults: TierResult[], nodeProfiles: NodeProfiles, diskUsableFactor: number): TierResult[] {
  const safeDiskUsableFactor = Math.max(0.05, diskUsableFactor);
  return tierResults.map((tierResult) => {
    const profile = nodeProfiles[tierResult.tier];
    const capacityPerNodeGb = profile.diskGb * safeDiskUsableFactor;
    const nodesByStorage = tierResult.totalStorageGb > 0 && capacityPerNodeGb > 0
      ? Math.ceil(tierResult.totalStorageGb / capacityPerNodeGb)
      : 0;

    return {
      ...tierResult,
      nodesByStorage,
    };
  });
}

function resolveManualNodes(tierResults: TierResult[], scenario: ScenarioInput): TierNodeResolution {
  const warnings: SizingWarning[] = [];
  const configuredHot = scenario.nodeSizing.manualNodesByTier.hot;
  const hotNodes = configuredHot && configuredHot > 0 ? safePositiveInt(configuredHot, 3) : 3;
  let fatalNodeLogic = false;

  const tiers = tierResults.map((tierResult) => {
    const tier = tierResult.tier;
    const manualValue = scenario.nodeSizing.manualNodesByTier[tier];
    const manualNodes = manualValue && manualValue > 0 ? safePositiveInt(manualValue, 0) : 0;
    const suggested = suggestedManualNodesByTier(hotNodes, tier);
    const tierHasData = hasTierData(tierResult);

    let nodesRecommended = 0;

    if (manualNodes > 0) {
      nodesRecommended = manualNodes;
    } else if (tierHasData && scenario.nodeSizing.applySuggestedDefaultsWhenMissing) {
      nodesRecommended = suggested;
      warnings.push({
        level: 'info',
        code: 'NODES_DEFAULT_APPLIED',
        tier,
        message: `Tier ${tier}: se aplicó default sugerido de ${suggested} nodos (modo simple).`,
      });
    } else if (tierHasData && !scenario.nodeSizing.applySuggestedDefaultsWhenMissing) {
      warnings.push({
        level: 'error',
        code: 'MANUAL_NODES_REQUIRED',
        tier,
        message: `Tier ${tier}: define nodos manuales o activa defaults sugeridos en modo simple.`,
      });
    }

    if (nodesRecommended > 1000) {
      fatalNodeLogic = true;
      warnings.push({
        level: 'error',
        code: 'NODE_LOGIC_GUARD',
        tier,
        message: `Tier ${tier}: ${nodesRecommended} nodos excede 1000. Se requiere input manual.`,
      });
      nodesRecommended = 0;
    }

    const targetShards = normalizedTargetShardsPerNode(scenario, tier);
    const nodesByShardsTarget = tierResult.totalShards > 0
      ? Math.ceil(tierResult.totalShards / targetShards)
      : 0;

    return {
      ...tierResult,
      nodesByShardsHeap: nodesByShardsTarget,
      nodesRecommended,
    };
  });

  return { tiers, warnings, fatalNodeLogic };
}

function resolveAutoNodes(tierResults: TierResult[], scenario: ScenarioInput): TierNodeResolution {
  const warnings: SizingWarning[] = [];
  let fatalNodeLogic = false;

  const tiers = tierResults.map((tierResult) => {
    const tier = tierResult.tier;
    const tierHasData = hasTierData(tierResult);
    const targetShards = normalizedTargetShardsPerNode(scenario, tier);
    const rawNodesByShards = tierHasData && tierResult.totalShards > 0
      ? Math.ceil(tierResult.totalShards / targetShards)
      : 0;

    const tierCap = normalizedTierCap(scenario, tier);
    let nodesRecommended = rawNodesByShards;

    if (rawNodesByShards > 1000) {
      fatalNodeLogic = true;
      warnings.push({
        level: 'error',
        code: 'NODE_LOGIC_GUARD',
        tier,
        message: `Tier ${tier}: ${rawNodesByShards} nodos calculados (>1000). Detenido; define input manual.`,
      });
      nodesRecommended = 0;
    } else if (rawNodesByShards > tierCap) {
      nodesRecommended = tierCap;
      warnings.push({
        level: 'warning',
        code: 'NODE_COUNT_CAPPED',
        tier,
        message: `Tier ${tier}: Node count capped; adjust shard target/caching/workload assumptions.`,
      });
    }

    return {
      ...tierResult,
      nodesByShardsHeap: rawNodesByShards,
      nodesRecommended,
    };
  });

  return { tiers, warnings, fatalNodeLogic };
}

export function summarizeTier(
  rows: ReadonlyArray<{ tier: (typeof TIERS)[number]; primaryStorageGb: number; totalStorageGb: number; primaryShards: number; totalShards: number }>,
): TierResult[] {
  const byTier = new Map<(typeof TIERS)[number], TierAccumulator>();

  for (const tier of TIERS) {
    byTier.set(tier, {
      primaryStorageGb: 0,
      totalStorageGb: 0,
      primaryShards: 0,
      totalShards: 0,
    });
  }

  for (const row of rows) {
    const current = byTier.get(row.tier);
    if (!current) {
      continue;
    }
    current.primaryStorageGb += row.primaryStorageGb;
    current.totalStorageGb += row.totalStorageGb;
    current.primaryShards += row.primaryShards;
    current.totalShards += row.totalShards;
  }

  return TIERS.map((tier) => {
    const values = byTier.get(tier);
    const primaryStorageGb = values?.primaryStorageGb ?? 0;
    const totalStorageGb = values?.totalStorageGb ?? 0;
    const primaryShards = values?.primaryShards ?? 0;
    const totalShards = values?.totalShards ?? 0;

    return {
      tier,
      primaryStorageGb,
      totalStorageGb,
      primaryShards,
      totalShards,
      nodesByStorage: 0,
      nodesByShardsHeap: 0,
      nodesRecommended: 0,
    };
  });
}

export function recommendNodesByTier_storageBased(
  tierResults: TierResult[],
  nodeProfiles: NodeProfiles,
  diskUsableFactor: number,
): TierResult[] {
  return buildStorageReference(tierResults, nodeProfiles, diskUsableFactor);
}

export function recommendNodesByTier_shardsHeapBased(
  tierResults: TierResult[],
  _nodeProfiles: NodeProfiles,
  _constraints: Constraints,
): TierResult[] {
  return tierResults;
}

export function resolveTierNodesByScenario(
  tierResults: TierResult[],
  scenario: ScenarioInput,
): { tiers: TierResult[]; warnings: SizingWarning[] } {
  const withStorageReference = buildStorageReference(
    tierResults,
    scenario.nodeProfiles,
    scenario.overhead.diskUsableFactor,
  );

  const resolved = scenario.nodeSizing.mode === 'auto'
    ? resolveAutoNodes(withStorageReference, scenario)
    : resolveManualNodes(withStorageReference, scenario);

  if (!resolved.fatalNodeLogic) {
    return {
      tiers: resolved.tiers,
      warnings: resolved.warnings,
    };
  }

  return {
    tiers: resolved.tiers.map((tier) => ({
      ...tier,
      nodesRecommended: 0,
    })),
    warnings: [
      ...resolved.warnings,
      {
        level: 'error',
        code: 'NODE_LOGIC_ABORTED',
        message: 'Node count > 1000 detectado. Cálculo de nodos detenido; define nodos manualmente.',
      },
    ],
  };
}

export function recommendMasters(totalDataNodes: number, constraints: Constraints): number {
  if (totalDataNodes > constraints.requireDedicatedMastersWhenDataNodesGt) {
    return Math.max(3, constraints.dedicatedMasters);
  }
  return 0;
}
