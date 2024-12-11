import express from "express";
import cors from "cors";
import { createLogger, format, transports } from "winston";
import { DataSource } from "typeorm";
import { config } from "dotenv";
import { MempoolMonitor } from "./services/MempoolMonitor";
import { BlockPrediction } from "./entities/BlockPrediction";
import { BlockComparison } from "./entities/BlockComparison";

// Load environment variables
config();

// Configure logger
const logger = createLogger({
  format: format.combine(format.timestamp(), format.json()),
  transports: [
    new transports.Console(),
    new transports.File({ filename: "error.log", level: "error" }),
    new transports.File({ filename: "combined.log" }),
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
  entities: [BlockPrediction, BlockComparison],
  synchronize: true, // Be careful with this in production
  logging: true,
});

// Express app setup
const app = express();
app.use(cors());
app.use(express.json());

// API Routes
app.get("/api/predictions", async (req, res) => {
  try {
    const predictions = await dataSource.getRepository(BlockPrediction).find({
      order: { blockNumber: "DESC" },
      take: 100,
    });
    res.json(predictions);
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

    // Start mempool monitor
    const monitor = new MempoolMonitor(
      process.env.ETH_WS_URL || "ws://localhost:8546",
      logger,
      dataSource
    );
    await monitor.start();

    // Start express server
    const port = process.env.PORT || 3000;
    app.listen(port, () => {
      logger.info(`Server running on port ${port}`);
    });
  } catch (error) {
    logger.error("Failed to start application:", error);
    process.exit(1);
  }
}

startApp();
