import "dotenv/config";
import { createComponentLogger } from "./utils/logger";
import { initializeDatabase } from "./database";
import { BlockMonitor } from "./services/BlockMonitor";
import { MempoolMonitor } from "./services/MempoolMonitor";
import { AnalyticsMonitor } from "./services/AnalyticsMonitor";
import { PredictionService } from "./services/PredictionService";
import { startApiServer } from "./api/server";
import { ethers } from "ethers";

const logger = createComponentLogger("App");
const ETH_WS_URL = process.env.ETH_WS_URL;

logger.info("Starting application with configuration", {
  ETH_WS_URL,
  NODE_ENV: process.env.NODE_ENV,
  API_PORT: process.env.API_PORT || 3001,
});

async function startApplication() {
  // Validate required environment variables
  const requiredEnvVars = ["ETH_WS_URL", "DB_HOST", "DB_NAME"] as const;
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`Missing required environment variable: ${envVar}`);
      process.exit(1);
    }
  }

  try {
    // Initialize database
    const db = await initializeDatabase();

    // Initialize services
    const provider = new ethers.WebSocketProvider(ETH_WS_URL as string);
    const blockMonitor = new BlockMonitor(ETH_WS_URL as string, db);
    const mempoolMonitor = new MempoolMonitor(ETH_WS_URL as string, db);
    const analyticsMonitor = new AnalyticsMonitor(ETH_WS_URL as string, db);
    const predictionService = new PredictionService(provider, db);

    // Start all services
    await Promise.all([
      blockMonitor.start(),
      mempoolMonitor.start(),
      analyticsMonitor.start(),
      predictionService.start(),
      startApiServer(db),
    ]);

    logger.info("Application started successfully");
  } catch (error) {
    logger.error("Failed to start application", { error: String(error) });
    process.exit(1);
  }
}

startApplication();
