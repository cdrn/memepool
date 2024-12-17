import { ethers } from "ethers";
import { DataSource } from "typeorm";
import { createComponentLogger } from "../utils/logger";
import { ProtocolAnalyzer } from "./ProtocolAnalyzer";
import { BlockPrediction } from "../entities/BlockPrediction";

export class AnalyticsMonitor {
  private provider: ethers.WebSocketProvider;
  private logger = createComponentLogger("AnalyticsMonitor");
  private db: DataSource;
  private protocolAnalyzer: ProtocolAnalyzer;
  private requestCount = 0;
  private wsUrl: string;

  constructor(wsUrl: string, db: DataSource) {
    this.wsUrl = wsUrl;
    this.provider = new ethers.WebSocketProvider(wsUrl);
    this.db = db;
    this.protocolAnalyzer = new ProtocolAnalyzer(this.provider, db);
  }

  private log(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    context: Record<string, any> = {}
  ) {
    const requestId = context.requestId || `req_${++this.requestCount}`;
    this.logger[level](message, {
      ...context,
      requestId,
      timestamp: new Date().toISOString(),
    });
  }

  async start() {
    this.log("info", "Starting analytics monitor");
    try {
      // Test WebSocket connection first
      this.log("debug", "Testing WebSocket connection", {
        endpoint: this.wsUrl,
      });
      await this.provider.getBlockNumber();

      await this.setupAnalytics();
    } catch (error) {
      if (error instanceof Error && error.message.includes("ECONNREFUSED")) {
        this.log("error", "Failed to connect to Ethereum node", {
          endpoint: this.wsUrl,
          error: this.formatError(error),
          details:
            "Check if the Ethereum node is running and the WebSocket endpoint is correct",
        });
      } else {
        this.log("error", "Failed to start analytics monitor", {
          error: this.formatError(error),
          endpoint: this.wsUrl,
        });
      }
      throw error;
    }
  }

  private async setupAnalytics() {
    try {
      // Initialize analytics processing
      this.log("info", "Setting up analytics processing");

      // Start periodic analysis
      setInterval(() => this.processNewData(), 30000); // Run every 30 seconds
    } catch (error) {
      this.log("error", "Failed to setup analytics", {
        error: this.formatError(error),
      });
    }
  }

  private async processNewData() {
    try {
      // 1. Get recent unprocessed predictions
      const predictions = await this.db
        .getRepository(BlockPrediction)
        .createQueryBuilder("prediction")
        .leftJoinAndSelect("prediction.block", "block")
        .where("prediction.transactionDetails IS NOT NULL")
        .andWhere("prediction.metadata IS NULL") // Use metadata to track if we've analyzed this prediction
        .orderBy("prediction.blockNumber", "DESC")
        .take(50)
        .getMany();

      this.log("debug", `Processing ${predictions.length} predictions`);

      for (const prediction of predictions) {
        const metadata: Record<string, any> = {
          protocols: {},
          types: {},
          totalValue: "0",
          processedAt: new Date().toISOString(),
        };

        // 2. Analyze each predicted transaction
        for (const txHash of prediction.predictedTransactions) {
          const txDetails = prediction.transactionDetails[txHash];
          if (!txDetails) continue;

          // 3. Get protocol information if not already present
          if (!txDetails.protocol || !txDetails.type) {
            try {
              // Reconstruct transaction object for analysis
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
                // Update transaction details with protocol information
                prediction.transactionDetails[txHash] = {
                  ...txDetails,
                  ...protocolInfo,
                };

                // Update metadata counters
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
              this.log("debug", "Failed to analyze transaction", {
                error: this.formatError(error),
                txHash,
              });
            }
          }
        }

        // 4. Update prediction with new metadata
        try {
          await this.db.getRepository(BlockPrediction).update(
            { id: prediction.id },
            {
              transactionDetails: prediction.transactionDetails,
              metadata,
            }
          );
        } catch (error) {
          this.log("error", "Failed to update prediction with analytics", {
            error: this.formatError(error),
            predictionId: prediction.id,
          });
        }
      }

      this.log("debug", "Completed processing predictions");
    } catch (error) {
      this.log("error", "Failed to process analytics", {
        error: this.formatError(error),
      });
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error);
  }
}
