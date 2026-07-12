use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::KickTickError;
use crate::state::*;

#[derive(Accounts)]
pub struct SetRelayer<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [SEED_CONFIG], bump = config.bump,
        constraint = config.admin == admin.key() @ KickTickError::Unauthorized)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(fixture_id: i64, market_type: MarketType, market_seq: u64)]
pub struct InitMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump,
        constraint = config.admin == authority.key() @ KickTickError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(init, payer = authority, space = Market::LEN,
        seeds = [SEED_MARKET, &fixture_id.to_le_bytes(), &[market_type as u8], &market_seq.to_le_bytes()], bump)]
    pub market: Account<'info, Market>,
    #[account(init, payer = authority, seeds = [SEED_MARKET_VAULT, market.key().as_ref()], bump,
        token::mint = collateral_mint, token::authority = market, token::token_program = token_program)]
    pub market_vault: Account<'info, TokenAccount>,
    #[account(address = config.collateral_mint @ KickTickError::InvalidCollateralMint)]
    pub collateral_mint: Account<'info, Mint>,
    #[account(address = config.collateral_token_program @ KickTickError::InvalidCollateralTokenProgram)]
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LockMarket<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct ResolveMarketOffchain<'info> {
    pub relayer: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump,
        constraint = config.relayer == relayer.key() @ KickTickError::UnauthorizedRelayer)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct ConfirmMarket<'info> {
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct VoidMarket<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump,
        constraint = config.admin == authority.key() @ KickTickError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Account<'info, Market>,
}

pub fn set_relayer_handler(ctx: Context<SetRelayer>, relayer: Pubkey) -> Result<()> {
    require!(
        relayer != Pubkey::default(),
        KickTickError::InvalidAccountData
    );
    ctx.accounts.config.relayer = relayer;
    Ok(())
}

pub fn init_market_handler(
    ctx: Context<InitMarket>,
    fixture_id: i64,
    market_type: MarketType,
    market_seq: u64,
    params: MarketParams,
    deadline_seconds: i64,
) -> Result<()> {
    require!(fixture_id > 0, KickTickError::InvalidFixtureId);
    require!(
        (MIN_MARKET_DURATION..=MAX_MARKET_DURATION).contains(&deadline_seconds),
        KickTickError::InvalidDuration
    );
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;
    market.fixture_id = fixture_id;
    market.market_type = market_type;
    market.market_seq = market_seq;
    market.params = params;
    market.outcome_count = Market::outcome_count_for(market_type);
    market.status = MarketStatus::Open;
    market.winner = None;
    market.expires_at = clock
        .unix_timestamp
        .checked_add(deadline_seconds)
        .ok_or(KickTickError::Overflow)?;
    market.resolved_at = 0;
    market.void_payout_bps = if market.outcome_count == 2 {
        [5_000, 5_000, 0]
    } else {
        [3_334, 3_333, 3_333]
    };
    market.collateral = 0;
    market.total_volume = 0;
    market.fill_sequence = 0;
    market.open_positions = 0;
    market.bump = ctx.bumps.market;

    crate::instructions::token::validate_collateral(&ctx.accounts.config, &ctx.accounts.collateral_mint, ctx.accounts.token_program.key())?;
    market.vault_bump = ctx.bumps.market_vault;
    Ok(())
}

pub fn lock_market_handler(ctx: Context<LockMarket>) -> Result<()> {
    let clock = Clock::get()?;
    let market = &mut ctx.accounts.market;
    require!(
        market.status == MarketStatus::Open,
        KickTickError::MarketNotOpen
    );
    require!(
        ctx.accounts.authority.key() == ctx.accounts.config.relayer
            || clock.unix_timestamp >= market.expires_at,
        KickTickError::UnauthorizedRelayer
    );
    market.status = MarketStatus::Locked;
    Ok(())
}

pub fn resolve_market_offchain_handler(
    ctx: Context<ResolveMarketOffchain>,
    winner: u8,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    require!(
        !Market::requires_oracle(market.market_type),
        KickTickError::OracleResolutionRequired
    );
    resolve_pending(market, winner, Clock::get()?.unix_timestamp)
}

pub fn confirm_market_handler(ctx: Context<ConfirmMarket>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    require!(
        market.status == MarketStatus::ResolvedPending,
        KickTickError::MarketNotResolved
    );
    market.status = MarketStatus::Resolved;
    Ok(())
}

pub fn void_market_handler(ctx: Context<VoidMarket>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    require!(
        matches!(
            market.status,
            MarketStatus::Open | MarketStatus::Locked | MarketStatus::ResolvedPending
        ),
        KickTickError::MarketNotTerminal
    );
    market.status = MarketStatus::Voided;
    market.winner = None;
    Ok(())
}

pub fn resolve_pending(market: &mut Market, winner: u8, now: i64) -> Result<()> {
    require!(
        market.status == MarketStatus::Locked,
        KickTickError::MarketNotLocked
    );
    require!(
        winner < market.outcome_count,
        KickTickError::InvalidOutcomeIndex
    );
    market.winner = Some(winner);
    market.resolved_at = now;
    market.status = MarketStatus::ResolvedPending;
    Ok(())
}
