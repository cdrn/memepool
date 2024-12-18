import { useMemo, useCallback } from "react";
import { ResponsiveTreeMap } from "@nivo/treemap";
import type { BlockPrediction, BlockComparison } from "@shared/types";

interface TransactionAnalyticsProps {
  predictions: BlockPrediction[];
  comparisons: BlockComparison[];
}

interface TreemapData {
  id: string;
  value: number;
  children?: TreemapData[];
  color?: string;
  rawData?: {
    token: string;
    symbol: string;
    txCount: number;
    totalValue: number;
    gasValue: number;
    methodNames: Set<string>;
    protocols: Set<string>;
    types: Set<string>;
  };
}

// Color scheme for different protocols
const PROTOCOL_COLORS = {
  uniswap: "#FF007A",
  sushiswap: "#FA52A0",
  curve: "#0594EE",
  balancer: "#1E1E1E",
  aave: "#B6509E",
  compound: "#00D395",
  maker: "#1AAB9B",
  chainlink: "#2A5ADA",
  unknown: "#A9A9A9",
} as const;

// Color scheme for different token types
const TOKEN_COLORS = {
  ETH: "#627EEA", // Ethereum blue
  WETH: "#627EEA", // Same as ETH
  USDC: "#2775CA", // USDC blue
  USDT: "#26A17B", // Tether green
  DAI: "#F5AC37", // DAI gold
  WBTC: "#F7931A", // Bitcoin orange
  UNI: "#FF007A", // Uniswap pink
  LINK: "#2A5ADA", // Chainlink blue
  AAVE: "#B6509E", // AAVE purple
  COMP: "#00D395", // Compound green
  MKR: "#1AAB9B", // Maker green
  SNX: "#00D1FF", // Synthetix blue
  YFI: "#006AE3", // Yearn blue
  SUSHI: "#FA52A0", // Sushiswap pink
  unknown: "#A9A9A9", // Gray for unknown tokens
};

export function TransactionAnalytics({
  predictions,
  comparisons,
}: TransactionAnalyticsProps) {
  const processData = useCallback((prediction: BlockPrediction) => {
    console.log("Processing block:", prediction.blockNumber);

    // Group transactions by protocol instead of token
    const protocolGroups: {
      [key: string]: {
        txCount: number;
        totalValue: number;
        gasValue: number;
        methodNames: Set<string>;
        tokens: Set<string>;
        types: Set<string>;
      };
    } = {};

    let totalBlockValue = 0;

    prediction.predictedTransactions.forEach((txHash) => {
      const details = prediction.transactionDetails[txHash];
      if (!details) return;

      // Convert value from wei to ETH (1e18)
      let value = 0;
      try {
        value = details.value ? Number(BigInt(details.value)) / 1e18 : 0;
      } catch (e) {
        console.log("Error converting value for tx:", txHash, e);
        value = 0;
      }

      // Use actual gas limit from transaction if available
      const gasLimit = details.gasLimit ? Number(details.gasLimit) : 200000;
      const gasValue = (prediction.predictedGasPrice * gasLimit) / 1e9;
      const totalValue = value + gasValue;

      // Skip dust transactions
      if (totalValue <= 0.0001) return;

      totalBlockValue += totalValue;

      // Group by protocol
      const protocol = details.protocol || "unknown";
      if (!protocolGroups[protocol]) {
        protocolGroups[protocol] = {
          txCount: 0,
          totalValue: 0,
          gasValue: 0,
          methodNames: new Set(),
          tokens: new Set(),
          types: new Set(),
        };
      }

      protocolGroups[protocol].totalValue += totalValue;
      protocolGroups[protocol].txCount += 1;
      protocolGroups[protocol].gasValue += gasValue;
      if (details.methodName)
        protocolGroups[protocol].methodNames.add(details.methodName);
      if (details.token) protocolGroups[protocol].tokens.add(details.token);
      if (details.type) protocolGroups[protocol].types.add(details.type);
    });

    // Convert to treemap format
    const treemapData: TreemapData = {
      id: `Block #${prediction.blockNumber}`,
      value: 0,
      children: [],
    };

    // Sort protocols by total value
    const sortedProtocols = Object.entries(protocolGroups)
      .map(([protocol, data]) => ({
        protocol,
        totalValue: data.totalValue,
        txCount: data.txCount,
        gasValue: data.gasValue,
        methodNames: data.methodNames,
        tokens: data.tokens,
        types: data.types,
      }))
      .sort((a, b) => b.totalValue - a.totalValue);

    sortedProtocols.forEach((protocolData) => {
      // Skip protocols with less than 0.1% of total block value
      if (protocolData.totalValue / totalBlockValue < 0.001) return;

      const protocolNode: TreemapData = {
        id: protocolData.protocol,
        value: protocolData.totalValue,
        color:
          PROTOCOL_COLORS[
            protocolData.protocol.toLowerCase() as keyof typeof PROTOCOL_COLORS
          ] || PROTOCOL_COLORS.unknown,
        rawData: {
          token: Array.from(protocolData.tokens).join(", "),
          symbol: protocolData.protocol,
          txCount: protocolData.txCount,
          totalValue: protocolData.totalValue,
          gasValue: protocolData.gasValue,
          methodNames: protocolData.methodNames,
          protocols: new Set([protocolData.protocol]),
          types: protocolData.types,
        },
      };

      treemapData.children?.push(protocolNode);
      treemapData.value += protocolNode.value;
    });

    return treemapData;
  }, []);

  const data = useMemo(() => {
    if (!predictions.length) return null;
    return processData(predictions[0]);
  }, [predictions, processData]);

  const renderTooltip = useCallback(({ node }: { node: any }) => {
    const data = node.data.rawData;
    if (!data) return null;

    return (
      <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
        <div className="font-medium text-gray-900 dark:text-white">
          {data.symbol}
        </div>
        <div className="mt-2 space-y-1 text-sm">
          <div className="text-gray-600 dark:text-gray-300">
            Value: {data.totalValue.toFixed(4)} Ξ
          </div>
          <div className="text-gray-600 dark:text-gray-300">
            Gas Cost: {data.gasValue.toFixed(4)} Ξ
          </div>
          <div className="text-gray-600 dark:text-gray-300">
            Transactions: {data.txCount}
          </div>
          {data.types.size > 0 && (
            <div className="text-gray-600 dark:text-gray-300">
              Types: {Array.from(data.types).join(", ")}
            </div>
          )}
          {data.token && (
            <div className="text-gray-600 dark:text-gray-300">
              Tokens: {data.token}
            </div>
          )}
          {data.methodNames.size > 0 && (
            <div className="text-gray-600 dark:text-gray-300 font-mono text-xs">
              Methods: {Array.from(data.methodNames).join(", ")}
            </div>
          )}
        </div>
      </div>
    );
  }, []);

  if (!data) {
    return <div>No data available</div>;
  }

  return (
    <div className="relative h-[600px] w-full dark:bg-gray-800 rounded-lg overflow-hidden">
      <ResponsiveTreeMap
        data={data}
        identity="id"
        value="value"
        valueFormat=".4f"
        margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
        labelSkipSize={32}
        label={(d) => {
          const rawData = d.data.rawData;
          const value = Number(d.value).toFixed(4);
          return rawData
            ? `${rawData.symbol} (${value} Ξ)`
            : `${d.id} (${value} Ξ)`;
        }}
        tooltip={renderTooltip}
        labelTextColor={{ from: "color", modifiers: [["darker", 3]] }}
        parentLabelPosition="left"
        parentLabelTextColor={{ from: "color", modifiers: [["darker", 3]] }}
        borderColor={{ from: "color", modifiers: [["darker", 0.1]] }}
        colors={(node) => node.data.color || PROTOCOL_COLORS.unknown}
        theme={{
          background: "transparent",
          textColor: "#fff",
          fontSize: 12,
        }}
      />
    </div>
  );
}
