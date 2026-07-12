use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::KickTickError;
use crate::state::*;

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [SEED_USER, user.key().as_ref()], bump = user_account.bump, constraint = user_account.owner == user.key() @ KickTickError::Unauthorized)]
    pub user_account: Box<Account<'info, UserAccount>>,
    #[account(mut, seeds = [SEED_USER_VAULT, user.key().as_ref()], bump = user_account.vault_bump,
        token::mint = collateral_mint, token::authority = user_account, token::token_program = token_program)]
    pub user_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [SEED_MARKET_VAULT, market.key().as_ref()], bump = market.vault_bump,
        token::mint = collateral_mint, token::authority = market, token::token_program = token_program)]
    pub market_vault: Box<Account<'info, TokenAccount>>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)] pub config: Box<Account<'info, Config>>,
    #[account(address = config.collateral_mint @ KickTickError::InvalidCollateralMint)] pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(address = config.collateral_token_program @ KickTickError::InvalidCollateralTokenProgram)] pub token_program: Program<'info, Token>,
    #[account(mut, seeds = [SEED_POSITION, market.key().as_ref(), user.key().as_ref()], bump = position.bump, constraint = position.owner == user.key() @ KickTickError::Unauthorized, constraint = position.market == market.key() @ KickTickError::InvalidAccountData, close = user)]
    pub position: Box<Account<'info, Position>>,
}

#[derive(Accounts)]
pub struct CleanupPosition<'info> {
    pub relayer: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = config.relayer == relayer.key() @ KickTickError::UnauthorizedRelayer)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Account<'info, Market>,
    /// CHECK: receives the closed position's rent.
    #[account(mut)]
    pub position_owner: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_POSITION, market.key().as_ref(), position_owner.key().as_ref()], bump = position.bump, constraint = position.owner == position_owner.key() @ KickTickError::Unauthorized, constraint = position.market == market.key() @ KickTickError::InvalidAccountData, close = position_owner)]
    pub position: Account<'info, Position>,
}

#[derive(Accounts)]
pub struct CloseMarketVault<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = config.admin == authority.key() @ KickTickError::Unauthorized)]
    pub config: Account<'info, Config>,
    #[account(seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [SEED_MARKET_VAULT, market.key().as_ref()], bump = market.vault_bump,
        token::mint = collateral_mint, token::authority = market, token::token_program = token_program)]
    pub market_vault: Account<'info, TokenAccount>,
    #[account(address = config.collateral_mint @ KickTickError::InvalidCollateralMint)] pub collateral_mint: Account<'info, Mint>,
    #[account(address = config.collateral_token_program @ KickTickError::InvalidCollateralTokenProgram)] pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub recipient: SystemAccount<'info>,
}

pub fn claim_handler(ctx: Context<Claim>) -> Result<()> {
    let market_authority = ctx.accounts.market.to_account_info();
    let market = &mut ctx.accounts.market;
    require!(
        matches!(market.status, MarketStatus::Resolved | MarketStatus::Voided),
        KickTickError::MarketNotConfirmed
    );
    require!(
        !ctx.accounts.position.claimed,
        KickTickError::AlreadyClaimed
    );
    let payout = if market.status == MarketStatus::Resolved {
        let winner = market.winner.ok_or(KickTickError::MarketNotResolved)? as usize;
        require!(
            winner < market.outcome_count as usize,
            KickTickError::InvalidOutcomeIndex
        );
        ctx.accounts.position.shares[winner]
    } else {
        let mut value = 0u64;
        for index in 0..market.outcome_count as usize {
            value = value
                .checked_add(payout_for(
                    ctx.accounts.position.shares[index],
                    market.void_payout_bps[index],
                )?)
                .ok_or(KickTickError::Overflow)?;
        }
        value
    };
    if payout > 0 {
        transfer_market_balance(
            market,
            market_authority,
            ctx.accounts.market_vault.to_account_info(),
            ctx.accounts.user_vault.to_account_info(),
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.collateral_mint.to_account_info(),
            ctx.accounts.config.collateral_decimals,
            payout,
        )?;
        market.collateral = market.collateral.checked_sub(payout).ok_or(KickTickError::InsufficientLiquidity)?;
            ctx.accounts.user_account.available_balance = ctx
                .accounts
                .user_account
            .available_balance
            .checked_add(payout)
            .ok_or(KickTickError::Overflow)?;
    }
    ctx.accounts.position.claimed = true;
    market.open_positions = market
        .open_positions
        .checked_sub(1)
        .ok_or(KickTickError::Overflow)?;
    Ok(())
}

pub fn cleanup_position_handler(ctx: Context<CleanupPosition>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    require!(
        market.status == MarketStatus::Resolved,
        KickTickError::MarketNotResolved
    );
    let winner = market.winner.ok_or(KickTickError::MarketNotResolved)? as usize;
    require!(
        ctx.accounts.position.shares[winner] == 0,
        KickTickError::NotWinner
    );
    market.open_positions = market
        .open_positions
        .checked_sub(1)
        .ok_or(KickTickError::Overflow)?;
    Ok(())
}

pub fn close_market_vault_handler(ctx: Context<CloseMarketVault>) -> Result<()> {
    require!(
        matches!(
            ctx.accounts.market.status,
            MarketStatus::Resolved | MarketStatus::Voided
        ),
        KickTickError::MarketNotTerminal
    );
    require!(
        ctx.accounts.market.open_positions == 0,
        KickTickError::MarketNotTerminal
    );
    require!(ctx.accounts.market_vault.amount == 0, KickTickError::NonZeroVaultBalance);
    let fixture = ctx.accounts.market.fixture_id.to_le_bytes();
    let market_type = [ctx.accounts.market.market_type as u8];
    let seq = ctx.accounts.market.market_seq.to_le_bytes();
    let bump = [ctx.accounts.market.bump];
    let seeds: &[&[u8]] = &[SEED_MARKET, &fixture, &market_type, &seq, &bump];
    token::close_account(CpiContext::new_with_signer(ctx.accounts.token_program.key(), CloseAccount {
        account: ctx.accounts.market_vault.to_account_info(), destination: ctx.accounts.recipient.to_account_info(),
        authority: ctx.accounts.market.to_account_info(),
    }, &[seeds]))
}

fn payout_for(shares: u64, bps: u16) -> Result<u64> {
    let payout = (shares as u128)
        .checked_mul(bps as u128)
        .ok_or(KickTickError::Overflow)?
        .checked_div(PRICE_SCALE_BPS as u128)
        .ok_or(KickTickError::DivisionByZero)?;
    u64::try_from(payout).map_err(|_| KickTickError::Overflow.into())
}
fn transfer_market_balance<'info>(
    market: &Market,
    authority: AccountInfo<'info>,
    source: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    decimals: u8,
    amount: u64,
) -> Result<()> {
    let fixture = market.fixture_id.to_le_bytes(); let market_type = [market.market_type as u8];
    let seq = market.market_seq.to_le_bytes(); let bump = [market.bump];
    let seeds: &[&[u8]] = &[SEED_MARKET, &fixture, &market_type, &seq, &bump];
    crate::instructions::token::transfer_checked(token_program, source, mint, destination,
        authority, amount, decimals, Some(&[seeds]))
}
