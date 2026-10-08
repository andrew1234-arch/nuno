/**
 * Event ABIs copied verbatim from https://nad.fun/abi.md (fetched 2026-10-08).
 * Topic hashes were checked against live mainnet logs from the curve contract.
 */
export const curveEventsAbi = [
  {
    type: "event",
    name: "CurveCreate",
    inputs: [
      { name: "creator", type: "address", indexed: true, internalType: "address" },
      { name: "token", type: "address", indexed: true, internalType: "address" },
      { name: "pool", type: "address", indexed: true, internalType: "address" },
      { name: "name", type: "string", indexed: false, internalType: "string" },
      { name: "symbol", type: "string", indexed: false, internalType: "string" },
      { name: "tokenURI", type: "string", indexed: false, internalType: "string" },
      { name: "virtualMon", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "virtualToken", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "targetTokenAmount", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "CurveBuy",
    inputs: [
      { name: "sender", type: "address", indexed: true, internalType: "address" },
      { name: "token", type: "address", indexed: true, internalType: "address" },
      { name: "amountIn", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "amountOut", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "CurveSell",
    inputs: [
      { name: "sender", type: "address", indexed: true, internalType: "address" },
      { name: "token", type: "address", indexed: true, internalType: "address" },
      { name: "amountIn", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "amountOut", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "CurveSync",
    inputs: [
      { name: "token", type: "address", indexed: true, internalType: "address" },
      { name: "realMonReserve", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "realTokenReserve", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "virtualMonReserve", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "virtualTokenReserve", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "CurveGraduate",
    inputs: [
      { name: "token", type: "address", indexed: true, internalType: "address" },
      { name: "pool", type: "address", indexed: true, internalType: "address" },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "CurveTokenLocked",
    inputs: [{ name: "token", type: "address", indexed: true, internalType: "address" }],
    anonymous: false,
  },
] as const;

export const erc20TransferAbi = [
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "value", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
] as const;

/** Uniswap V3 Pool Swap event, from https://nad.fun/abi.md. */
export const uniswapV3SwapAbi = [
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "sender", type: "address", indexed: true, internalType: "address" },
      { name: "recipient", type: "address", indexed: true, internalType: "address" },
      { name: "amount0", type: "int256", indexed: false, internalType: "int256" },
      { name: "amount1", type: "int256", indexed: false, internalType: "int256" },
      { name: "sqrtPriceX96", type: "uint160", indexed: false, internalType: "uint160" },
      { name: "liquidity", type: "uint128", indexed: false, internalType: "uint128" },
      { name: "tick", type: "int24", indexed: false, internalType: "int24" },
    ],
    anonymous: false,
  },
] as const;

export const TOPICS = {
  CurveCreate: "0xd37e3f4f651fe74251701614dbeac478f5a0d29068e87bbe44e5026d166abca9",
  CurveBuy: "0x00a7ba871905cb955432583640b5c9fc6bdd27d36884ab2b5420839224638862",
  CurveSell: "0x0eb25df0e2137de8ce042eeaf39080d25f0c8d451372c99db69a4c0a298d0fa1",
  CurveGraduate: "0xa1cae252e597e19f398a442722a17a17e62d17f9d4f3656786e18aabcd428908",
  Transfer: "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
} as const;
