import { useEffect, useState } from "react";
import {
  ChartBarIcon,
  ClockIcon,
  CubeIcon,
  SunIcon,
  MoonIcon,
} from "@heroicons/react/24/outline";
import type { BlockPrediction, BlockComparison } from "@shared/types";

// Helper function to format ETH values
const formatEther = (value: string): string => {
  const wei = BigInt(value);
  return (Number(wei) / 1e18).toFixed(4);
};

function App() {
  const [predictions, setPredictions] = useState<BlockPrediction[]>([]);
  const [totalPredictions, setTotalPredictions] = useState(0);
  const [comparisons, setComparisons] = useState<BlockComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedBlock, setSelectedBlock] = useState<BlockPrediction | null>(
    null
  );
  const [isDark, setIsDark] = useState(() =>
    document.documentElement.classList.contains("dark")
  );

  useEffect(() => {
    // Initialize dark mode from system preference
    if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      document.documentElement.classList.add("dark");
      setIsDark(true);
    }
  }, []);

  const toggleDarkMode = () => {
    if (isDark) {
      document.documentElement.classList.remove("dark");
      setIsDark(false);
    } else {
      document.documentElement.classList.add("dark");
      setIsDark(true);
    }
  };

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [predictionsRes, comparisonsRes] = await Promise.all([
          fetch("http://localhost:3001/api/predictions"),
          fetch("http://localhost:3001/api/comparisons"),
        ]);

        if (!predictionsRes.ok || !comparisonsRes.ok) {
          throw new Error("Failed to fetch data from API");
        }

        const predictionsData = await predictionsRes.json();
        const comparisonsData = await comparisonsRes.json();

        setPredictions(predictionsData.predictions);
        setTotalPredictions(predictionsData.totalCount);
        setComparisons(comparisonsData);
        setError(null);
      } catch (error) {
        console.error("Error fetching data:", error);
        setError(
          error instanceof Error ? error.message : "Unknown error occurred"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  const latestComparison = comparisons[0];
  const averageAccuracy =
    comparisons.length > 0
      ? comparisons.reduce((sum, comp) => sum + Number(comp.accuracy), 0) /
        comparisons.length
      : 0;

  const getTransactionType = (tx: string, comparison: BlockComparison) => {
    const inPredicted = comparison.predictedTransactions.includes(tx);
    const inActual = comparison.actualTransactions.includes(tx);
    if (inPredicted && inActual) return "both";
    if (inPredicted) return "predicted";
    return "actual";
  };

  const getTransactionDetails = (
    txHash: string,
    prediction: BlockPrediction
  ) => {
    const details = prediction.transactionDetails?.[txHash];
    if (!details) return null;

    return (
      <div className="text-sm space-y-1">
        <div className="flex flex-wrap gap-2">
          {details.protocol && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
              {details.protocol}
            </span>
          )}
          {details.type && (
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                details.type === "swap"
                  ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                  : details.type === "liquidity"
                  ? "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200"
                  : details.type === "bridge"
                  ? "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200"
                  : details.type === "lending"
                  ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                  : details.type === "sandwich"
                  ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                  : "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200"
              }`}
            >
              {details.type.charAt(0).toUpperCase() + details.type.slice(1)}
            </span>
          )}
          {details.isSandwichTarget && (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200">
              Sandwich Target
            </span>
          )}
        </div>
        {details.methodName && (
          <span className="text-gray-600 dark:text-gray-400 font-mono text-xs">
            {details.methodName}
          </span>
        )}
        {details.value && formatEther(details.value) !== "0.0000" && (
          <span className="text-gray-600 dark:text-gray-400 text-xs">
            Value: {formatEther(details.value)} ETH
          </span>
        )}
      </div>
    );
  };

  // Add transaction type statistics
  const getBlockStats = (prediction: BlockPrediction) => {
    const stats = {
      swap: 0,
      liquidity: 0,
      bridge: 0,
      lending: 0,
      sandwich: 0,
      unknown: 0,
      totalValue: BigInt(0),
    };

    prediction.predictedTransactions.forEach((txHash) => {
      const details = prediction.transactionDetails?.[txHash];
      if (details) {
        if (details.type) {
          stats[details.type as keyof typeof stats]++;
        }
        if (details.value) {
          stats.totalValue += BigInt(details.value);
        }
      }
    });

    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4 mb-6">
        <div className="stat-card">
          <div className="stat-value">{stats.swap}</div>
          <div className="stat-label">Swaps</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.liquidity}</div>
          <div className="stat-label">Liquidity</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.bridge}</div>
          <div className="stat-label">Bridge</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.lending}</div>
          <div className="stat-label">Lending</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.sandwich}</div>
          <div className="stat-label">Sandwich</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">
            {formatEther(stats.totalValue.toString()).slice(0, 6)}
          </div>
          <div className="stat-label">Total ETH</div>
        </div>
      </div>
    );
  };

  const handleComparisonClick = (comparison: BlockComparison) => {
    // Find the corresponding prediction
    const prediction = predictions.find(
      (p) => p.blockNumber === comparison.blockNumber
    );
    if (prediction) {
      setSelectedBlock(prediction);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center dark:bg-gray-900">
        <div className="w-8 h-8 border-2 border-gray-400 border-t-black dark:border-gray-600 dark:border-t-white rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center dark:bg-gray-900">
        <div className="text-red-600 dark:text-red-400 text-lg">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto space-y-16">
        <header className="text-center space-y-4 relative">
          <button
            onClick={toggleDarkMode}
            className="absolute right-0 top-0 p-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            {isDark ? (
              <SunIcon className="w-6 h-6" />
            ) : (
              <MoonIcon className="w-6 h-6" />
            )}
          </button>
          <h1 className="text-4xl font-light tracking-tight text-gray-900 dark:text-white">
            Ethereum Mempool Monitor
          </h1>
          <p className="text-gray-600 dark:text-gray-400 text-lg max-w-2xl mx-auto">
            Analyzing transaction flow and predicting block contents in
            real-time
          </p>
        </header>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
          <div className="space-y-2 text-center">
            <span className="text-3xl font-light text-gray-900 dark:text-white">
              #{latestComparison?.blockNumber || "N/A"}
            </span>
            <p className="text-sm text-gray-600 dark:text-gray-400 font-sans">
              Latest Block
            </p>
          </div>

          <div className="space-y-2 text-center">
            <span className="text-3xl font-light text-gray-900 dark:text-white">
              {averageAccuracy.toFixed(1)}%
            </span>
            <p className="text-sm text-gray-600 dark:text-gray-400 font-sans">
              Average Accuracy
            </p>
          </div>

          <div className="space-y-2 text-center">
            <span className="text-3xl font-light text-gray-900 dark:text-white">
              {totalPredictions}
            </span>
            <p className="text-sm text-gray-600 dark:text-gray-400 font-sans">
              Predictions Made
            </p>
          </div>
        </div>

        {/* Recent Comparisons */}
        <section className="space-y-6">
          <h2 className="text-2xl font-light text-gray-900 dark:text-white">
            Recent Block Comparisons
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 text-sm font-sans">
                  <th className="py-4 text-left font-medium text-gray-600 dark:text-gray-400">
                    Block
                  </th>
                  <th className="py-4 text-left font-medium text-gray-600 dark:text-gray-400">
                    Miner
                  </th>
                  <th className="py-4 text-left font-medium text-gray-600 dark:text-gray-400">
                    Accuracy
                  </th>
                  <th className="py-4 text-left font-medium text-gray-600 dark:text-gray-400">
                    Predicted
                  </th>
                  <th className="py-4 text-left font-medium text-gray-600 dark:text-gray-400">
                    Actual
                  </th>
                </tr>
              </thead>
              <tbody className="font-sans">
                {comparisons.slice(0, 10).map((comparison) => (
                  <tr
                    key={comparison.id}
                    onClick={() => handleComparisonClick(comparison)}
                    className="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-4 text-gray-900 dark:text-white">
                      #{comparison.blockNumber}
                    </td>
                    <td className="py-4 font-mono text-sm text-gray-600 dark:text-gray-400">
                      {comparison.miner.slice(0, 10)}...
                    </td>
                    <td className="py-4">
                      <span
                        className={
                          Number(comparison.accuracy) >= 80
                            ? "text-green-700 dark:text-green-400"
                            : Number(comparison.accuracy) >= 50
                            ? "text-yellow-700 dark:text-yellow-400"
                            : "text-red-700 dark:text-red-400"
                        }
                      >
                        {Number(comparison.accuracy).toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-4 text-gray-900 dark:text-white">
                      {comparison.predictedTransactions.length}
                    </td>
                    <td className="py-4 text-gray-900 dark:text-white">
                      {comparison.actualTransactions.length}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Latest Predictions */}
        <section className="space-y-6">
          <h2 className="text-2xl font-light text-gray-900 dark:text-white">
            Latest Predictions
          </h2>
          {selectedBlock && getBlockStats(selectedBlock)}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 text-sm font-sans">
                  <th className="py-4 text-left font-medium text-gray-600 dark:text-gray-400">
                    Block
                  </th>
                  <th className="py-4 text-left font-medium text-gray-600 dark:text-gray-400">
                    Transactions
                  </th>
                  <th className="py-4 text-left font-medium text-gray-600 dark:text-gray-400">
                    Details
                  </th>
                  <th className="py-4 text-left font-medium text-gray-600 dark:text-gray-400">
                    Gas Price
                  </th>
                  <th className="py-4 text-left font-medium text-gray-600 dark:text-gray-400">
                    Time
                  </th>
                </tr>
              </thead>
              <tbody className="font-sans">
                {predictions.slice(0, 10).map((prediction) => (
                  <tr
                    key={prediction.blockNumber}
                    className="hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                    onClick={() => setSelectedBlock(prediction)}
                  >
                    <td className="py-4 text-gray-900 dark:text-white">
                      #{prediction.blockNumber}
                    </td>
                    <td className="py-4 text-gray-900 dark:text-white">
                      {prediction.predictedTransactions.length}
                    </td>
                    <td className="py-4">
                      <div className="space-y-1">
                        {prediction.predictedTransactions
                          .slice(0, 2)
                          .map((txHash) =>
                            getTransactionDetails(txHash, prediction)
                          )}
                        {prediction.predictedTransactions.length > 2 && (
                          <div className="text-sm text-gray-500 dark:text-gray-400">
                            +{prediction.predictedTransactions.length - 2} more
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-4 text-gray-900 dark:text-white">
                      {prediction.predictedGasPrice} Gwei
                    </td>
                    <td className="py-4 text-gray-600 dark:text-gray-400">
                      {new Date(prediction.createdAt).toLocaleTimeString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Transaction Details Modal */}
        {selectedBlock && (
          <div className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg max-w-4xl w-full max-h-[80vh] overflow-hidden shadow-xl">
              <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                <div className="flex justify-between items-center">
                  <h3 className="text-2xl font-light text-gray-900 dark:text-white">
                    Block #{selectedBlock.blockNumber} Details
                  </h3>
                  <button
                    onClick={() => setSelectedBlock(null)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="p-6 overflow-y-auto max-h-[60vh]">
                <div className="space-y-4">
                  {selectedBlock.predictedTransactions.map((txHash) => (
                    <div
                      key={txHash}
                      className="p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                    >
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="font-mono text-sm text-gray-600 dark:text-gray-400">
                            {txHash}
                          </div>
                          {getTransactionDetails(txHash, selectedBlock)}
                          {selectedBlock.transactionDetails?.[txHash]
                            ?.params && (
                            <div className="mt-2 text-sm">
                              <div className="font-medium text-gray-700 dark:text-gray-300">
                                Parameters:
                              </div>
                              <pre className="mt-1 text-xs bg-gray-100 dark:bg-gray-800 p-2 rounded overflow-x-auto">
                                {JSON.stringify(
                                  selectedBlock.transactionDetails[txHash]
                                    .params,
                                  null,
                                  2
                                )}
                              </pre>
                            </div>
                          )}
                        </div>
                        <a
                          href={`https://etherscan.io/tx/${txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                        >
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                            />
                          </svg>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
