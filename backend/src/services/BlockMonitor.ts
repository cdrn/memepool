import { ethers } from "ethers";
import { DataSource } from "typeorm";
import { createComponentLogger } from "../utils/logger";
import { Block } from "../entities/Block";
import { Transaction, TransactionStatus } from "../entities/Transaction";

/**
 * This monitors the eth rpc for block production and does a couple of things
 * 1. Does a limited amount of preprocessing on the block for later use
 * 2. Stores the block in our database for later analysis
 * We can later use these blocks (which need to be up to date with the chain head)
 * in order to conduct analysis and experiments
 */
export class BlockMonitor {
  private provider: ethers.WebSocketProvider;
  private logger = createComponentLogger("BlockMonitor");
  private db: DataSource;
  private isReconnecting = false;
  private requestCount = 0;
  private wsUrl: string;

  constructor(wsUrl: string, db: DataSource) {
    this.wsUrl = wsUrl;
    this.provider = new ethers.WebSocketProvider(wsUrl);
    this.db = db;
  }

  async start() {
    this.logger.info("Starting block monitor");
    try {
      // Test WebSocket connection first
      this.logger.debug("Testing WebSocket connection", {
        endpoint: this.wsUrl,
      });
      await this.provider.getBlockNumber();

      await this.setupBlockSubscription();
    } catch (error) {
      if (error instanceof Error && error.message.includes("ECONNREFUSED")) {
        this.logger.error("Failed to connect to Ethereum node", {
          endpoint: this.wsUrl,
          error: this.formatError(error),
          details:
            "Check if the Ethereum node is running and the WebSocket endpoint is correct",
        });
      } else {
        this.logger.error("Failed to start block monitor", {
          error: this.formatError(error),
          endpoint: this.wsUrl,
        });
      }
      throw error;
    }
  }

  private async setupBlockSubscription() {
    try {
      const blockNumber = await this.provider.getBlockNumber();
      this.logger.info("Connected to Ethereum node", { blockNumber });

      // Subscribe to new blocks
      await (this.provider as any).send("eth_subscribe", ["newHeads"]);
      this.logger.info("Subscribed to new blocks");

      this.provider.on("block", async (blockNumber: number) => {
        await this.handleNewBlock(blockNumber);
      });
    } catch (error) {
      this.logger.error("Failed to setup block subscription", {
        error: this.formatError(error),
      });
      await this.handleConnectionError();
    }
  }

  private async handleNewBlock(blockNumber: number) {
    try {
      const block = await this.provider.getBlock(blockNumber, true);
      if (!block) {
        this.logger.warn("Failed to fetch block details", { blockNumber });
        return;
      }

      await this.storeBlock(block);
    } catch (error) {
      this.logger.error("Failed to process block", {
        blockNumber,
        error: this.formatError(error),
      });
    }
  }

  private async storeBlock(block: ethers.Block) {
    try {
      // Create new block entity
      const blockEntity = new Block();
      blockEntity.number = block.number;
      blockEntity.hash = block.hash || "";
      blockEntity.parentHash = block.parentHash;
      blockEntity.timestamp = new Date(Number(block.timestamp) * 1000);
      blockEntity.miner = block.miner;
      blockEntity.extraData = block.extraData || "";
      blockEntity.gasLimit = block.gasLimit.toString();
      blockEntity.gasUsed = block.gasUsed.toString();
      blockEntity.baseFeePerGas = block.baseFeePerGas?.toString();
      blockEntity.transactionHashes = block.transactions
        .map((tx: string | ethers.TransactionResponse): string | null => {
          if (typeof tx === "string") return tx;
          return tx?.hash || null;
        })
        .filter((hash): hash is string => hash !== null);

      // Save block
      const savedBlock = await this.db.getRepository(Block).save(blockEntity);

      // Update transactions
      const txRepo = this.db.getRepository(Transaction);
      for (const tx of block.transactions as (
        | string
        | ethers.TransactionResponse
      )[]) {
        const txHash = typeof tx === "string" ? tx : tx?.hash;
        if (!txHash) continue;

        await txRepo.update(
          { hash: txHash },
          {
            status: TransactionStatus.INCLUDED,
            blockHash: block.hash || undefined,
            blockNumber: block.number,
            includedAt: blockEntity.timestamp,
            block: savedBlock,
          }
        );
      }

      this.logger.info("Stored block and updated transactions", {
        blockNumber: block.number,
        txCount: block.transactions.length,
        timestamp: blockEntity.timestamp.toISOString(),
        miner: block.miner,
      });
    } catch (error) {
      this.logger.error("Failed to store block", {
        blockNumber: block.number,
        error: this.formatError(error),
      });
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
      await this.setupBlockSubscription();

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

  private formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error);
  }
}
