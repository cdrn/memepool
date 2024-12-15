import express from "express";
import cors from "cors";
import { createLogger, format, transports } from "winston";
import { DataSource } from "typeorm";
import { config } from "dotenv";
import { MempoolMonitor } from "./services/MempoolMonitor";
import { BlockPrediction } from "./entities/BlockPrediction";
import { BlockComparison } from "./entities/BlockComparison";
import { ContractCache } from "./entities/ContractCache";

// Load environment variables
config();

// Configure logger
const logger = createLogger({
  format: format.combine(
    format.timestamp(),
    format.colorize(),
    format.printf(({ level, message, timestamp, ...metadata }) => {
      // Color the timestamp in gray
      const coloredTimestamp = `\x1b[90m${timestamp}\x1b[0m`;

      // Color the metadata based on level
      let metaColor = "\x1b[36m"; // cyan by default
      if (level.includes("error")) metaColor = "\x1b[31m"; // red
      if (level.includes("warn")) metaColor = "\x1b[33m"; // yellow

      let msg = `${coloredTimestamp} ${level} ${message}`;
      if (Object.keys(metadata).length > 0) {
        const metaStr = Object.entries(metadata)
          .filter(([key]) => key !== "component") // Skip component as we include it in the prefix
          .map(([key, value]) => `${key}=${value}`)
          .join(" ");
        if (metaStr) msg += ` ${metaColor}| ${metaStr}\x1b[0m`;
      }
      return msg;
    })
  ),
  transports: [
    new transports.Console({
      format: format.combine(
        format.colorize(),
        format.timestamp(),
        format.printf(({ level, message, timestamp, ...metadata }) => {
          const coloredTimestamp = `\x1b[90m${timestamp}\x1b[0m`;
          let metaColor = "\x1b[36m";
          if (level.includes("error")) metaColor = "\x1b[31m";
          if (level.includes("warn")) metaColor = "\x1b[33m";

          let msg = `${coloredTimestamp} ${level} ${message}`;
          if (Object.keys(metadata).length > 0) {
            const metaStr = Object.entries(metadata)
              .filter(([key]) => key !== "component")
              .map(([key, value]) => `${key}=${value}`)
              .join(" ");
            if (metaStr) msg += ` ${metaColor}| ${metaStr}\x1b[0m`;
          }
          return msg;
        })
      ),
    }),
    new transports.File({
      filename: "error.log",
      level: "error",
      format: format.uncolorize(), // Remove colors for file output
    }),
    new transports.File({
      filename: "combined.log",
      format: format.uncolorize(), // Remove colors for file output
    }),
  ],
});

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
  logging: ["error"],
});

// Express app setup
const app = express();
app.use(cors());
app.use(express.json());

// API Routes
app.get("/api/predictions", async (req, res) => {
  try {
    const [predictions, totalCount] = await Promise.all([
      dataSource.getRepository(BlockPrediction).find({
        order: { blockNumber: "DESC" },
        take: 100,
      }),
      dataSource.getRepository(BlockPrediction).count(),
    ]);

    res.json({
      predictions,
      totalCount,
    });
  } catch (error) {
    logger.error("Error fetching predictions:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/comparisons", async (req, res) => {
  try {
    const comparisons = await dataSource.getRepository(BlockComparison).find({
      order: { blockNumber: "DESC" },
      take: 100,
    });
    res.json(comparisons);
  } catch (error) {
    logger.error("Error fetching comparisons:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start the application
async function startApp() {
  try {
    // Initialize database connection
    await dataSource.initialize();
    logger.info("Database connection established");

    // Drop and recreate tables if needed
    try {
      await dataSource.query('DROP TABLE IF EXISTS "contract_cache" CASCADE');
      await dataSource.synchronize();
      logger.info("Database schema synchronized");
    } catch (error) {
      logger.error("Error synchronizing database schema:", error);
      process.exit(1);
    }

    // Start mempool monitor
    const monitor = new MempoolMonitor(
      process.env.ETH_WS_URL || "ws://localhost:8546",
      logger,
      dataSource
    );
    await monitor.start();

    // Start express server
    const port = process.env.PORT || 3001;
    app.listen(port, () => {
      logger.info(`Server running on port ${port}`);
    });
  } catch (error) {
    logger.error("Failed to start application:", error);
    process.exit(1);
  }
}

startApp();
