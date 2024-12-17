import { DataSource } from "typeorm";
import { Block } from "./entities/Block";
import { Transaction } from "./entities/Transaction";
import { BlockPrediction } from "./entities/BlockPrediction";
import { createComponentLogger } from "./utils/logger";

const logger = createComponentLogger("Database");

export const AppDataSource = new DataSource({
  type: "postgres",
  host: process.env.DB_HOST || "localhost",
  port: parseInt(process.env.DB_PORT || "5432"),
  username: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "memepool",
  synchronize: true, // Be careful with this in production
  logging: ["error", "warn", "schema"], // Only log errors, warnings, and schema changes
  entities: [Block, Transaction, BlockPrediction],
  subscribers: [],
  migrations: [],
});

export async function initializeDatabase() {
  try {
    await AppDataSource.initialize();
    logger.info("Database has been initialized");
    return AppDataSource;
  } catch (error) {
    logger.error("Error during Database initialization", {
      error: String(error),
    });
    throw error;
  }
}
