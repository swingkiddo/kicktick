// kicktick/programs/kicktick/src/lib.rs
// KickTick: in-play micro prediction markets on Solana

#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;
use state::*;

declare_id!("LLQr8aHZrYMCGyncFVK1hnxXbPCFKxSrANuEBguCgND");

#[program]
pub mod kicktick {
    use super::*;

    // ===== Config =====

    pub fn init_config(ctx: Context<InitConfig>) -> Result<()> {
        instructions::init_config::init_config_handler(ctx)
    }

    pub fn init_match(
        ctx: Context<InitMatch>,
        fixture_id: i64,
        home_team: String,
        away_team: String,
    ) -> Result<()> {
        instructions::init_match::init_match_handler(ctx, fixture_id, home_team, away_team)
    }

    pub fn set_relayer(ctx: Context<SetRelayer>, relayer: Pubkey) -> Result<()> {
        instructions::market::set_relayer_handler(ctx, relayer)
    }

    // ===== User Balance =====

    pub fn init_user(ctx: Context<InitUser>) -> Result<()> {
        instructions::user::init_user_handler(ctx)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::user::deposit_handler(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::user::withdraw_handler(ctx, amount)
    }

    // ===== Market Lifecycle =====

    pub fn init_market(
        ctx: Context<InitMarket>,
        fixture_id: i64,
        market_type: MarketType,
        market_seq: u64,
        params: MarketParams,
        deadline_seconds: i64,
    ) -> Result<()> {
        instructions::market::init_market_handler(
            ctx,
            fixture_id,
            market_type,
            market_seq,
            params,
            deadline_seconds,
        )
    }

    pub fn lock_market(ctx: Context<LockMarket>) -> Result<()> {
        instructions::market::lock_market_handler(ctx)
    }

    pub fn resolve_market_offchain(ctx: Context<ResolveMarketOffchain>, winner: u8) -> Result<()> {
        instructions::market::resolve_market_offchain_handler(ctx, winner)
    }

    pub fn resolve_market_with_proof(
        ctx: Context<ResolveMarketWithProof>,
        args: ValidateStatArgs,
    ) -> Result<()> {
        instructions::oracle::resolve_market_with_proof_handler(ctx, args)
    }

    pub fn confirm_market(ctx: Context<ConfirmMarket>) -> Result<()> {
        instructions::market::confirm_market_handler(ctx)
    }

    pub fn void_market(ctx: Context<VoidMarket>) -> Result<()> {
        instructions::market::void_market_handler(ctx)
    }

    // ===== Trading =====

    pub fn create_order(ctx: Context<CreateOrder>, side: OrderSide, outcome_index: u8, price_bps: u16, quantity: u64, nonce: u64, expires_at: i64) -> Result<()> {
        instructions::order::create_order_handler(ctx, side, outcome_index, price_bps, quantity, nonce, expires_at)
    }

    pub fn cancel_order(ctx: Context<CancelOrder>) -> Result<()> { instructions::order::cancel_order_handler(ctx) }
    pub fn expire_order(ctx: Context<ExpireOrder>) -> Result<()> { instructions::order::expire_order_handler(ctx) }
    pub fn cancel_order_after_lock(ctx: Context<CancelOrderAfterLock>) -> Result<()> {
        instructions::order::cancel_order_after_lock_handler(ctx)
    }

    pub fn settle_complete_set<'info>(
        ctx: Context<'info, SettleCompleteSet<'info>>,
        fill_seq: u64,
        prices_bps: Vec<u16>,
        quantity: u64,
    ) -> Result<()> {
        instructions::trade::settle_complete_set_handler(
            ctx,
            fill_seq,
            prices_bps,
            quantity,
        )
    }

    pub fn settle_share_trade(
        ctx: Context<SettleShareTrade>,
        fill_seq: u64,
        outcome_index: u8,
        price_bps: u16,
        quantity: u64,
    ) -> Result<()> {
        instructions::trade::settle_share_trade_handler(
            ctx,
            fill_seq,
            outcome_index,
            price_bps,
            quantity,
        )
    }

    // ===== Redemption =====

    pub fn claim(ctx: Context<Claim>) -> Result<()> {
        instructions::redeem::claim_handler(ctx)
    }

    pub fn cleanup_position(ctx: Context<CleanupPosition>) -> Result<()> {
        instructions::redeem::cleanup_position_handler(ctx)
    }

    pub fn close_market_vault(ctx: Context<CloseMarketVault>) -> Result<()> {
        instructions::redeem::close_market_vault_handler(ctx)
    }

    pub fn split(ctx: Context<Split>, amount: u64) -> Result<()> {
        instructions::ctf::split_handler(ctx, amount)
    }

    pub fn merge(ctx: Context<Merge>, amount: u64) -> Result<()> {
        instructions::ctf::merge_handler(ctx, amount)
    }
}
