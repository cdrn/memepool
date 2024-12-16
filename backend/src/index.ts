import express from "express";
import cors from "cors";
import { DataSource } from "typeorm";
import { config } from "dotenv";
import { MempoolMonitor } from "./services/MempoolMonitor";
import { BlockPrediction } from "./entities/BlockPrediction";
import { BlockComparison } from "./entities/BlockComparison";
import { ContractCache } from "./entities/ContractCache";
import { logger, createComponentLogger } from "./utils/logger";

// Load environment variables
config();

const appLogger = createComponentLogger("App");

// Database configuration
const dataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "memepool",
  entities: [BlockPrediction, BlockComparison, ContractCache],
  synchronize: true,
  logging: ["error", "query", "schema"],
  logger: {
    log: (level: string, message: string) => {
      logger.log(level === "warn" ? "warn" : "debug", `[Database] ${message}`);
    },
    logQuery: (query: string, parameters?: any[]) => {
      logger.debug("[Database] Query", { query, parameters });
    },
    logQueryError: (
      error: string | Error,
      query: string,
      parameters?: any[]
    ) => {
      logger.error("[Database] Query Error", { error, query, parameters });
    },
    logQuerySlow: (time: number, query: string, parameters?: any[]) => {
      logger.warn("[Database] Slow Query", { time, query, parameters });
    },
    logSchemaBuild: (message: string) => {
      logger.debug("[Database] Schema", { message });
    },
    logMigration: (message: string) => {
      logger.info("[Database] Migration", { message });
    },
  },
});

// Express app setup
const app = express();
app.use(cors());
app.use(express.json());

// API Routes
app.get("/api/predictions", async (req, res) => {
  try {
    const [predictions, totalCount] = await Promise.all([
      dataSource
        .getRepository(BlockPrediction)
        .createQueryBuilder("prediction")
        .select()
        .orderBy("prediction.blockNumber", "DESC")
        .take(100)
        .getMany(),
      dataSource.getRepository(BlockPrediction).count(),
    ]);

    appLogger.debug("Fetched predictions", {
      count: predictions.length,
      totalCount,
      latestBlock: predictions[0]?.blockNumber,
      oldestBlock: predictions[predictions.length - 1]?.blockNumber,
      samplePrediction: predictions[0]
        ? {
            blockNumber: predictions[0].blockNumber,
            txCount: predictions[0].predictedTransactions.length,
            detailsCount: Object.keys(predictions[0].transactionDetails || {})
              .length,
          }
        : null,
    });

    res.json({
      predictions,
      totalCount,
    });
  } catch (error) {
    appLogger.error("Error fetching predictions", { error });
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/comparisons", async (req, res) => {
  try {
    const comparisons = await dataSource
      .getRepository(BlockComparison)
      .createQueryBuilder("comparison")
      .select()
      .orderBy("comparison.blockNumber", "DESC")
      .take(100)
      .getMany();

    appLogger.debug("Fetched comparisons", {
      count: comparisons.length,
      latestBlock: comparisons[0]?.blockNumber,
      oldestBlock: comparisons[comparisons.length - 1]?.blockNumber,
      accuracies: comparisons.map((c) => c.accuracy),
      sampleComparison: comparisons[0]
        ? {
            blockNumber: comparisons[0].blockNumber,
            predictedCount: comparisons[0].predictedTransactions.length,
            actualCount: comparisons[0].actualTransactions.length,
            accuracy: comparisons[0].accuracy,
          }
        : null,
    });

    res.json(comparisons);
  } catch (error) {
    appLogger.error("Error fetching comparisons", { error });
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start the application
async function startApp() {
  try {
    // Initialize database connection
    await dataSource.initialize();
    appLogger.info("Database connection established");

    // Drop and recreate tables if needed
    try {
      await dataSource.query('DROP TABLE IF EXISTS "contract_cache" CASCADE');
      await dataSource.synchronize();
      appLogger.info("Database schema synchronized");
    } catch (error) {
      appLogger.error("Error synchronizing database schema", { error });
      process.exit(1);
    }

    // Start mempool monitor
    const monitor = new MempoolMonitor(
      process.env.ETH_WS_URL || "ws://localhost:8546",
      dataSource
    );
    await monitor.start();

    // Start express server
    const port = process.env.PORT || 3001;
    app.listen(port, () => {
      appLogger.info(`Server running on port ${port}`);
    });
  } catch (error) {
    appLogger.error("Failed to start application", { error });
    process.exit(1);
  }
}

startApp();
