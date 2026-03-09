import { TierDatasetShard, TierNodePlan, TierResult, TIERS } from '../models/sizing.models';

interface MutableNode {
  nodeName: string;
  clusterIndex: number;
  nodeIndex: number;
  primaries: number;
  replicas: number;
  totalShards: number;
  shards: Array<{ shardKey: string; role: 'primary' | 'replica' }>;
  shardSet: Set<string>;
}

interface NodePlannerOptions {
  forcedNodeCount?: number;
  clusterCount?: number;
  nodesPerCluster?: number;
}

function safeCount(value: number | undefined, fallback: number): number {
  return Math.max(1, Math.round(Number(value) || fallback));
}

function nodeNameForTier(
  tier: string,
  index: number,
  clusterCount: number,
  nodesPerCluster: number,
): { nodeName: string; clusterIndex: number; nodeIndex: number } {
  const clusterIndex = Math.floor(index / nodesPerCluster) + 1;
  const nodeIndex = (index % nodesPerCluster) + 1;

  if (clusterCount <= 1) {
    return {
      nodeName: `${tier}-${index + 1}`,
      clusterIndex: 1,
      nodeIndex,
    };
  }

  return {
    nodeName: `c${clusterIndex}-n${nodeIndex}`,
    clusterIndex,
    nodeIndex,
  };
}

function pickNode(
  nodes: MutableNode[],
  shardKey: string,
  options: { avoidExisting: boolean; avoidCluster?: number },
): MutableNode | null {
  let candidates = options.avoidExisting ? nodes.filter((node) => !node.shardSet.has(shardKey)) : [...nodes];

  if (
    options.avoidCluster
    && candidates.some((node) => node.clusterIndex !== options.avoidCluster)
  ) {
    candidates = candidates.filter((node) => node.clusterIndex !== options.avoidCluster);
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) =>
    a.totalShards - b.totalShards
    || a.clusterIndex - b.clusterIndex
    || a.nodeIndex - b.nodeIndex,
  );
  return candidates[0];
}

export function optional_assignShardsToNodes(
  rows: TierDatasetShard[],
  tiers: TierResult[],
  options?: NodePlannerOptions,
): TierNodePlan[] {
  const plans: TierNodePlan[] = [];
  const tierNodeCount = new Map(tiers.map((tier) => [tier.tier, tier.nodesRecommended]));
  const clusters = safeCount(options?.clusterCount, 1);
  const fixedNodesPerCluster = safeCount(options?.nodesPerCluster, 1);
  const forcedNodeCount = options?.forcedNodeCount ? safeCount(options.forcedNodeCount, 1) : null;

  for (const tier of TIERS) {
    const tierRows = rows.filter((row) => row.tier === tier && row.primaryShards > 0);
    const recommendedNodeCount = tierNodeCount.get(tier) ?? 0;
    const nodeCount = forcedNodeCount ?? recommendedNodeCount;
    const nodesPerCluster = forcedNodeCount
      ? fixedNodesPerCluster
      : Math.max(1, Math.ceil(nodeCount / clusters));

    if (nodeCount <= 0 || tierRows.length === 0) {
      continue;
    }

    const nodes: MutableNode[] = Array.from({ length: nodeCount }, (_, index) => ({
      ...nodeNameForTier(tier, index, clusters, nodesPerCluster),
      primaries: 0,
      replicas: 0,
      totalShards: 0,
      shards: [],
      shardSet: new Set<string>(),
    }));

    for (const row of tierRows) {
      for (let shardIndex = 1; shardIndex <= row.primaryShards; shardIndex += 1) {
        const shardKey = `${row.workloadName}/${row.datasetName}/${tier}/s${shardIndex}`;

        const primaryNode = pickNode(nodes, shardKey, { avoidExisting: false });
        if (!primaryNode) {
          continue;
        }

        primaryNode.shards.push({ shardKey, role: 'primary' });
        primaryNode.primaries += 1;
        primaryNode.totalShards += 1;
        primaryNode.shardSet.add(shardKey);

        for (let replica = 1; replica <= row.replicas; replica += 1) {
          const replicaNode = pickNode(nodes, shardKey, {
            avoidExisting: true,
            avoidCluster: primaryNode.clusterIndex,
          })
            ?? pickNode(nodes, shardKey, { avoidExisting: true })
            ?? pickNode(nodes, shardKey, { avoidExisting: false });
          if (!replicaNode) {
            continue;
          }

          replicaNode.shards.push({ shardKey, role: 'replica' });
          replicaNode.replicas += 1;
          replicaNode.totalShards += 1;
          replicaNode.shardSet.add(shardKey);
        }
      }
    }

    plans.push({
      tier,
      nodes: nodes.map((node) => ({
        nodeName: node.nodeName,
        primaries: node.primaries,
        replicas: node.replicas,
        totalShards: node.totalShards,
        shards: node.shards,
      })),
    });
  }

  return plans;
}
