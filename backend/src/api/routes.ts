import { Router } from "express";
import { DataSource } from "typeorm";
import { BlockPrediction } from "../entities/BlockPrediction";
import { Block } from "../entities/Block";
import { createComponentLogger } from "../utils/logger";

const logger = createComponentLogger("API");

export function createApiRouter(db: DataSource) {
  const router = Router();

  // GET /api/predictions
  router.get("/predictions", async (req, res) => {
    try {
      const predictions = await db.getRepository(BlockPrediction).find({
        order: { blockNumber: "DESC" },
        take: 50,
      });

      const totalCount = await db.getRepository(BlockPrediction).count();

      res.json({
        predictions,
        totalCount,
      });
    } catch (error) {
      logger.error("Failed to fetch predictions", { error: String(error) });
      res.status(500).json({ error: "Failed to fetch predictions" });
    }
  });

  // GET /api/comparisons
  router.get("/comparisons", async (req, res) => {
    try {
      const predictions = await db
        .getRepository(BlockPrediction)
        .createQueryBuilder("prediction")
        .leftJoinAndSelect("prediction.block", "block")
        .where("block.number IS NOT NULL")
        .orderBy("prediction.blockNumber", "DESC")
        .take(50)
        .getMany();

      const comparisons = predictions
        .map((prediction) => {
          const block = prediction.block;
          if (!block) return null;

          // Calculate accuracy
          const predictedSet = new Set(prediction.predictedTransactions);
          const actualSet = new Set(block.transactionHashes);

          const correctPredictions = prediction.predictedTransactions.filter(
            (tx) => actualSet.has(tx)
          ).length;

          const accuracy =
            (correctPredictions / Math.max(predictedSet.size, 1)) * 100;

          return {
            id: prediction.id,
            blockNumber: block.number,
            miner: block.miner,
            builder: block.extraData, // This might need adjustment based on how builder info is stored
            builderName: extractBuilderName(block.extraData),
            predictedTransactions: prediction.predictedTransactions,
            actualTransactions: block.transactionHashes,
            accuracy,
          };
        })
        .filter((comp): comp is NonNullable<typeof comp> => comp !== null);

      res.json(comparisons);
    } catch (error) {
      logger.error("Failed to fetch comparisons", { error: String(error) });
      res.status(500).json({ error: "Failed to fetch comparisons" });
    }
  });

  return router;
}

function extractBuilderName(extraData: string): string {
  // Common builder signatures in extraData
  const builderSignatures: Record<string, string> = {
    "0x696e": "builder0x69",
    titan: "titan",
    beaver: "beaverbuild",
    flash: "flashbots",
    rsync: "rsync",
  };

  const lowerExtraData = extraData.toLowerCase();
  for (const [signature, name] of Object.entries(builderSignatures)) {
    if (lowerExtraData.includes(signature)) {
      return name;
    }
  }

  return "unknown";
}
