use anchor_lang::prelude::*;

// TxODDS Oracle program (devnet)
pub const TXORACLE_PROGRAM_ID: Pubkey = pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
pub const DEVNET_USDC_MINT: Pubkey = pubkey!("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
pub const USDC_DECIMALS: u8 = 6;

// PDA seed prefixes
pub const SEED_CONFIG: &[u8] = b"config";
pub const SEED_USER: &[u8] = b"user";
pub const SEED_USER_VAULT: &[u8] = b"user_vault";
pub const SEED_MATCH: &[u8] = b"match";
pub const SEED_MARKET: &[u8] = b"market";
pub const SEED_MARKET_VAULT: &[u8] = b"market_vault";
pub const SEED_POSITION: &[u8] = b"position";
pub const SEED_ORDER: &[u8] = b"order";

// Market duration limits
pub const MIN_MARKET_DURATION: i64 = 15;
pub const MAX_MARKET_DURATION: i64 = 300;
pub const MAX_OUTCOMES: usize = 3;
pub const PRICE_SCALE_BPS: u16 = 10_000;
pub const PRICE_TICK_BPS: u16 = 100;
pub const MIN_PRICE_BPS: u16 = 100;
pub const MAX_PRICE_BPS: u16 = 9_900;
pub const MIN_TRADE_QUANTITY: u64 = 100;

// Minimum liquidity required for a round
pub const MIN_MARKET_LIQUIDITY_BASE_UNITS: u64 = 10_000; // 0.01 USDC

// StatKey constants (from TxLINE Soccer Feed v1.0)
pub const STATKEY_P1_GOALS: u32 = 1;
pub const STATKEY_P2_GOALS: u32 = 2;
pub const STATKEY_P1_YC: u32 = 3;
pub const STATKEY_P2_YC: u32 = 4;
pub const STATKEY_P1_RC: u32 = 5;
pub const STATKEY_P2_RC: u32 = 6;
pub const STATKEY_P1_CORNERS: u32 = 7;
pub const STATKEY_P2_CORNERS: u32 = 8;
pub const STATKEY_P1_PE: u32 = 5001;
pub const STATKEY_P2_PE: u32 = 5002;

// Period modifiers
pub const PERIOD_H1: i32 = 0;
pub const PERIOD_H2: i32 = 1000;
pub const PERIOD_ET1: i32 = 2000;
pub const PERIOD_ET2: i32 = 3000;
pub const PERIOD_PE: i32 = 5000;

// validate_stat CPI discriminator
pub const VALIDATE_STAT_DISCRIMINATOR: [u8; 8] = [107, 197, 232, 90, 191, 136, 105, 185];
