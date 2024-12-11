import { ethers } from "ethers";
import { Logger } from "winston";
import { DataSource } from "typeorm";
import { BlockPrediction } from "../entities/BlockPrediction";
import { BlockComparison } from "../entities/BlockComparison";
import { ProtocolAnalyzer } from "./ProtocolAnalyzer";

export class MempoolMonitor {
  private provider: ethers.WebSocketProvider;
  private logger: Logger;
  private db: DataSource;
  private pendingTransactions: Map<string, ethers.TransactionResponse> =
    new Map();
  private blockPredictions: Map<number, string[]> = new Map();
  private lastBlockGasLimit: bigint = BigInt(30000000); // Default gas limit
  private protocolAnalyzer: ProtocolAnalyzer;

  constructor(wsUrl: string, logger: Logger, db: DataSource) {
    this.provider = new ethers.WebSocketProvider(wsUrl);
    this.logger = logger;
    this.db = db;
    this.protocolAnalyzer = new ProtocolAnalyzer(this.provider, logger);
  }

  async start() {
    this.logger.info("Starting mempool monitor");

    // Monitor new pending transactions
    this.provider.on("pending", async (txHash: string) => {
      try {
        const tx = await this.provider.getTransaction(txHash);
        if (tx) {
          this.pendingTransactions.set(txHash, tx);
          await this.predictNextBlock();
        }
      } catch (error) {
        this.logger.error("Error processing pending transaction:", error);
      }
    });

    // Monitor new blocks
    this.provider.on("block", async (blockNumber: number) => {
      try {
        const block = await this.provider.getBlock(blockNumber, true);
        if (block) {
          this.lastBlockGasLimit = block.gasLimit;
          await this.compareWithPrediction(block);
          await this.cleanupOldTransactions(block);
        }
      } catch (error) {
        this.logger.error("Error processing new block:", error);
      }
    });
  }

  private async predictNextBlock() {
    // Sort transactions by effective gas price (max fee for EIP-1559 txs)
    const sortedTxs = Array.from(this.pendingTransactions.values()).sort(
      (a, b) => {
        const aPrice = this.getEffectiveGasPrice(a);
        const bPrice = this.getEffectiveGasPrice(b);
        return Number(bPrice - aPrice); // Higher price first
      }
    );

    // Predict transactions that will fit in the block
    const predictedTxs: string[] = [];
    let totalGasUsed = BigInt(0);
    const gasLimit = this.lastBlockGasLimit;
    const targetGasUsed = (gasLimit * BigInt(95)) / BigInt(100); // Target 95% of gas limit

    // Store transaction details for protocol analysis
    const transactionDetails: { [txHash: string]: any } = {};

    for (const tx of sortedTxs) {
      const gasLimit = tx.gasLimit || BigInt(0);

      // Skip if this transaction would exceed target gas
      if (totalGasUsed + gasLimit > targetGasUsed) {
        continue;
      }

      // Analyze transaction for protocol and sandwich patterns
      const analysis = await this.protocolAnalyzer.analyzeTransaction(tx);
      if (analysis) {
        transactionDetails[tx.hash] = analysis;
      }

      predictedTxs.push(tx.hash);
      totalGasUsed += gasLimit;

      // Stop if we've reached target gas usage
      if (totalGasUsed >= targetGasUsed) {
        break;
      }
    }

    const nextBlockNumber = (await this.provider.getBlockNumber()) + 1;
    this.blockPredictions.set(nextBlockNumber, predictedTxs);

    // Calculate average gas price for predicted transactions
    const avgGasPrice =
      predictedTxs.length > 0
        ? predictedTxs.reduce((sum, hash) => {
            const tx = this.pendingTransactions.get(hash);
            return sum + (tx ? this.getEffectiveGasPrice(tx) : BigInt(0));
          }, BigInt(0)) / BigInt(predictedTxs.length)
        : BigInt(0);

    // Store prediction in database with transaction details
    await this.storePrediction(
      nextBlockNumber,
      predictedTxs,
      avgGasPrice,
      transactionDetails
    );
  }

  private getEffectiveGasPrice(tx: ethers.TransactionResponse): bigint {
    // For EIP-1559 transactions
    if (tx.maxFeePerGas) {
      return tx.maxFeePerGas;
    }
    // For legacy transactions
    return tx.gasPrice || BigInt(0);
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

  private async storePrediction(
    blockNumber: number,
    txs: string[],
    avgGasPrice: bigint,
    transactionDetails: { [txHash: string]: any }
  ) {
    try {
      const prediction = new BlockPrediction();
      prediction.blockNumber = blockNumber;
      prediction.predictedTransactions = txs;
      prediction.predictedGasPrice = Number(avgGasPrice);
      prediction.transactionDetails = transactionDetails;

      await this.db.getRepository(BlockPrediction).save(prediction);
      this.logger.info(
        `Stored prediction for block ${blockNumber} with ${txs.length} transactions`
      );
    } catch (error) {
      this.logger.error("Error storing prediction:", error);
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
      this.logger.info(`Stored comparison for block ${comparison.blockNumber}`);
    } catch (error) {
      this.logger.error("Error storing comparison:", error);
    }
  }
}
