use anchor_lang::prelude::*;
use anchor_lang::solana_program;

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
    /// CHECK: A zero-data system PDA created and verified by the handler.
    #[account(mut)]
    pub market_vault: UncheckedAccount<'info>,
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

    let market_key = market.key();
    let (vault_pda, vault_bump) =
        Pubkey::find_program_address(&[SEED_MARKET_VAULT, market_key.as_ref()], ctx.program_id);
    require_keys_eq!(
        ctx.accounts.market_vault.key(),
        vault_pda,
        KickTickError::InvalidAccountData
    );
    ensure_system_vault(
        ctx.accounts.market_vault.to_account_info(),
        ctx.accounts.authority.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        &[SEED_MARKET_VAULT, market_key.as_ref(), &[vault_bump]],
    )?;
    market.vault_bump = vault_bump;
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

pub fn ensure_system_vault<'info>(
    vault: AccountInfo<'info>,
    payer: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    seeds: &[&[u8]],
) -> Result<()> {
    require_keys_eq!(
        *system_program.key,
        solana_program::system_program::ID,
        KickTickError::InvalidAccountData
    );
    if vault.lamports() == 0 {
        let rent = Rent::get()?;
        let ix = solana_program::system_instruction::create_account(
            payer.key,
            vault.key,
            rent.minimum_balance(0),
            0,
            &solana_program::system_program::ID,
        );
        solana_program::program::invoke_signed(
            &ix,
            &[payer, vault.clone(), system_program],
            &[seeds],
        )?;
    }
    require_keys_eq!(
        *vault.owner,
        solana_program::system_program::ID,
        KickTickError::InvalidAccountData
    );
    require!(vault.data_is_empty(), KickTickError::InvalidAccountData);
    Ok(())
}
