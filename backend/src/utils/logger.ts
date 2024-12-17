import {
  createLogger as winstonCreateLogger,
  format,
  transports,
} from "winston";

interface LogContext {
  // Allow any properties
  [key: string]: any;
}

export const logger = winstonCreateLogger({
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

// Export the createLogger function as an alias of createComponentLogger
export const createLogger = createComponentLogger;
