import { createLogger, format, transports } from "winston";

interface LogContext {
  // Block-related
  blockNumber?: number;
  lastProcessedBlock?: number;
  current?: number;
  last?: number;
  missed?: number;
  latestBlock?: number;
  oldestBlock?: number;

  // Transaction-related
  txHash?: string;
  txCount?: number;
  count?: number;
  totalCount?: number;
  predictedCount?: number;
  actualCount?: number;
  pendingTxCount?: number;
  pendingTxs?: number;
  processedTxs?: number;
  predictedTxs?: number;
  actualTxs?: number;

  // Gas-related
  gasLimit?: string;
  gasUsed?: string;
  totalGasUsed?: string;
  targetGasUsed?: string;
  avgGasPrice?: string;
  gasPrice?: string;
  maxFee?: string;
  baseFee?: string;
  nextBaseFee?: string;
  priorityFee?: string;

  // Transaction details
  to?: string;
  value?: string;
  type?: string;
  protocol?: string;
  detailsCount?: number;
  details?: number;

  // Analysis-related
  groupCount?: number;
  totalTxs?: number;
  groupSize?: number;
  accuracy?: number;
  accuracies?: number[];
  samplePrediction?: any;
  sampleComparison?: any;

  // Metadata
  id?: number;
  requestId?: string;
  component?: string;
  wsUrl?: string;
  error?: any;
  message?: string;
  time?: number;
  timestamp?: string;

  // Database-related
  query?: string;
  parameters?: any[];

  // Prediction tracking
  predictedTxCount?: number;
  predictionsInMemory?: string;
  availablePredictions?: string;
}

export const logger = createLogger({
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

export type { LogContext };

// Helper function to create a logger with component context
export function createComponentLogger(component: string) {
  return {
    debug: (message: string, context: LogContext = {}) => {
      logger.debug(message, { ...context, component });
    },
    info: (message: string, context: LogContext = {}) => {
      logger.info(message, { ...context, component });
    },
    warn: (message: string, context: LogContext = {}) => {
      logger.warn(message, { ...context, component });
    },
    error: (message: string, context: LogContext = {}) => {
      logger.error(message, { ...context, component });
    },
  };
}
