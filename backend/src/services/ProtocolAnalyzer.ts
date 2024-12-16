import { ethers } from "ethers";
import { DataSource } from "typeorm";
import { ContractCache } from "../entities/ContractCache";
import { createComponentLogger, type LogContext } from "../utils/logger";
import { COMMON_CONTRACTS } from "../data/commonContracts";

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
    | "transfer";
  value?: string;
  category?: string;
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

type ERC20MethodSignature = (typeof ERC20_METHODS)[keyof typeof ERC20_METHODS];

// Common ERC20 ABI for decoding
const ERC20_ABI = [
  "function transfer(address to, uint256 value) external returns (bool)",
  "function transferFrom(address from, address to, uint256 value) external returns (bool)",
  "function approve(address spender, uint256 value) external returns (bool)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)",
] as const;

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
  private provider: ethers.WebSocketProvider;
  private logger = createComponentLogger("ProtocolAnalyzer");
  private db: DataSource;
  private contractCache: Map<string, ContractCache> = new Map();
  private knownProtocols: Map<string, { name: string; type: string }> =
    new Map();
  private erc20Interface = new ethers.Interface(ERC20_ABI);
  private tokenInfoCache: Map<string, TokenInfo> = new Map();
  private readonly TOKEN_CACHE_TTL = 3600000; // 1 hour in milliseconds

  constructor(provider: ethers.WebSocketProvider, db: DataSource) {
    this.provider = provider;
    this.db = db;
    this.initializeKnownProtocols();
  }

  private initializeKnownProtocols() {
    Object.entries(COMMON_CONTRACTS).forEach(([address, contract]) => {
      this.knownProtocols.set(address.toLowerCase(), {
        name: contract.name,
        type: contract.type,
      });
    });
  }

  private async getTokenInfo(tokenAddress: string): Promise<TokenInfo | null> {
    const address = tokenAddress.toLowerCase();
    const now = Date.now();
    const cached = this.tokenInfoCache.get(address);

    // Return cached value if still valid
    if (cached && now - cached.lastUpdated < this.TOKEN_CACHE_TTL) {
      return cached;
    }

    try {
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.provider
      );
      const [symbol, decimals] = await Promise.all([
        tokenContract.symbol(),
        tokenContract.decimals(),
      ]);

      const tokenInfo: TokenInfo = {
        symbol,
        decimals,
        lastUpdated: now,
        address,
      };

      this.tokenInfoCache.set(address, tokenInfo);
      return tokenInfo;
    } catch (error) {
      this.logger.debug("Failed to get token info", {
        error: error instanceof Error ? error.message : String(error),
        tokenAddress,
      });
      return null;
    }
  }

  private async handleERC20Transfer(
    tx: ethers.TransactionResponse,
    methodSignature: ERC20MethodSignature
  ): Promise<TransactionDetails | null> {
    try {
      const decoded = this.erc20Interface.parseTransaction({
        data: tx.data,
        value: tx.value,
      });

      if (!decoded) return null;

      const result: TransactionDetails = {
        type: "transfer",
        methodName: decoded.name,
        params: this.sanitizeParams(decoded.args),
      };

      const tokenInfo = await this.getTokenInfo(tx.to!);
      if (tokenInfo) {
        result.protocol = `${tokenInfo.symbol} Token`;
        if (result.params?.value) {
          result.params.formattedValue = ethers.formatUnits(
            result.params.value,
            tokenInfo.decimals
          );
        }
      }

      return result;
    } catch (error) {
      this.logger.debug("Failed to decode ERC20 transfer", {
        error: error instanceof Error ? error.message : String(error),
        txHash: tx.hash,
      });
      // Still return a basic transfer type since we matched the signature
      return {
        type: "transfer",
        methodName: "transfer",
        protocol: "Unknown Token",
      };
    }
  }

  async analyzeTransaction(
    tx: ethers.TransactionResponse
  ): Promise<TransactionDetails> {
    try {
      if (!tx.to) return { type: "unknown" };

      const protocol = this.knownProtocols.get(tx.to.toLowerCase());
      const result: TransactionDetails = {
        protocol: protocol?.name,
        value: tx.value.toString(),
      };

      // Try to decode the transaction data
      if (tx.data && tx.data.length >= 10) {
        const methodSignature = tx.data.slice(0, 10).toLowerCase() as
          | ERC20MethodSignature
          | MethodSignature;

        // Check if it's an ERC20 transfer first
        if (
          Object.values(ERC20_METHODS).includes(
            methodSignature as ERC20MethodSignature
          )
        ) {
          const transferResult = await this.handleERC20Transfer(
            tx,
            methodSignature as ERC20MethodSignature
          );
          if (transferResult) return transferResult;
        }

        // If not an ERC20 transfer or if handling failed, continue with normal flow
        result.type = this.determineTransactionType(
          methodSignature as MethodSignature,
          tx
        );

        // Try to decode using cached ABI
        const decoded = await this.decodeTransaction(tx);
        if (decoded) {
          result.methodName = decoded.name;
          result.params = this.sanitizeParams(decoded.args);
        }
      }

      // If it's a simple ETH transfer
      if (tx.data === "0x" && tx.value > BigInt(0)) {
        result.type = "transfer";
        result.protocol = "Ethereum";
        result.methodName = "transfer";
        result.params = {
          to: tx.to,
          value: tx.value.toString(),
          formattedValue: ethers.formatEther(tx.value),
        };
      }

      return result;
    } catch (error) {
      this.logger.error("Error analyzing transaction", {
        error: error instanceof Error ? error.message : String(error),
        txHash: tx.hash,
      });
      return { type: "unknown" };
    }
  }

  private async decodeTransaction(tx: ethers.TransactionResponse) {
    // Try to get method name from contract cache
    const cachedContract = await this.db
      .getRepository(ContractCache)
      .findOne({ where: { address: tx.to!.toLowerCase() } });

    if (cachedContract?.abi) {
      try {
        const iface = new ethers.Interface(cachedContract.abi);
        return iface.parseTransaction({ data: tx.data, value: tx.value });
      } catch (error) {
        this.logger.debug("Failed to decode transaction", {
          error: error instanceof Error ? error.message : String(error),
          txHash: tx.hash,
        });
      }
    }

    // Try to use ABI from COMMON_CONTRACTS if available
    const commonContract = COMMON_CONTRACTS[tx.to!.toLowerCase()];
    if (commonContract?.abi) {
      try {
        const iface = new ethers.Interface(commonContract.abi);
        return iface.parseTransaction({ data: tx.data, value: tx.value });
      } catch (error) {
        this.logger.debug("Failed to decode transaction with common ABI", {
          error: error instanceof Error ? error.message : String(error),
          txHash: tx.hash,
        });
      }
    }

    return null;
  }

  private determineTransactionType(
    methodSignature: MethodSignature,
    tx: ethers.TransactionResponse
  ): TransactionDetails["type"] {
    if (METHOD_SIGNATURES.SWAP.includes(methodSignature as any)) return "swap";
    if (METHOD_SIGNATURES.LIQUIDITY.includes(methodSignature as any))
      return "liquidity";
    if (METHOD_SIGNATURES.LENDING.includes(methodSignature as any))
      return "lending";
    if (METHOD_SIGNATURES.BRIDGE.includes(methodSignature as any))
      return "bridge";

    // Check known bridge contracts
    const BRIDGE_CONTRACTS = new Set([
      "0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf", // Polygon Bridge
      "0xa0c68c638235ee32657e8f720a23cec1bfc77c77", // Arbitrum Bridge
      "0x3ee18b2214aff97000d974cf647e7c347e8fa585", // Wormhole Bridge
      "0x99c9fc46f92e8a1c0dec1b1747d010903e884be1", // Optimism Bridge
    ]);

    if (tx.to && BRIDGE_CONTRACTS.has(tx.to.toLowerCase())) {
      return "bridge";
    }

    // Check if we know the contract type
    const protocol = this.knownProtocols.get(tx.to?.toLowerCase() || "");
    if (protocol?.type === "dex") return "swap";
    if (protocol?.type === "lending") return "lending";
    if (protocol?.type === "bridge") return "bridge";

    return "unknown";
  }

  private sanitizeParams(params: any): any {
    if (params === null || params === undefined) {
      return params;
    }

    // Convert BigInt to string
    if (typeof params === "bigint") {
      return params.toString();
    }

    // Handle arrays
    if (Array.isArray(params)) {
      return params.map((item) => this.sanitizeParams(item));
    }

    // Handle objects
    if (typeof params === "object") {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(params)) {
        sanitized[key] = this.sanitizeParams(value);
      }
      return sanitized;
    }

    return params;
  }
}
