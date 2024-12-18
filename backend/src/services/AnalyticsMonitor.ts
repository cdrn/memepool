import { ethers } from "ethers";
import { DataSource } from "typeorm";
import { createComponentLogger } from "../utils/logger";
import { ProtocolAnalyzer } from "./ProtocolAnalyzer";
import { BlockPrediction } from "../entities/BlockPrediction";
import pLimit from "p-limit";

export class AnalyticsMonitor {
  private provider: ethers.WebSocketProvider;
  private logger = createComponentLogger("AnalyticsMonitor");
  private db: DataSource;
  private protocolAnalyzer: ProtocolAnalyzer;
  private isProcessing = false;
  private analyzeLimit = pLimit(10); // Limit concurrent transaction analysis
  private pollInterval: NodeJS.Timeout | null = null;

  constructor(wsUrl: string, db: DataSource) {
    this.provider = new ethers.WebSocketProvider(wsUrl);
    this.db = db;
    this.protocolAnalyzer = new ProtocolAnalyzer(this.provider, db);
  }

  async start() {
    this.logger.info("Starting analytics monitor");
    try {
      // Test WebSocket connection first
      this.logger.debug("Testing WebSocket connection");
      await this.provider.getBlockNumber();

      // Start monitoring
      await this.setupAnalytics();

      // Initial processing of any backlog
      await this.processNewData();
    } catch (error) {
      if (error instanceof Error && error.message.includes("ECONNREFUSED")) {
        this.logger.error("Failed to connect to Ethereum node", {
          error: this.formatError(error),
          details:
            "Check if the Ethereum node is running and the WebSocket endpoint is correct",
        });
      } else {
        this.logger.error("Failed to start analytics monitor", {
          error: this.formatError(error),
        });
      }
      throw error;
    }
  }

  private async setupAnalytics() {
    try {
      this.logger.info("Setting up analytics processing");

      // Poll frequently enough to keep up with block time
      // but not so frequently that we overwhelm the system
      this.pollInterval = setInterval(() => {
        if (!this.isProcessing) {
          this.processNewData().catch((error) => {
            this.logger.error("Failed to process data in interval", {
              error: this.formatError(error),
            });
          });
        }
      }, 3000); // Poll every 3 seconds
    } catch (error) {
      this.logger.error("Failed to setup analytics", {
        error: this.formatError(error),
      });
      throw error;
    }
  }

  private async processNewData() {
    if (this.isProcessing) return;

    this.isProcessing = true;
    try {
      // Get unprocessed predictions
      const query = this.db
        .getRepository(BlockPrediction)
        .createQueryBuilder("prediction")
        .where("prediction.transactionDetails IS NOT NULL")
        .andWhere("prediction.metadata IS NULL")
        .orderBy("prediction.blockNumber", "DESC")
        .take(100);

      // Log the query being executed
      this.logger.debug("Executing query", {
        sql: query.getSql(),
        parameters: query.getParameters(),
      });

      const predictions = await query.getMany();

      this.logger.debug(`Found ${predictions.length} unprocessed predictions`, {
        blockNumbers: predictions.map((p) => p.blockNumber),
      });

      if (predictions.length === 0) return;

      this.logger.info(`Processing ${predictions.length} predictions`);

      // Process predictions in parallel
      await Promise.all(
        predictions.map((prediction) => this.analyzePrediction(prediction))
      );

      this.logger.info("Completed processing predictions");
    } catch (error) {
      this.logger.error("Failed to process analytics", {
        error: this.formatError(error),
      });
    } finally {
      this.isProcessing = false;
    }
  }

  private async analyzePrediction(prediction: BlockPrediction) {
    this.logger.debug(
      `Analyzing prediction for block ${prediction.blockNumber}`,
      {
        txCount: prediction.predictedTransactions.length,
      }
    );

    const metadata: Record<string, any> = {
      protocols: {},
      types: {},
      totalValue: "0",
      processedAt: new Date().toISOString(),
    };

    try {
      let analyzedCount = 0;
      let skippedCount = 0;

      // Analyze transactions in parallel with concurrency limit
      await Promise.all(
        prediction.predictedTransactions.map((txHash) =>
          this.analyzeLimit(async () => {
            const txDetails = prediction.transactionDetails[txHash];
            if (!txDetails || (txDetails.protocol && txDetails.type)) {
              skippedCount++;
              return;
            }

            try {
              const tx = {
                hash: txHash,
                to: txDetails.to,
                from: txDetails.from,
                data: txDetails.data || "0x",
                value: txDetails.value || "0",
              };

              const protocolInfo =
                await this.protocolAnalyzer.analyzeTransaction(tx as any);
              if (protocolInfo) {
                analyzedCount++;
                prediction.transactionDetails[txHash] = {
                  ...txDetails,
                  ...protocolInfo,
                };

                if (protocolInfo.protocol) {
                  metadata.protocols[protocolInfo.protocol] =
                    (metadata.protocols[protocolInfo.protocol] || 0) + 1;
                }
                if (protocolInfo.type) {
                  metadata.types[protocolInfo.type] =
                    (metadata.types[protocolInfo.type] || 0) + 1;
                }
                if (protocolInfo.value) {
                  metadata.totalValue = (
                    BigInt(metadata.totalValue) + BigInt(protocolInfo.value)
                  ).toString();
                }
              }
            } catch (error) {
              this.logger.debug("Failed to analyze transaction", {
                error: this.formatError(error),
                txHash,
              });
            }
          })
        )
      );

      this.logger.info(
        `Completed analyzing prediction ${prediction.blockNumber}`,
        {
          analyzedTxs: analyzedCount,
          skippedTxs: skippedCount,
          protocols: Object.keys(metadata.protocols),
          types: Object.keys(metadata.types),
        }
      );

      // Update prediction with new data
      await this.db.getRepository(BlockPrediction).update(
        { id: prediction.id },
        {
          transactionDetails: prediction.transactionDetails,
          metadata,
        }
      );
    } catch (error) {
      this.logger.error("Failed to analyze prediction", {
        error: this.formatError(error),
        predictionId: prediction.id,
      });
    }
  }

  async stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.logger.info("Analytics monitor stopped");
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error);
  }
}
