// lib/constants.ts
// Program IDs and network config for KickTick

export const CONFIG = {
  // Solana cluster
  cluster: 'devnet',
  rpcUrl: import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com',

  // CLOB program deployment
  kicktickProgramId: import.meta.env.VITE_KICKTICK_PROGRAM_ID || 'LLQr8aHZrYMCGyncFVK1hnxXbPCFKxSrANuEBguCgND',

  // TxODDS Oracle
  txodds: {
    devnet: {
      apiBase: 'https://txline-dev.txodds.com',
      programId: '6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J',
    },
    mainnet: {
      apiBase: 'https://txline.txodds.com',
      programId: '9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA',
    },
  },

  // CLOB market settings
  minDuration: 15,       // seconds
  maxDuration: 300,      // seconds
  settleGracePeriod: 60, // seconds after expiry
} as const;
