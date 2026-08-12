/** ABIs for ImpostorMarketFactory / ImpostorMarket — keep in sync with inco/contracts/. */

export const IMPOSTOR_MARKET_FACTORY_ABI = [
  {
    name: 'createMarket',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'matchId', type: 'uint256' },
      { name: 'candidates', type: 'address[]' },
    ],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'marketOfMatch',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'roles',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'MarketCreated',
    type: 'event',
    inputs: [
      { name: 'matchId', type: 'uint256', indexed: true },
      { name: 'market', type: 'address', indexed: true },
      { name: 'host', type: 'address', indexed: true },
    ],
  },
];

export const IMPOSTOR_MARKET_ABI = [
  {
    name: 'bet',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'ciphertext', type: 'bytes' }],
    outputs: [],
  },
  {
    name: 'lockBetting',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'settle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'who', type: 'address' },
      { name: 'roleValue', type: 'uint256' },
      { name: 'signatures', type: 'bytes[]' },
    ],
    outputs: [],
  },
  {
    name: 'revealMyPick',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'proveWin',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'pickValue', type: 'uint256' },
      { name: 'signatures', type: 'bytes[]' },
    ],
    outputs: [],
  },
  {
    name: 'finalize',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'abandon',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'betFee',
    type: 'function',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'minBetValue',
    type: 'function',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'payoutOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'who', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'betOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [
      { name: 'stake', type: 'uint128' },
      { name: 'pick', type: 'uint16' },
      { name: 'proven', type: 'bool' },
      { name: 'winner', type: 'bool' },
      { name: 'claimed', type: 'bool' },
      { name: 'pickHandle', type: 'bytes32' },
    ],
  },
  {
    name: 'summary',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'phase_', type: 'uint8' },
      { name: 'pot_', type: 'uint256' },
      { name: 'bets_', type: 'uint256' },
      { name: 'winningIndex_', type: 'uint16' },
      { name: 'impostor_', type: 'address' },
      { name: 'winningStake_', type: 'uint256' },
      { name: 'settledAt_', type: 'uint64' },
    ],
  },
  {
    name: 'candidateCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'candidates',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'candidateIndexPlus1',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint16' }],
  },
  {
    name: 'pickHandleOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'who', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    name: 'PROVE_WINDOW',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint64' }],
  },
];

/** Contract enum order — must match ImpostorMarket.Phase */
export const MARKET_PHASE = ['betting', 'locked', 'settled', 'finalized', 'refunding'];
