interface ContractInfo {
  name: string;
  type: "dex" | "lending" | "bridge" | "oracle" | "nft" | "unknown";
  abi?: string[];
}

export const COMMON_CONTRACTS: Record<string, ContractInfo> = {
  // Uniswap V2 Router
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d": {
    name: "Uniswap V2 Router",
    type: "dex",
    abi: [
      "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
      "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
      "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    ],
  },

  // Uniswap V3 Router
  "0xe592427a0aece92de3edee1f18e0157c05861564": {
    name: "Uniswap V3 Router",
    type: "dex",
    abi: [
      "function exactInput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum) params) external payable returns (uint256 amountOut)",
      "function exactOutput(tuple(bytes path, address recipient, uint256 deadline, uint256 amountOut, uint256 amountInMaximum) params) external payable returns (uint256 amountIn)",
    ],
  },

  // AAVE V2 Lending Pool
  "0x7d2768de32b0b80b7a3454c06bdac94a69ddc7a9": {
    name: "AAVE V2 Lending Pool",
    type: "lending",
    abi: [
      "function deposit(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external",
      "function borrow(address asset, uint256 amount, uint256 interestRateMode, uint16 referralCode, address onBehalfOf) external",
      "function repay(address asset, uint256 amount, uint256 rateMode, address onBehalfOf) external returns (uint256)",
      "function withdraw(address asset, uint256 amount, address to) external returns (uint256)",
    ],
  },

  // Curve 3pool
  "0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7": {
    name: "Curve 3pool",
    type: "dex",
    abi: [
      "function add_liquidity(uint256[3] memory amounts, uint256 min_mint_amount) external",
      "function remove_liquidity(uint256 _amount, uint256[3] memory min_amounts) external",
      "function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external",
    ],
  },

  // Polygon Bridge
  "0x40ec5b33f54e0e8a33a975908c5ba1c14e5bbbdf": {
    name: "Polygon Bridge",
    type: "bridge",
  },

  // Arbitrum Bridge
  "0xa0c68c638235ee32657e8f720a23cec1bfc77c77": {
    name: "Arbitrum Bridge",
    type: "bridge",
  },

  // Chainlink ETH/USD Price Feed
  "0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419": {
    name: "Chainlink ETH/USD Price Feed",
    type: "oracle",
    abi: [
      "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
    ],
  },

  // OpenSea Seaport
  "0x00000000006c3852cbef3e08e8df289169ede581": {
    name: "OpenSea Seaport",
    type: "nft",
    abi: [
      "function fulfillBasicOrder(tuple(address considerationToken, uint256 considerationIdentifier, uint256 considerationAmount, address offerer, address zone, address offerToken, uint256 offerIdentifier, uint256 offerAmount, uint8 basicOrderType, uint256 startTime, uint256 endTime, bytes32 zoneHash, uint256 salt, bytes32 offererConduitKey, bytes32 fulfillerConduitKey, uint256 totalOriginalAdditionalRecipients, tuple(uint256 amount, address recipient)[] additionalRecipients, bytes signature) parameters) external payable returns (bool fulfilled)",
    ],
  },
};
