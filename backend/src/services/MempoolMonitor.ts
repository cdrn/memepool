import { ethers } from "ethers";
import { Logger } from "winston";
import { DataSource } from "typeorm";
import { BlockPrediction } from "../entities/BlockPrediction";
import { BlockComparison } from "../entities/BlockComparison";
import { ProtocolAnalyzer } from "./ProtocolAnalyzer";
import pLimit from "p-limit";

interface LogContext {
  blockNumber?: number;
  txHash?: string;
  error?: any;
  requestId?: string;
  txCount?: number;
  gasLimit?: string;
  avgGasPrice?: string;
  gasUsed?: string;
  component?: string;
  wsUrl?: string;
  baseFee?: string;
  to?: string;
  value?: string;
  gasPrice?: string;
  predictedTxCount?: number;
  id?: number;
  details?: number;
  pendingTxCount?: number;
  groupCount?: number;
  totalTxs?: number;
  maxFee?: string;
  nextBaseFee?: string;
  priorityFee?: string;
  groupSize?: number;
  totalGasUsed?: string;
  targetGasUsed?: string;
  type?: string;
  protocol?: string;
}

export class MempoolMonitor {
  private provider: ethers.WebSocketProvider;
  private logger: Logger;
  private db: DataSource;
  private pendingTransactions: Map<string, ethers.TransactionResponse> =
    new Map();
  private blockPredictions: Map<number, string[]> = new Map();
  private lastBlockGasLimit: bigint = BigInt(30000000);
  private lastBaseFee: bigint = BigInt(0);
  private baseFeeTrend: number[] = [];
  private protocolAnalyzer: ProtocolAnalyzer;
  private requestLimiter = pLimit(50);
  private isReconnecting = false;
  private wsUrl: string;
  private requestCount = 0;
  private analysisCache: Map<string, any> = new Map();
  private lastAnalysisTime: Map<string, number> = new Map();

  constructor(wsUrl: string, logger: Logger, db: DataSource) {
    this.wsUrl = wsUrl;
    this.logger = logger;
    this.db = db;
    this.provider = new ethers.WebSocketProvider(wsUrl);
    this.protocolAnalyzer = new ProtocolAnalyzer(this.provider, logger, db);
  }

  private log(level: string, message: string, context: LogContext = {}) {
    const requestId = context.requestId || `req_${++this.requestCount}`;
    this.logger.log(level, message, {
      ...context,
      requestId,
      timestamp: new Date().toISOString(),
      component: "MempoolMonitor",
    });
  }

  async start() {
    this.log("info", "Starting mempool monitor");
    await this.setupWebSocket();
  }

  private async setupWebSocket() {
    try {
      this.log("info", "Setting up WebSocket connection...");

      // Test the connection by getting the latest block
      const blockNumber = await this.provider.getBlockNumber();
      this.log("info", "Connected to Ethereum node", {
        blockNumber,
        wsUrl: this.wsUrl,
      });

      // Subscribe to pending transactions
      await (this.provider as any).send("eth_subscribe", [
        "newPendingTransactions",
      ]);
      this.log("info", "Subscribed to pending transactions");

      // Monitor new pending transactions with throttling
      this.provider.on("pending", async (txHash: string) => {
        this.log("debug", "Received pending transaction", { txHash });
        try {
          await this.requestLimiter(async () => {
            const tx = await this.provider.getTransaction(txHash);
            if (tx) {
              this.pendingTransactions.set(txHash, tx);
              await this.predictNextBlock();
              this.log("debug", "Processed pending transaction", {
                txHash,
                to: tx.to || undefined,
                value: tx.value.toString(),
                gasPrice: (
                  tx.gasPrice ||
                  tx.maxFeePerGas ||
                  BigInt(0)
                ).toString(),
              });
            }
          });
        } catch (error) {
          if (this.isRateLimitError(error)) {
            this.log("warn", "Rate limit hit, throttling requests", { txHash });
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } else {
            this.log("error", "Failed to process pending transaction", {
              txHash,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      });

      // Monitor new blocks with throttling
      this.provider.on("block", async (blockNumber: number) => {
        this.log("info", "New block received", { blockNumber });
        try {
          await this.requestLimiter(async () => {
            const block = await this.provider.getBlock(blockNumber, true);
            if (block) {
              this.lastBlockGasLimit = block.gasLimit;
              this.lastBaseFee = block.baseFeePerGas || BigInt(0);
              await this.compareWithPrediction(block);
              await this.cleanupOldTransactions(block);
              await this.predictNextBlock();
              this.log("info", "Processed new block", {
                blockNumber,
                txCount: block.transactions.length,
                gasLimit: block.gasLimit.toString(),
                baseFee: (block.baseFeePerGas || BigInt(0)).toString(),
                predictedTxCount: this.pendingTransactions.size,
              });
            }
          });
        } catch (error) {
          if (this.isRateLimitError(error)) {
            this.log("warn", "Rate limit hit while processing block", {
              blockNumber,
            });
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } else {
            this.log("error", "Failed to process block", {
              blockNumber,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      });
    } catch (error) {
      this.log("error", "Failed to setup WebSocket connection", {
        error: error instanceof Error ? error.message : String(error),
        wsUrl: this.wsUrl,
      });
      await this.handleWebSocketError();
    }
  }

  private async handleWebSocketError() {
    if (this.isReconnecting) return;

    this.isReconnecting = true;
    try {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      this.log("info", "Attempting to reconnect WebSocket");

      this.provider.removeAllListeners();
      await this.provider.destroy();

      this.provider = new ethers.WebSocketProvider(this.wsUrl);
      this.protocolAnalyzer = new ProtocolAnalyzer(
        this.provider,
        this.logger,
        this.db
      );

      await this.setupWebSocket();
      this.log("info", "Successfully reconnected WebSocket");
    } catch (error) {
      this.log("error", "Failed to reconnect WebSocket", { error });
      setTimeout(() => this.handleWebSocketError(), 10000);
    } finally {
      this.isReconnecting = false;
    }
  }

  private async handleNewBlock(block: ethers.Block) {
    try {
      // Update base fee tracking
      if (block.baseFeePerGas) {
        this.lastBaseFee = block.baseFeePerGas;
        this.baseFeeTrend.push(Number(block.baseFeePerGas));
        // Keep last 10 blocks for trend analysis
        if (this.baseFeeTrend.length > 10) {
          this.baseFeeTrend.shift();
        }
      }

      // Update gas limit if changed
      if (block.gasLimit !== this.lastBlockGasLimit) {
        this.lastBlockGasLimit = block.gasLimit;
      }

      await this.compareWithPrediction(block);
      await this.cleanupOldTransactions(block);
      await this.predictNextBlock();
    } catch (error) {
      this.log("error", "Error handling new block", { error });
    }
  }

  private getEffectivePriorityFee(tx: ethers.TransactionResponse): bigint {
    const maxPriorityFeePerGas = tx.maxPriorityFeePerGas || BigInt(0);
    const maxFeePerGas = tx.maxFeePerGas || BigInt(0);
    const gasPrice = tx.gasPrice || BigInt(0);

    // For EIP-1559 transactions
    if (maxPriorityFeePerGas > BigInt(0)) {
      // Calculate effective priority fee considering maxFeePerGas cap
      const availableFeeForTip = maxFeePerGas - this.lastBaseFee;
      return availableFeeForTip > maxPriorityFeePerGas
        ? maxPriorityFeePerGas
        : availableFeeForTip > BigInt(0)
        ? availableFeeForTip
        : BigInt(0);
    }

    // For legacy transactions, estimate priority fee as 10% of gas price
    if (gasPrice > BigInt(0)) {
      return (gasPrice * BigInt(10)) / BigInt(100);
    }

    return BigInt(0);
  }

  private async predictNextBlock() {
    this.log("debug", "Starting next block prediction", {
      pendingTxCount: this.pendingTransactions.size,
    });

    const nextBaseFee = this.estimateNextBaseFee();
    const pendingTxs = Array.from(this.pendingTransactions.values());

    // Group transactions by their effective priority fee
    const txsByPriority = new Map<bigint, ethers.TransactionResponse[]>();

    for (const tx of pendingTxs) {
      if (tx.maxFeePerGas && tx.maxFeePerGas < nextBaseFee) {
        this.log("debug", "Skipping transaction due to low max fee", {
          txHash: tx.hash,
          maxFee: tx.maxFeePerGas.toString(),
          nextBaseFee: nextBaseFee.toString(),
        });
        continue;
      }

      const priorityFee = this.getEffectivePriorityFee(tx);
      const existing = txsByPriority.get(priorityFee) || [];
      existing.push(tx);
      txsByPriority.set(priorityFee, existing);
    }

    // Sort groups by priority fee
    const sortedGroups = Array.from(txsByPriority.entries()).sort(([a], [b]) =>
      Number(b - a)
    );

    this.log("debug", "Grouped transactions by priority", {
      groupCount: sortedGroups.length,
      totalTxs: pendingTxs.length,
      nextBaseFee: nextBaseFee.toString(),
    });

    const predictedTxs: string[] = [];
    let totalGasUsed = BigInt(0);
    const gasLimit = this.lastBlockGasLimit;
    const targetGasUsed = (gasLimit * BigInt(85)) / BigInt(100);

    const transactionDetails: Record<string, any> = {};
    const swapTxs = new Set<string>();
    const transferTxs = new Set<string>();

    // Process transactions in priority order with rate limiting and caching
    for (const [priorityFee, txGroup] of sortedGroups) {
      this.log("debug", "Processing transaction group", {
        priorityFee: priorityFee.toString(),
        groupSize: txGroup.length,
      });

      for (const tx of txGroup) {
        const txGasLimit = tx.gasLimit || BigInt(0);
        if (totalGasUsed + txGasLimit > targetGasUsed) {
          this.log("debug", "Block gas limit reached", {
            totalGasUsed: totalGasUsed.toString(),
            targetGasUsed: targetGasUsed.toString(),
          });
          continue;
        }

        let analysis;
        // Check cache first
        if (this.analysisCache.has(tx.hash)) {
          analysis = this.analysisCache.get(tx.hash);
        } else {
          try {
            // Rate limited analysis
            analysis = await this.requestLimiter(async () => {
              const result = await this.protocolAnalyzer.analyzeTransaction(tx);
              if (result) {
                this.analysisCache.set(tx.hash, result);
                this.lastAnalysisTime.set(tx.hash, Date.now());
              }
              return result;
            });
          } catch (error) {
            if (this.isRateLimitError(error)) {
              this.log("warn", "Rate limit hit, skipping analysis", {
                txHash: tx.hash,
              });
              continue;
            }
            throw error;
          }
        }

        if (analysis) {
          if (analysis.type === "swap") swapTxs.add(tx.hash);
          if (analysis.type === "transfer") transferTxs.add(tx.hash);
          transactionDetails[tx.hash] = analysis;
          this.log("debug", "Analyzed transaction", {
            txHash: tx.hash,
            type: analysis.type,
            protocol: analysis.protocol || "unknown",
          });
        }

        predictedTxs.push(tx.hash);
        totalGasUsed += txGasLimit;

        if (totalGasUsed >= targetGasUsed) break;
      }
      if (totalGasUsed >= targetGasUsed) break;
    }

    // Clean up old cache entries (older than 1 hour)
    const now = Date.now();
    for (const [hash, time] of this.lastAnalysisTime.entries()) {
      if (now - time > 3600000) {
        this.analysisCache.delete(hash);
        this.lastAnalysisTime.delete(hash);
      }
    }

    // Look for sandwich opportunities
    if (swapTxs.size > 0) {
      const sandwichPairs = this.findSandwichOpportunities(
        Array.from(swapTxs).map((hash) => this.pendingTransactions.get(hash)!)
      );
      // Prioritize sandwich transactions
      sandwichPairs.forEach((pair) => {
        if (!predictedTxs.includes(pair.frontrun.hash)) {
          predictedTxs.unshift(pair.frontrun.hash);
          transactionDetails[pair.frontrun.hash] = {
            ...transactionDetails[pair.frontrun.hash],
            type: "sandwich",
            isSandwichTarget: false,
          };
        }
        if (!predictedTxs.includes(pair.target.hash)) {
          const targetIndex = predictedTxs.findIndex(
            (hash) =>
              this.getEffectivePriorityFee(
                this.pendingTransactions.get(hash)!
              ) < this.getEffectivePriorityFee(pair.target)
          );
          predictedTxs.splice(targetIndex, 0, pair.target.hash);
          transactionDetails[pair.target.hash] = {
            ...transactionDetails[pair.target.hash],
            type: "sandwich",
            isSandwichTarget: true,
          };
        }
        if (!predictedTxs.includes(pair.backrun.hash)) {
          predictedTxs.push(pair.backrun.hash);
          transactionDetails[pair.backrun.hash] = {
            ...transactionDetails[pair.backrun.hash],
            type: "sandwich",
            isSandwichTarget: false,
          };
        }
      });
    }

    const nextBlockNumber = (await this.provider.getBlockNumber()) + 1;
    this.blockPredictions.set(nextBlockNumber, predictedTxs);

    const avgGasPrice =
      predictedTxs.length > 0
        ? predictedTxs.reduce((sum: bigint, hash: string) => {
            const tx = this.pendingTransactions.get(hash);
            return sum + (tx ? this.getEffectivePriorityFee(tx) : BigInt(0));
          }, BigInt(0)) / BigInt(predictedTxs.length)
        : BigInt(0);

    await this.storePrediction(
      nextBlockNumber,
      predictedTxs,
      avgGasPrice,
      transactionDetails
    );

    this.log("debug", "Generated block prediction", {
      blockNumber: nextBlockNumber,
      txCount: predictedTxs.length,
      avgGasPrice: avgGasPrice.toString(),
      gasUsed: totalGasUsed.toString(),
      gasLimit: gasLimit.toString(),
    });
  }

  private estimateNextBaseFee(): bigint {
    if (this.baseFeeTrend.length === 0 || !this.lastBaseFee) {
      return BigInt(100000000); // 0.1 gwei default if no data
    }

    // Calculate base fee trend
    const trend =
      this.baseFeeTrend.length > 1
        ? (this.baseFeeTrend[this.baseFeeTrend.length - 1] -
            this.baseFeeTrend[0]) /
          this.baseFeeTrend.length
        : 0;

    // Estimate next base fee with trend
    const estimatedChange =
      (this.lastBaseFee * BigInt(trend > 0 ? 1125 : 875)) / BigInt(1000);
    return trend > 0
      ? this.lastBaseFee + estimatedChange // Increasing trend
      : this.lastBaseFee - estimatedChange; // Decreasing trend
  }

  private calculateAccuracy(predicted: string[], actual: string[]): number {
    if (predicted.length === 0) return 0;

    let score = 0;
    const predictedSet = new Set(predicted);
    const actualSet = new Set(actual);

    // Calculate exact matches
    const exactMatches = predicted.filter((tx) => actualSet.has(tx));
    score += exactMatches.length * 100;

    // Calculate partial matches (similar transactions)
    const remainingPredicted = predicted.filter((tx) => !actualSet.has(tx));
    const remainingActual = actual.filter((tx) => !predictedSet.has(tx));

    for (const predictedTx of remainingPredicted) {
      const txDetails = this.pendingTransactions.get(predictedTx);
      if (!txDetails) continue;

      // Look for similar transactions (same type, similar value, etc)
      for (const actualTx of remainingActual) {
        const actualDetails = this.pendingTransactions.get(actualTx);
        if (!actualDetails) continue;

        if (this.areSimilarTransactions(txDetails, actualDetails)) {
          score += 50; // Partial match
          break;
        }
      }
    }

    return score / predicted.length;
  }

  private areSimilarTransactions(
    tx1: ethers.TransactionResponse,
    tx2: ethers.TransactionResponse
  ): boolean {
    // Same to address
    if (tx1.to !== tx2.to) return false;

    // Similar gas price (within 10%)
    const price1 = this.getEffectivePriorityFee(tx1);
    const price2 = this.getEffectivePriorityFee(tx2);
    const priceDiff = price1 > price2 ? price1 - price2 : price2 - price1;
    if (priceDiff > (price1 * BigInt(10)) / BigInt(100)) return false;

    // Similar value (within 5%)
    const value1 = tx1.value || BigInt(0);
    const value2 = tx2.value || BigInt(0);
    const valueDiff = value1 > value2 ? value1 - value2 : value2 - value1;
    if (valueDiff > (value1 * BigInt(5)) / BigInt(100)) return false;

    // Similar data (first 4 bytes - function signature)
    const sig1 = tx1.data.slice(0, 10);
    const sig2 = tx2.data.slice(0, 10);
    if (sig1 !== sig2) return false;

    return true;
  }

  private findSandwichOpportunities(
    swapTxs: ethers.TransactionResponse[]
  ): Array<{
    frontrun: ethers.TransactionResponse;
    target: ethers.TransactionResponse;
    backrun: ethers.TransactionResponse;
  }> {
    const opportunities: Array<{
      frontrun: ethers.TransactionResponse;
      target: ethers.TransactionResponse;
      backrun: ethers.TransactionResponse;
    }> = [];

    // Group swaps by token pairs
    const swapsByPair = new Map<string, ethers.TransactionResponse[]>();

    for (const tx of swapTxs) {
      const tokenPair = this.getTokenPair(tx);
      if (!tokenPair) continue;

      const existing = swapsByPair.get(tokenPair) || [];
      existing.push(tx);
      swapsByPair.set(tokenPair, existing);
    }

    // Look for sandwich opportunities in each token pair
    for (const [_, pairTxs] of swapsByPair) {
      if (pairTxs.length < 3) continue;

      // Sort by gas price
      pairTxs.sort((a, b) =>
        Number(
          this.getEffectivePriorityFee(b) - this.getEffectivePriorityFee(a)
        )
      );

      // Find potential targets (large swaps with lower gas price)
      for (let i = 1; i < pairTxs.length - 1; i++) {
        const target = pairTxs[i];
        const targetValue = target.value || BigInt(0);

        // Only consider large swaps as targets
        if (targetValue < BigInt(1e17)) continue; // 0.1 ETH minimum

        opportunities.push({
          frontrun: pairTxs[0],
          target,
          backrun: pairTxs[pairTxs.length - 1],
        });
      }
    }

    return opportunities;
  }

  private getTokenPair(tx: ethers.TransactionResponse): string | null {
    try {
      // Extract token addresses from common DEX function calls
      const data = tx.data;
      if (data.length < 138) return null;

      // Extract two token addresses from the data
      const token1 = "0x" + data.slice(34, 74);
      const token2 = "0x" + data.slice(98, 138);

      // Sort addresses to ensure consistent pairing
      return [token1.toLowerCase(), token2.toLowerCase()].sort().join("-");
    } catch {
      return null;
    }
  }

  private isRateLimitError(error: any): boolean {
    return (
      error?.error?.code === 429 ||
      error?.code === 429 ||
      (error?.message &&
        error.message.includes(
          "exceeded the maximum number of concurrent requests"
        ))
    );
  }

  private async compareWithPrediction(block: ethers.Block) {
    const prediction = this.blockPredictions.get(block.number);
    if (!prediction) return;

    const actualTxs = block.transactions
      .map((tx: string | ethers.TransactionResponse) =>
        typeof tx === "string" ? tx : tx.hash
      )
      .filter((hash): hash is string => hash !== null);

    const comparison = {
      blockNumber: block.number,
      predictedTxs: prediction,
      actualTxs,
      accuracy: this.calculateAccuracy(prediction, actualTxs),
      miner: block.miner,
      timestamp: new Date(),
    };

    // Store comparison in database
    await this.storeComparison(comparison);
    this.blockPredictions.delete(block.number);
  }

  private async cleanupOldTransactions(block: ethers.Block) {
    // Remove transactions that made it into the block
    block.transactions.forEach((tx: string | ethers.TransactionResponse) => {
      const txHash = typeof tx === "string" ? tx : tx.hash;
      if (txHash) {
        this.pendingTransactions.delete(txHash);
        this.analysisCache.delete(txHash);
        this.lastAnalysisTime.delete(txHash);
      }
    });

    // Remove old predictions
    const currentBlock = block.number;
    for (const [blockNum] of this.blockPredictions) {
      if (blockNum < currentBlock - 5) {
        this.blockPredictions.delete(blockNum);
      }
    }
  }

  private convertBigIntToString(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === "bigint") {
      return obj.toString();
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.convertBigIntToString(item));
    }

    if (typeof obj === "object") {
      return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [
          key,
          this.convertBigIntToString(value),
        ])
      );
    }

    return obj;
  }

  private convertStringToBigInt(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }

    // Check if string is a valid numeric string that could be a BigInt
    if (typeof obj === "string" && /^\d+$/.test(obj)) {
      try {
        return BigInt(obj);
      } catch {
        return obj;
      }
    }

    if (Array.isArray(obj)) {
      return obj.map((item) => this.convertStringToBigInt(item));
    }

    if (typeof obj === "object") {
      return Object.fromEntries(
        Object.entries(obj).map(([key, value]) => [
          key,
          this.convertStringToBigInt(value),
        ])
      );
    }

    return obj;
  }

  private async storePrediction(
    blockNumber: number,
    txs: string[],
    avgGasPrice: bigint,
    transactionDetails: { [txHash: string]: any }
  ) {
    try {
      this.log("debug", "Attempting to store prediction", {
        blockNumber,
        txCount: txs.length,
        avgGasPrice: avgGasPrice.toString(),
      });

      // Convert parameters that might contain BigInt to regular numbers
      const processedDetails = Object.fromEntries(
        Object.entries(transactionDetails).map(([hash, details]) => [
          hash,
          {
            ...details,
            params: details.params
              ? this.convertBigIntToString(details.params)
              : undefined,
          },
        ])
      );

      const prediction = new BlockPrediction();
      prediction.blockNumber = blockNumber;
      prediction.predictedTransactions = txs;
      prediction.predictedGasPrice = Number(avgGasPrice) / 1e9; // Convert to Gwei
      prediction.transactionDetails = processedDetails;

      const savedPrediction = await this.db
        .getRepository(BlockPrediction)
        .save(prediction);
      this.log("info", `Stored prediction for block ${blockNumber}`, {
        blockNumber,
        txCount: txs.length,
        id: savedPrediction.id,
        details: Object.keys(processedDetails).length,
      });
    } catch (error) {
      this.log("error", "Error storing prediction:", {
        error: error instanceof Error ? error.message : String(error),
        blockNumber,
        txCount: txs.length,
      });
    }
  }

  private async loadPrediction(
    blockNumber: number
  ): Promise<BlockPrediction | null> {
    try {
      const prediction = await this.db
        .getRepository(BlockPrediction)
        .findOne({ where: { blockNumber } });

      if (prediction && prediction.transactionDetails) {
        // Convert stored string values back to BigInt where appropriate
        prediction.transactionDetails = Object.fromEntries(
          Object.entries(prediction.transactionDetails).map(
            ([hash, details]) => [
              hash,
              {
                ...details,
                params: details.params
                  ? this.convertStringToBigInt(details.params)
                  : undefined,
              },
            ]
          )
        );
      }

      return prediction;
    } catch (error) {
      this.log("error", "Error loading prediction:", { error });
      return null;
    }
  }

  private async storeComparison(comparison: {
    blockNumber: number;
    predictedTxs: string[];
    actualTxs: string[];
    accuracy: number;
    miner: string;
    timestamp: Date;
  }) {
    try {
      const blockComparison = new BlockComparison();
      blockComparison.blockNumber = comparison.blockNumber;
      blockComparison.predictedTransactions = comparison.predictedTxs;
      blockComparison.actualTransactions = comparison.actualTxs;
      blockComparison.accuracy = comparison.accuracy;
      blockComparison.miner = comparison.miner;
      blockComparison.timestamp = comparison.timestamp;

      await this.db.getRepository(BlockComparison).save(blockComparison);
      this.log("info", `Stored comparison for block ${comparison.blockNumber}`);
    } catch (error) {
      this.log("error", "Error storing comparison:", { error });
    }
  }
}
