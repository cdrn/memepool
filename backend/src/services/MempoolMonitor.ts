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
}

export class MempoolMonitor {
  private provider: ethers.WebSocketProvider;
  private logger: Logger;
  private db: DataSource;
  private pendingTransactions: Map<string, ethers.TransactionResponse> =
    new Map();
  private blockPredictions: Map<number, string[]> = new Map();
  private lastBlockGasLimit: bigint = BigInt(30000000);
  private protocolAnalyzer: ProtocolAnalyzer;
  private requestLimiter = pLimit(150);
  private isReconnecting = false;
  private wsUrl: string;
  private requestCount = 0;

  constructor(wsUrl: string, logger: Logger, db: DataSource) {
    this.wsUrl = wsUrl;
    this.logger = logger;
    this.db = db;
    this.provider = new ethers.WebSocketProvider(wsUrl);
    this.protocolAnalyzer = new ProtocolAnalyzer(this.provider, logger);
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
      const ws = (this.provider as any).websocket;
      if (ws) {
        ws.on("error", async (error: Error) => {
          this.log("error", "WebSocket error occurred", { error });
          await this.handleWebSocketError();
        });

        ws.on("close", async () => {
          this.log("warn", "WebSocket connection closed");
          await this.handleWebSocketError();
        });
      }

      // Monitor new pending transactions with throttling
      this.provider.on("pending", async (txHash: string) => {
        try {
          await this.requestLimiter(async () => {
            const tx = await this.provider.getTransaction(txHash);
            if (tx) {
              this.pendingTransactions.set(txHash, tx);
              await this.predictNextBlock();
              this.log("debug", "Processed pending transaction", { txHash });
            }
          });
        } catch (error) {
          if (this.isRateLimitError(error)) {
            this.log("warn", "Rate limit hit, throttling requests", { txHash });
            await new Promise((resolve) => setTimeout(resolve, 1000));
          } else {
            this.log("error", "Failed to process pending transaction", {
              txHash,
              error,
            });
          }
        }
      });

      // Monitor new blocks with throttling
      this.provider.on("block", async (blockNumber: number) => {
        try {
          await this.requestLimiter(async () => {
            const block = await this.provider.getBlock(blockNumber, true);
            if (block) {
              this.lastBlockGasLimit = block.gasLimit;
              await this.compareWithPrediction(block);
              await this.cleanupOldTransactions(block);
              this.log("info", "Processed new block", {
                blockNumber,
                txCount: block.transactions.length,
                gasLimit: block.gasLimit.toString(),
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
              error,
            });
          }
        }
      });
    } catch (error) {
      this.log("error", "Failed to setup WebSocket connection", { error });
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
      this.protocolAnalyzer = new ProtocolAnalyzer(this.provider, this.logger);

      await this.setupWebSocket();
      this.log("info", "Successfully reconnected WebSocket");
    } catch (error) {
      this.log("error", "Failed to reconnect WebSocket", { error });
      setTimeout(() => this.handleWebSocketError(), 10000);
    } finally {
      this.isReconnecting = false;
    }
  }

  private async predictNextBlock() {
    const sortedTxs = Array.from(this.pendingTransactions.values()).sort(
      (a, b) => {
        const aPrice = this.getEffectiveGasPrice(a);
        const bPrice = this.getEffectiveGasPrice(b);
        return Number(bPrice - aPrice);
      }
    );

    const predictedTxs: string[] = [];
    let totalGasUsed = BigInt(0);
    const gasLimit = this.lastBlockGasLimit;
    const targetGasUsed = (gasLimit * BigInt(95)) / BigInt(100);

    const transactionDetails: Record<string, any> = {};

    for (const tx of sortedTxs) {
      const txGasLimit = tx.gasLimit || BigInt(0);
      if (totalGasUsed + txGasLimit > targetGasUsed) continue;

      const analysis = await this.protocolAnalyzer.analyzeTransaction(tx);
      if (analysis) {
        transactionDetails[tx.hash] = analysis;
      }

      predictedTxs.push(tx.hash);
      totalGasUsed += txGasLimit;

      if (totalGasUsed >= targetGasUsed) break;
    }

    const nextBlockNumber = (await this.provider.getBlockNumber()) + 1;
    this.blockPredictions.set(nextBlockNumber, predictedTxs);

    const avgGasPrice =
      predictedTxs.length > 0
        ? predictedTxs.reduce((sum: bigint, hash: string) => {
            const tx = this.pendingTransactions.get(hash);
            return sum + (tx ? this.getEffectiveGasPrice(tx) : BigInt(0));
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

  private getEffectiveGasPrice(tx: ethers.TransactionResponse): bigint {
    return tx.maxFeePerGas || tx.gasPrice || BigInt(0);
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

  private calculateAccuracy(predicted: string[], actual: string[]): number {
    if (predicted.length === 0) return 0;
    const correctPredictions = predicted.filter((tx) => actual.includes(tx));
    return (correctPredictions.length / predicted.length) * 100;
  }

  private async cleanupOldTransactions(block: ethers.Block) {
    // Remove transactions that made it into the block
    block.transactions.forEach((tx: string | ethers.TransactionResponse) => {
      const txHash = typeof tx === "string" ? tx : tx.hash;
      if (txHash) {
        this.pendingTransactions.delete(txHash);
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

      await this.db.getRepository(BlockPrediction).save(prediction);
      this.log(
        "debug",
        `Stored prediction for block ${blockNumber} with ${txs.length} transactions`
      );
    } catch (error) {
      this.log("error", "Error storing prediction:", { error });
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
