import { ethers } from "ethers";
import { Logger } from "winston";
import { DataSource } from "typeorm";
import { BlockPrediction } from "../entities/BlockPrediction";
import { BlockComparison } from "../entities/BlockComparison";

export class MempoolMonitor {
  private provider: ethers.WebSocketProvider;
  private logger: Logger;
  private db: DataSource;
  private pendingTransactions: Map<string, ethers.TransactionResponse> =
    new Map();
  private blockPredictions: Map<number, string[]> = new Map();

  constructor(wsUrl: string, logger: Logger, db: DataSource) {
    this.provider = new ethers.WebSocketProvider(wsUrl);
    this.logger = logger;
    this.db = db;
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
          await this.compareWithPrediction(block);
          await this.cleanupOldTransactions(block);
        }
      } catch (error) {
        this.logger.error("Error processing new block:", error);
      }
    });
  }

  private async predictNextBlock() {
    // Simple prediction based on gas price ordering
    const sortedTxs = Array.from(this.pendingTransactions.values()).sort(
      (a, b) => {
        const aGasPrice = a.gasPrice ? Number(a.gasPrice) : 0;
        const bGasPrice = b.gasPrice ? Number(b.gasPrice) : 0;
        return bGasPrice - aGasPrice;
      }
    );

    const predictedTxs = sortedTxs.slice(0, 100).map((tx) => tx.hash);
    const nextBlockNumber = (await this.provider.getBlockNumber()) + 1;
    this.blockPredictions.set(nextBlockNumber, predictedTxs);

    // Store prediction in database
    await this.storePrediction(nextBlockNumber, predictedTxs);
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

  private async storePrediction(blockNumber: number, txs: string[]) {
    try {
      const prediction = new BlockPrediction();
      prediction.blockNumber = blockNumber;
      prediction.predictedTransactions = txs;
      prediction.predictedGasPrice = 0; // TODO: Calculate average gas price

      await this.db.getRepository(BlockPrediction).save(prediction);
      this.logger.info(`Stored prediction for block ${blockNumber}`);
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
