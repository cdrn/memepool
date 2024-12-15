import { useMemo } from "react";
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
    protocol: string;
    type: string;
    txCount: number;
    totalValue: number;
    gasValue: number;
    methodNames: Set<string>;
  };
}

// Brighter color scheme for better visibility
const PROTOCOL_COLORS = {
  "Uniswap V2": "#FE007A",
  "Uniswap V3": "#FF1493",
  SushiSwap: "#FF69B4",
  "1inch": "#4169E1",
  Balancer: "#40E0D0",
  Curve: "#00CED1",
  AAVE: "#DA70D6",
  Compound: "#32CD32",
  Chainlink: "#1E90FF",
  DEX: "#FF69B4",
  "Liquidity Pool": "#9370DB",
  Bridge: "#FFA500",
  Vault: "#20B2AA",
  "Lending Protocol": "#BA55D3",
  Oracle: "#4682B4",
  "Token Contract": "#778899",
  unknown: "#A9A9A9",
};

export function TransactionAnalytics({
  predictions,
  comparisons,
}: TransactionAnalyticsProps) {
  const data = useMemo(() => {
    if (!predictions.length) return null;

    const latestPrediction = predictions[0];
    console.log("Processing block:", latestPrediction.blockNumber);

    // Group transactions by protocol and type
    const protocolGroups: {
      [key: string]: {
        types: { [key: string]: number };
        txCount: number;
        gasValue: number;
        methodNames: Set<string>;
      };
    } = {};

    let totalBlockValue = 0;

    latestPrediction.predictedTransactions.forEach((txHash) => {
      const details = latestPrediction.transactionDetails[txHash];
      if (!details) return;

      // Convert value from wei to ETH (1e18)
      let value = 0;
      try {
        value = details.value ? Number(BigInt(details.value)) / 1e18 : 0;
      } catch (e) {
        console.log("Error converting value for tx:", txHash, e);
        value = 0;
      }

      // Calculate gas cost in ETH
      const gasLimit = 200000; // Default gas limit if not specified
      const gasValue = (latestPrediction.predictedGasPrice * gasLimit) / 1e9;
      const totalValue = value + gasValue;

      // Skip dust transactions
      if (totalValue <= 0.0001) return;

      totalBlockValue += totalValue;

      const protocol = details.protocol || "unknown";
      const type = details.type || "unknown";
      const category = details.category || "unknown";
      const methodName = details.methodName || "unknown";

      // Create a more descriptive transaction type
      let displayType = type;
      if (type === "transfer" && category) {
        displayType = `${category} ${type}`;
      }

      if (!protocolGroups[protocol]) {
        protocolGroups[protocol] = {
          types: {},
          txCount: 0,
          gasValue: 0,
          methodNames: new Set(),
        };
      }
      if (!protocolGroups[protocol].types[displayType]) {
        protocolGroups[protocol].types[displayType] = 0;
      }
      protocolGroups[protocol].types[displayType] += totalValue;
      protocolGroups[protocol].txCount += 1;
      protocolGroups[protocol].gasValue += gasValue;
      if (methodName) protocolGroups[protocol].methodNames.add(methodName);
    });

    // Convert to treemap format
    const treemapData: TreemapData = {
      id: `Block #${latestPrediction.blockNumber}`,
      value: 0,
      children: [],
    };

    // Sort protocols by total value
    const sortedProtocols = Object.entries(protocolGroups)
      .map(([protocol, data]) => ({
        protocol,
        totalValue: Object.values(data.types).reduce(
          (sum, value) => sum + value,
          0
        ),
        types: data.types,
        txCount: data.txCount,
        gasValue: data.gasValue,
        methodNames: data.methodNames,
      }))
      .sort((a, b) => b.totalValue - a.totalValue);

    sortedProtocols.forEach((protocolData) => {
      // Skip protocols with less than 0.1% of total block value
      if (protocolData.totalValue / totalBlockValue < 0.001) return;

      const protocolNode: TreemapData = {
        id: protocolData.protocol,
        value: 0,
        children: [],
        color:
          PROTOCOL_COLORS[
            protocolData.protocol as keyof typeof PROTOCOL_COLORS
          ] || PROTOCOL_COLORS.unknown,
        rawData: {
          protocol: protocolData.protocol,
          type: "protocol",
          txCount: protocolData.txCount,
          totalValue: protocolData.totalValue,
          gasValue: protocolData.gasValue,
          methodNames: protocolData.methodNames,
        },
      };

      // Sort types by value
      Object.entries(protocolData.types)
        .sort(([, a], [, b]) => b - a)
        .forEach(([type, value]) => {
          protocolNode.children?.push({
            id: `${protocolData.protocol} - ${type}`,
            value: value,
            rawData: {
              protocol: protocolData.protocol,
              type: type,
              txCount: 1, // This is approximate
              totalValue: value,
              gasValue:
                protocolData.gasValue / Object.keys(protocolData.types).length, // Approximate
              methodNames: protocolData.methodNames,
            },
          });
          protocolNode.value += value;
        });

      treemapData.children?.push(protocolNode);
      treemapData.value += protocolNode.value;
    });

    console.log("Treemap data:", treemapData);
    return treemapData;
  }, [predictions]);

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
          const parts = d.id.split(" - ");
          const value = Number(d.value).toFixed(4);
          return parts.length > 1
            ? `${parts[1]} (${value} Ξ)`
            : `${parts[0]} (${value} Ξ)`;
        }}
        tooltip={({ node }) => {
          const data = node.data.rawData;
          if (!data) return null;

          return (
            <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
              <div className="font-medium text-gray-900 dark:text-white">
                {data.protocol}
                {data.type !== "protocol" && ` - ${data.type}`}
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
                {data.methodNames.size > 0 && (
                  <div className="text-gray-600 dark:text-gray-300">
                    Methods: {Array.from(data.methodNames).join(", ")}
                  </div>
                )}
              </div>
            </div>
          );
        }}
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
