import { ethers } from "ethers";
import { DataSource } from "typeorm";
import { createComponentLogger } from "../utils/logger";
import pLimit from "p-limit";
import { Transaction, TransactionStatus } from "../entities/Transaction";

export class MempoolMonitor {
  private provider: ethers.WebSocketProvider;
  private logger = createComponentLogger("MempoolMonitor");
  private db: DataSource;
  private isReconnecting = false;
  private requestCount = 0;
  private requestLimiter = pLimit(50);
  private wsUrl: string;

  constructor(wsUrl: string, db: DataSource) {
    this.wsUrl = wsUrl;
    this.provider = new ethers.WebSocketProvider(wsUrl);
    this.db = db;
  }

  async start() {
    this.logger.info("Starting mempool monitor");
    try {
      // Test WebSocket connection first
      this.logger.debug("Testing WebSocket connection", {
        endpoint: this.wsUrl,
      });
      await this.provider.getBlockNumber();

      await this.setupMempoolSubscription();
    } catch (error) {
      if (error instanceof Error && error.message.includes("ECONNREFUSED")) {
        this.logger.error("Failed to connect to Ethereum node", {
          endpoint: this.wsUrl,
          error: this.formatError(error),
          details:
            "Check if the Ethereum node is running and the WebSocket endpoint is correct",
        });
      } else {
        this.logger.error("Failed to start mempool monitor", {
          error: this.formatError(error),
          endpoint: this.wsUrl,
        });
      }
      throw error;
    }
  }

  private async setupMempoolSubscription() {
    try {
      // Subscribe to pending transactions
      await (this.provider as any).send("eth_subscribe", [
        "newPendingTransactions",
      ]);
      this.logger.info("Subscribed to pending transactions in the mempool");

      let pendingCount = 0;
      const startTime = Date.now();

      // Log stats every minute instead of every 10 seconds
      setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        this.logger.info("Mempool stats", {
          totalTransactions: pendingCount,
          transactionsPerSecond: (pendingCount / elapsed).toFixed(2),
        });
      }, 60000);

      this.provider.on("pending", async (txHash: string) => {
        pendingCount++;
        await this.handlePendingTransaction(txHash);
      });
    } catch (error) {
      this.logger.error("Failed to setup mempool subscription", {
        error: this.formatError(error),
      });
      await this.handleConnectionError();
    }
  }

  private async handlePendingTransaction(txHash: string) {
    try {
      await this.requestLimiter(async () => {
        // First check if we already have this transaction
        const existing = await this.db.getRepository(Transaction).findOne({
          where: { hash: txHash },
        });

        if (existing) {
          // Skip if we already have it
          return;
        }

        const tx = await this.provider.getTransaction(txHash);
        if (!tx) return;

        await this.storePendingTransaction(tx);
      });
    } catch (error) {
      if (this.isRateLimitError(error)) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        this.logger.error("Failed to process pending transaction", {
          txHash,
          error: this.formatError(error),
        });
      }
    }
  }

  private async storePendingTransaction(tx: ethers.TransactionResponse) {
    try {
      const transaction = new Transaction();
      transaction.hash = tx.hash;
      transaction.from = tx.from;
      transaction.to = tx.to || undefined;
      transaction.value = tx.value.toString();
      transaction.gasLimit = tx.gasLimit.toString();
      transaction.maxFeePerGas = tx.maxFeePerGas?.toString();
      transaction.maxPriorityFeePerGas = tx.maxPriorityFeePerGas?.toString();
      transaction.gasPrice = tx.gasPrice?.toString();
      transaction.data = tx.data;
      transaction.nonce = tx.nonce;
      transaction.status = TransactionStatus.PENDING;

      await this.db.getRepository(Transaction).save(transaction);

      // Only log every 100th transaction to reduce noise
      if (Math.random() < 0.01) {
        this.logger.info("Sample pending transaction", {
          txHash: tx.hash,
          from: tx.from,
          to: tx.to || "contract creation",
          value: tx.value.toString(),
          gasPrice: (tx.gasPrice || tx.maxFeePerGas || 0n).toString(),
        });
      }
    } catch (error: unknown) {
      // Check if error is an object with a message property
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      // Only log if it's not a duplicate key error
      if (!errorMessage.includes("duplicate key")) {
        this.logger.error("Failed to store pending transaction", {
          txHash: tx.hash,
          error: this.formatError(error),
        });
      }
    }
  }

  private async handleConnectionError() {
    if (this.isReconnecting) return;

    this.isReconnecting = true;
    try {
      this.logger.warn("Connection lost, attempting to reconnect in 5 seconds");
      await new Promise((resolve) => setTimeout(resolve, 5000));

      this.provider.removeAllListeners();
      await this.provider.destroy();

      this.provider = new ethers.WebSocketProvider(this.wsUrl);
      await this.setupMempoolSubscription();

      this.logger.info("Successfully reconnected");
    } catch (error) {
      this.logger.error("Failed to reconnect", {
        error: this.formatError(error),
      });
      setTimeout(() => this.handleConnectionError(), 10000);
    } finally {
      this.isReconnecting = false;
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

  private formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error);
  }
}
