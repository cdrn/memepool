import { DataSource } from "typeorm";
import { createComponentLogger } from "../utils/logger";
import { Transaction, TransactionStatus } from "../entities/Transaction";
import { BlockPrediction } from "../entities/BlockPrediction";
import { ethers } from "ethers";

export class PredictionService {
  private logger = createComponentLogger("PredictionService");
  private db: DataSource;
  private provider: ethers.Provider;
  private predictionInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(provider: ethers.Provider, db: DataSource) {
    this.provider = provider;
    this.db = db;
  }

  async start() {
    this.logger.info("Starting prediction service");

    // Create predictions every 3 seconds
    this.predictionInterval = setInterval(() => {
      if (!this.isProcessing) {
        this.createPrediction().catch((error) => {
          this.logger.error("Failed to create prediction", {
            error: this.formatError(error),
          });
        });
      }
    }, 3000);
  }

  private async createPrediction() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      // Get current block number
      const blockNumber = await this.provider.getBlockNumber();
      const nextBlockNumber = blockNumber + 1;

      // Get current base fee and estimate next block's base fee
      const block = await this.provider.getBlock(blockNumber);
      if (!block || !block.baseFeePerGas) {
        throw new Error("Could not get current block or base fee");
      }

      // Get pending transactions ordered by effective gas price
      const pendingTxs = await this.db
        .getRepository(Transaction)
        .createQueryBuilder("tx")
        .where("tx.status = :status", { status: TransactionStatus.PENDING })
        .orderBy(
          "CAST(COALESCE(tx.maxFeePerGas, tx.gasPrice) AS numeric)",
          "DESC"
        )
        .getMany();

      if (pendingTxs.length === 0) {
        this.logger.debug("No pending transactions to predict");
        return;
      }

      // Estimate next block's base fee (simple EIP-1559 calculation)
      const currentBaseFee = BigInt(block.baseFeePerGas);
      const targetGasUsed = BigInt(block.gasLimit) / 2n;
      const actualGasUsed = BigInt(block.gasUsed);

      let nextBaseFee = currentBaseFee;
      if (actualGasUsed > targetGasUsed) {
        nextBaseFee += (nextBaseFee * 12n) / 8n;
      } else {
        nextBaseFee -= (nextBaseFee * 1n) / 8n;
      }

      // Select transactions for next block
      const selectedTxs: Transaction[] = [];
      let totalGasUsed = 0n;
      const maxGasLimit = BigInt(block.gasLimit);
      const txDetails: Record<string, any> = {};

      for (const tx of pendingTxs) {
        const gasLimit = BigInt(tx.gasLimit);
        if (totalGasUsed + gasLimit > maxGasLimit) continue;

        // Check if transaction can afford the next block's base fee
        const maxFeePerGas = tx.maxFeePerGas
          ? BigInt(tx.maxFeePerGas)
          : BigInt(tx.gasPrice || "0");
        const maxPriorityFeePerGas = tx.maxPriorityFeePerGas
          ? BigInt(tx.maxPriorityFeePerGas)
          : 0n;

        if (maxFeePerGas >= nextBaseFee + maxPriorityFeePerGas) {
          selectedTxs.push(tx);
          totalGasUsed += gasLimit;

          // Store transaction details
          txDetails[tx.hash] = {
            from: tx.from,
            to: tx.to,
            value: tx.value,
            gasLimit: tx.gasLimit,
            maxFeePerGas: tx.maxFeePerGas,
            maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
            gasPrice: tx.gasPrice,
            data: tx.data,
            nonce: tx.nonce,
          };
        }
      }

      // Create and store prediction
      const prediction = new BlockPrediction();
      prediction.blockNumber = nextBlockNumber;
      prediction.predictedTransactions = selectedTxs.map((tx) => tx.hash);
      prediction.predictedGasPrice = nextBaseFee.toString();
      prediction.transactionDetails = txDetails;

      await this.db.getRepository(BlockPrediction).save(prediction);

      this.logger.info("Created prediction for next block", {
        blockNumber: nextBlockNumber,
        txCount: selectedTxs.length,
        baseFee: nextBaseFee.toString(),
      });
    } catch (error) {
      this.logger.error("Failed to create prediction", {
        error: this.formatError(error),
      });
    } finally {
      this.isProcessing = false;
    }
  }

  async stop() {
    if (this.predictionInterval) {
      clearInterval(this.predictionInterval);
      this.predictionInterval = null;
    }
    this.logger.info("Prediction service stopped");
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error);
  }
}
