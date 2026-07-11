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

declare_id!("7Pc2ipKnDya7UKhQVQA2zdateaLpgHGQbyNt34R5dNF4");

#[program]
pub mod kicktick {
    use super::*;

    // ===== Config =====

    pub fn init_config(ctx: Context<InitConfig>) -> Result<()> {
        instructions::init_config::handler(ctx)
    }

    pub fn init_match(
        ctx: Context<InitMatch>,
        fixture_id: i64,
        home_team: String,
        away_team: String,
    ) -> Result<()> {
        instructions::init_match::handler(ctx, fixture_id, home_team, away_team)
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

    pub fn settle_complete_set_binary(
        ctx: Context<SettleCompleteSetBinary>,
        fill_seq: u64,
        price_0_bps: u16,
        price_1_bps: u16,
        quantity: u64,
    ) -> Result<()> {
        instructions::trade::settle_complete_set_binary_handler(
            ctx,
            fill_seq,
            price_0_bps,
            price_1_bps,
            quantity,
        )
    }

    pub fn settle_complete_set_ternary(
        ctx: Context<SettleCompleteSetTernary>,
        fill_seq: u64,
        price_0_bps: u16,
        price_1_bps: u16,
        price_2_bps: u16,
        quantity: u64,
    ) -> Result<()> {
        instructions::trade::settle_complete_set_ternary_handler(
            ctx,
            fill_seq,
            price_0_bps,
            price_1_bps,
            price_2_bps,
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
}
