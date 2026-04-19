export const SPINMINT_ABI = [
  // Write
  { name: "mintAndSpin",  type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { name: "useFreeSpin",  type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { name: "claim",        type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }], outputs: [] },
  { name: "grantFreeSpin", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "user", type: "address" }], outputs: [] },
  { name: "batchGrantFreeSpins", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "users", type: "address[]" }], outputs: [] },
  { name: "sweepExpired", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "users", type: "address[]" }], outputs: [] },
  { name: "seedJackpot",  type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { name: "setURI",       type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "newuri", type: "string" }], outputs: [] },
  { name: "emergencyWithdraw", type: "function", stateMutability: "nonpayable", inputs: [], outputs: [] },
  // Views
  {
    name: "getStats", type: "function", stateMutability: "view", inputs: [],
    outputs: [
      { name: "jackpotPool",      type: "uint256" },
      { name: "totalMints",       type: "uint256" },
      { name: "contractBalance",  type: "uint256" },
    ],
  },
  {
    name: "getUserInfo", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "streak",           type: "uint256" },
      { name: "hasFreecastSpin",  type: "bool" },
      { name: "spinTickets",      type: "uint256" },
      { name: "totalRaresMinted", type: "uint256" },
    ],
  },
  {
    name: "getClaimable", type: "function", stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [
      { name: "amount",    type: "uint256" },
      { name: "expiresAt", type: "uint256" },
    ],
  },
  {
    name: "getRareInfo", type: "function", stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "seed",   type: "uint256" },
      { name: "minter", type: "address" },
      { name: "exists", type: "bool" },
    ],
  },
  // Events
  { name: "Minted",      type: "event", inputs: [
    { name: "user", type: "address", indexed: true },
    { name: "tokenId", type: "uint256", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ]},
  { name: "SpinResult",  type: "event", inputs: [
    { name: "user", type: "address", indexed: true },
    { name: "prize", type: "uint256", indexed: false },
    { name: "isJackpot", type: "bool", indexed: false },
  ]},
  { name: "JackpotWon",  type: "event", inputs: [
    { name: "winner", type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ]},
  { name: "FreeSpinGranted", type: "event", inputs: [{ name: "user", type: "address", indexed: true }]},
  { name: "FreeSpinUsed",    type: "event", inputs: [{ name: "user", type: "address", indexed: true }]},
  { name: "PrizeClaimed",    type: "event", inputs: [
    { name: "user", type: "address", indexed: true },
    { name: "to",   type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ]},
  { name: "PrizeExpiredToJackpot", type: "event", inputs: [
    { name: "user",   type: "address", indexed: true },
    { name: "amount", type: "uint256", indexed: false },
  ]},
] as const;

export const ERC20_ABI = [
  { name: "approve",   type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }] },
  { name: "allowance", type: "function", stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }] },
] as const;
