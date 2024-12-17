import { ethers } from "ethers";
import { DataSource } from "typeorm";
import { ContractCache } from "../entities/ContractCache";
import { createComponentLogger, type LogContext } from "../utils/logger";
import { COMMON_CONTRACTS } from "../data/commonContracts";
import pLimit from "p-limit";

interface TransactionDetails {
  protocol?: string;
  methodName?: string;
  params?: any;
  isSandwichTarget?: boolean;
  type?:
    | "swap"
    | "liquidity"
    | "bridge"
    | "lending"
    | "sandwich"
    | "unknown"
    | "transfer"
    | "contract_creation";
  value?: string;
  category?:
    | "dex" // For DEX-related transactions (swaps, liquidity)
    | "defi" // For lending, borrowing, etc.
    | "bridge" // For cross-chain bridges
    | "token" // For ERC20 token transfers
    | "native" // For ETH transfers
    | "deployment" // For contract deployments
    | "other"; // For unknown or uncategorized
  token?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  tokenAmount?: string;
}

interface ProtocolInfo {
  name: string;
  type: TransactionDetails["category"];
}

interface TokenInfo {
  symbol: string;
  decimals: number;
  lastUpdated: number;
  address: string;
}

// Common ERC20 methods
const ERC20_METHODS = {
  TRANSFER: "0xa9059cbb", // transfer(address,uint256)
  TRANSFER_FROM: "0x23b872dd", // transferFrom(address,address,uint256)
  APPROVE: "0x095ea7b3", // approve(address,uint256)
} as const;

// Common token addresses
const KNOWN_TOKENS: { [address: string]: TokenInfo } = {
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": {
    symbol: "WETH",
    decimals: 18,
    lastUpdated: 0,
    address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  },
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": {
    symbol: "USDC",
    decimals: 6,
    lastUpdated: 0,
    address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  },
  "0xdac17f958d2ee523a2206206994597c13d831ec7": {
    symbol: "USDT",
    decimals: 6,
    lastUpdated: 0,
    address: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  },
  "0x6b175474e89094c44da98b954eedeac495271d0f": {
    symbol: "DAI",
    decimals: 18,
    lastUpdated: 0,
    address: "0x6b175474e89094c44da98b954eedeac495271d0f",
  },
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": {
    symbol: "WBTC",
    decimals: 8,
    lastUpdated: 0,
    address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
  },
  "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984": {
    symbol: "UNI",
    decimals: 18,
    lastUpdated: 0,
    address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
  },
  "0x514910771af9ca656af840dff83e8264ecf986ca": {
    symbol: "LINK",
    decimals: 18,
    lastUpdated: 0,
    address: "0x514910771af9ca656af840dff83e8264ecf986ca",
  },
};

// Method signatures for different transaction types
const METHOD_SIGNATURES = {
  SWAP: [
    "0x38ed1739", // swapExactTokensForTokens
    "0x7ff36ab5", // swapExactETHForTokens
    "0x18cbafe5", // swapExactTokensForETH
    "0x5c11d795", // swapExactTokensForTokensSupportingFeeOnTransferTokens
    "0xc04b8d59", // exactInput
    "0xdb3e2198", // exactOutput
  ],
  LIQUIDITY: [
    "0xe8e33700", // addLiquidity
    "0xbaa2abde", // removeLiquidity
    "0x4515cef3", // add_liquidity (Curve)
  ],
  LENDING: [
    "0xe8eda9df", // deposit
    "0xa415bcad", // borrow
    "0x573ade81", // repay
    "0x69328dec", // withdraw
  ],
  BRIDGE: [
    "0x0c53c51c", // bridgeTokens
  ],
} as const;

type MethodSignature =
  (typeof METHOD_SIGNATURES)[keyof typeof METHOD_SIGNATURES][number];

export class ProtocolAnalyzer {
  private provider: ethers.Provider;
  private db: DataSource;
  private logger: ReturnType<typeof createComponentLogger>;
  private tokenCache: Map<string, TokenInfo> = new Map(
    Object.entries(KNOWN_TOKENS)
  );
  private contractCache: Map<string, ContractCache> = new Map();
  private knownProtocols: Map<string, ProtocolInfo> = new Map();
  private requestLimiter = pLimit(5); // Limit concurrent requests
  private tokenRequestQueue = new Map<string, Promise<TokenInfo | null>>();

  constructor(provider: ethers.Provider, db: DataSource) {
    this.provider = provider;
    this.db = db;
    this.logger = createComponentLogger("ProtocolAnalyzer");
    this.initializeKnownProtocols();
  }

  private initializeKnownProtocols() {
    Object.entries(COMMON_CONTRACTS).forEach(([address, contract]) => {
      this.knownProtocols.set(address.toLowerCase(), {
        name: contract.name,
        type: this.mapContractTypeToCategory(contract.type),
      });
    });
  }

  private mapContractTypeToCategory(
    type: string
  ): TransactionDetails["category"] {
    switch (type.toLowerCase()) {
      case "dex":
        return "dex";
      case "lending":
        return "defi";
      case "bridge":
        return "bridge";
      case "token":
        return "token";
      default:
        return "other";
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  async analyzeTransaction(
    tx: ethers.TransactionResponse
  ): Promise<TransactionDetails | null> {
    try {
      const details: TransactionDetails = {};

      // Set native ETH value if present
      if (tx.value) {
        details.value = tx.value.toString();
        details.token = "ETH";
        details.tokenSymbol = "ETH";
        details.tokenDecimals = 18;
        details.tokenAmount = tx.value.toString();
      }

      if (!tx.to) {
        details.type = "contract_creation";
        details.category = "deployment";
        return details;
      }

      // Get the first 4 bytes of the data (function signature)
      const methodId = tx.data.slice(0, 10).toLowerCase();

      // Check if this is a token transfer or interaction
      if (
        methodId === ERC20_METHODS.TRANSFER ||
        methodId === ERC20_METHODS.TRANSFER_FROM
      ) {
        const tokenInfo = await this.getTokenInfoThrottled(tx.to);
        if (tokenInfo) {
          details.token = tx.to;
          details.tokenSymbol = tokenInfo.symbol;
          details.tokenDecimals = tokenInfo.decimals;

          // Parse token amount from the transaction data
          try {
            const iface = new ethers.Interface([
              "function transfer(address to, uint256 amount)",
              "function transferFrom(address from, address to, uint256 amount)",
            ]);
            const decoded = iface.parseTransaction({ data: tx.data });
            if (decoded) {
              details.tokenAmount =
                decoded.args[
                  methodId === ERC20_METHODS.TRANSFER ? 1 : 2
                ].toString();
            }
          } catch (error) {
            this.logger.debug("Failed to parse token amount", {
              error: this.formatError(error),
              txHash: tx.hash,
            });
          }
        }
      }

      // Check for DEX interactions and extract token info
      const protocolInfo = await this.identifyProtocol(tx.to);
      if (protocolInfo) {
        details.protocol = protocolInfo.name;
        details.category = protocolInfo.type;

        // For DEX interactions, try to extract token information
        if (protocolInfo.type === "dex" && tx.data.length >= 138) {
          try {
            // Extract potential token addresses from the data
            // Most DEX methods include token addresses as parameters
            const potentialTokens = [];
            for (let i = 34; i < tx.data.length - 40; i += 64) {
              const potentialAddress = "0x" + tx.data.slice(i, i + 40);
              if (ethers.isAddress(potentialAddress)) {
                const tokenInfo = await this.getTokenInfoThrottled(
                  potentialAddress
                );
                if (tokenInfo) {
                  potentialTokens.push(tokenInfo);
                }
              }
            }

            // Use the first found token for the treemap
            if (potentialTokens.length > 0) {
              details.token = potentialTokens[0].address;
              details.tokenSymbol = potentialTokens[0].symbol;
              details.tokenDecimals = potentialTokens[0].decimals;
            }
          } catch (error) {
            this.logger.debug(
              "Failed to extract token info from DEX interaction",
              {
                error: this.formatError(error),
                txHash: tx.hash,
              }
            );
          }
        }
      }

      return details;
    } catch (error) {
      this.logger.error("Error analyzing transaction", {
        error: this.formatError(error),
        txHash: tx.hash,
      });
      return null;
    }
  }

  private async identifyProtocol(
    address: string | undefined
  ): Promise<ProtocolInfo | null> {
    if (!address) return null;

    const normalizedAddress = address.toLowerCase();

    // Check known protocols first
    const knownProtocol = this.knownProtocols.get(normalizedAddress);
    if (knownProtocol) return knownProtocol;

    // Check contract cache
    const cachedContract = await this.db
      .getRepository(ContractCache)
      .findOne({ where: { address: normalizedAddress } });

    if (cachedContract?.type) {
      return {
        name: cachedContract.contractName || "Unknown Protocol",
        type: this.mapContractTypeToCategory(cachedContract.type),
      };
    }

    return null;
  }

  private async getTokenInfoThrottled(
    address: string
  ): Promise<TokenInfo | null> {
    const normalizedAddress = address.toLowerCase();

    // Check if we already have a request in flight for this token
    const existingRequest = this.tokenRequestQueue.get(normalizedAddress);
    if (existingRequest) {
      return existingRequest;
    }

    // Check cache first
    const cached = this.tokenCache.get(normalizedAddress);
    if (cached && Date.now() - cached.lastUpdated < 24 * 60 * 60 * 1000) {
      return cached;
    }

    // Create a new request and add it to the queue
    const request = this.requestLimiter(async () => {
      try {
        // Double-check cache in case another request completed while we were waiting
        const cachedAgain = this.tokenCache.get(normalizedAddress);
        if (
          cachedAgain &&
          Date.now() - cachedAgain.lastUpdated < 24 * 60 * 60 * 1000
        ) {
          return cachedAgain;
        }

        // Try to get token info from the contract
        const contract = new ethers.Contract(
          address,
          [
            "function symbol() view returns (string)",
            "function decimals() view returns (uint8)",
          ],
          this.provider
        );

        const [symbol, decimals] = await Promise.all([
          contract.symbol().catch(() => "UNKNOWN"),
          contract.decimals().catch(() => 18),
        ]);

        const tokenInfo: TokenInfo = {
          symbol,
          decimals,
          lastUpdated: Date.now(),
          address: normalizedAddress,
        };

        // Update cache
        this.tokenCache.set(normalizedAddress, tokenInfo);
        return tokenInfo;
      } catch (error) {
        this.logger.debug("Failed to get token info", {
          error: this.formatError(error),
          address,
        });
        return null;
      } finally {
        // Remove from queue after a delay to prevent immediate re-queuing
        setTimeout(() => {
          this.tokenRequestQueue.delete(normalizedAddress);
        }, 1000);
      }
    });

    // Add to queue and return
    this.tokenRequestQueue.set(normalizedAddress, request);
    return request;
  }
}
