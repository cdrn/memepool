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
    token: string;
    symbol: string;
    txCount: number;
    totalValue: number;
    gasValue: number;
    methodNames: Set<string>;
  };
}

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
  const data = useMemo(() => {
    if (!predictions.length) return null;

    const latestPrediction = predictions[0];
    console.log("Processing block:", latestPrediction.blockNumber);

    // Group transactions by token
    const tokenGroups: {
      [key: string]: {
        symbol: string;
        txCount: number;
        totalValue: number;
        gasValue: number;
        methodNames: Set<string>;
        protocols: Set<string>;
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

      // Get token information from the transaction details
      const token = details.token || "ETH";
      const symbol = details.tokenSymbol || token;
      const protocol = details.protocol || "unknown";
      const methodName = details.methodName || "unknown";

      if (!tokenGroups[token]) {
        tokenGroups[token] = {
          symbol,
          txCount: 0,
          totalValue: 0,
          gasValue: 0,
          methodNames: new Set(),
          protocols: new Set(),
        };
      }

      tokenGroups[token].totalValue += totalValue;
      tokenGroups[token].txCount += 1;
      tokenGroups[token].gasValue += gasValue;
      if (methodName) tokenGroups[token].methodNames.add(methodName);
      if (protocol) tokenGroups[token].protocols.add(protocol);
    });

    // Convert to treemap format
    const treemapData: TreemapData = {
      id: `Block #${latestPrediction.blockNumber}`,
      value: 0,
      children: [],
    };

    // Sort tokens by total value
    const sortedTokens = Object.entries(tokenGroups)
      .map(([token, data]) => ({
        token,
        symbol: data.symbol,
        totalValue: data.totalValue,
        txCount: data.txCount,
        gasValue: data.gasValue,
        methodNames: data.methodNames,
        protocols: data.protocols,
      }))
      .sort((a, b) => b.totalValue - a.totalValue);

    sortedTokens.forEach((tokenData) => {
      // Skip tokens with less than 0.1% of total block value
      if (tokenData.totalValue / totalBlockValue < 0.001) return;

      const tokenNode: TreemapData = {
        id: tokenData.token,
        value: tokenData.totalValue,
        color:
          TOKEN_COLORS[tokenData.symbol as keyof typeof TOKEN_COLORS] ||
          TOKEN_COLORS.unknown,
        rawData: {
          token: tokenData.token,
          symbol: tokenData.symbol,
          txCount: tokenData.txCount,
          totalValue: tokenData.totalValue,
          gasValue: tokenData.gasValue,
          methodNames: tokenData.methodNames,
        },
      };

      treemapData.children?.push(tokenNode);
      treemapData.value += tokenNode.value;
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
          const rawData = d.data.rawData;
          const value = Number(d.value).toFixed(4);
          return rawData
            ? `${rawData.symbol} (${value} Ξ)`
            : `${d.id} (${value} Ξ)`;
        }}
        tooltip={({ node }) => {
          const data = node.data.rawData;
          if (!data) return null;

          return (
            <div className="bg-white dark:bg-gray-800 p-3 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700">
              <div className="font-medium text-gray-900 dark:text-white">
                {data.symbol} ({data.token})
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
        colors={(node) => node.data.color || TOKEN_COLORS.unknown}
        theme={{
          background: "transparent",
          textColor: "#fff",
          fontSize: 12,
        }}
      />
    </div>
  );
}
