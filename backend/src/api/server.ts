import express from "express";
import cors from "cors";
import { DataSource } from "typeorm";
import { createComponentLogger } from "../utils/logger";
import { createApiRouter } from "./routes";

const logger = createComponentLogger("APIServer");

export async function startApiServer(db: DataSource) {
  const app = express();
  const port = process.env.API_PORT || 3001;

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Request logging middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      logger.debug("Request processed", {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
      });
    });
    next();
  });

  // API Routes
  app.use("/api", createApiRouter(db));

  // Error handling middleware
  app.use(
    (
      err: Error,
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      logger.error("Unhandled error in API request", {
        error: err.message,
        stack: err.stack,
        path: req.path,
      });
      res.status(500).json({ error: "Internal server error" });
    }
  );

  // Start server
  return new Promise<void>((resolve, reject) => {
    try {
      app.listen(port, () => {
        logger.info(`API server listening on port ${port}`);
        resolve();
      });
    } catch (error) {
      logger.error("Failed to start API server", { error: String(error) });
      reject(error);
    }
  });
}
