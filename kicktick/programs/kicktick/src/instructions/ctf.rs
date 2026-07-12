use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{constants::*, errors::KickTickError, instructions::token::transfer_checked, state::*};

#[derive(Accounts)]
pub struct Split<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [SEED_USER, user.key().as_ref()], bump = user_account.bump,
        constraint = user_account.owner == user.key() @ KickTickError::Unauthorized)]
    pub user_account: Box<Account<'info, UserAccount>>,
    #[account(mut, seeds = [SEED_USER_VAULT, user.key().as_ref()], bump = user_account.vault_bump,
        token::mint = collateral_mint, token::authority = user_account, token::token_program = token_program)]
    pub user_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [SEED_MARKET_VAULT, market.key().as_ref()], bump = market.vault_bump,
        token::mint = collateral_mint, token::authority = market, token::token_program = token_program)]
    pub market_vault: Box<Account<'info, TokenAccount>>,
    #[account(init_if_needed, payer = user, space = Position::LEN,
        seeds = [SEED_POSITION, market.key().as_ref(), user.key().as_ref()], bump)]
    pub position: Box<Account<'info, Position>>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(address = config.collateral_mint @ KickTickError::InvalidCollateralMint)]
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(address = config.collateral_token_program @ KickTickError::InvalidCollateralTokenProgram)]
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Merge<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [SEED_USER, user.key().as_ref()], bump = user_account.bump,
        constraint = user_account.owner == user.key() @ KickTickError::Unauthorized)]
    pub user_account: Box<Account<'info, UserAccount>>,
    #[account(mut, seeds = [SEED_USER_VAULT, user.key().as_ref()], bump = user_account.vault_bump,
        token::mint = collateral_mint, token::authority = user_account, token::token_program = token_program)]
    pub user_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [SEED_MARKET_VAULT, market.key().as_ref()], bump = market.vault_bump,
        token::mint = collateral_mint, token::authority = market, token::token_program = token_program)]
    pub market_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_POSITION, market.key().as_ref(), user.key().as_ref()], bump = position.bump,
        constraint = position.owner == user.key() @ KickTickError::Unauthorized,
        constraint = position.market == market.key() @ KickTickError::InvalidAccountData)]
    pub position: Box<Account<'info, Position>>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(address = config.collateral_mint @ KickTickError::InvalidCollateralMint)]
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(address = config.collateral_token_program @ KickTickError::InvalidCollateralTokenProgram)]
    pub token_program: Program<'info, Token>,
}

fn binary_open(market: &Market) -> Result<()> {
    require!(market.outcome_count == 2, KickTickError::BinaryMarketOnly);
    require!(market.status == MarketStatus::Open, KickTickError::MarketNotOpen);
    require!(Clock::get()?.unix_timestamp < market.expires_at, KickTickError::DeadlinePassed);
    Ok(())
}

pub fn split_handler(ctx: Context<Split>, amount: u64) -> Result<()> {
    require!(amount > 0, KickTickError::ZeroAmount);
    binary_open(&ctx.accounts.market)?;
    require!(ctx.accounts.user_account.available_balance >= amount, KickTickError::InsufficientBalance);
    let owner = ctx.accounts.user.key();
    let bump = [ctx.accounts.user_account.bump];
    let seeds: &[&[u8]] = &[SEED_USER, owner.as_ref(), &bump];
    transfer_checked(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.user_vault.to_account_info(),
        ctx.accounts.collateral_mint.to_account_info(),
        ctx.accounts.market_vault.to_account_info(),
        ctx.accounts.user_account.to_account_info(),
        amount,
        ctx.accounts.config.collateral_decimals,
        Some(&[seeds]),
    )?;
    ctx.accounts.user_account.available_balance = ctx.accounts.user_account.available_balance.checked_sub(amount).ok_or(KickTickError::Overflow)?;
    if ctx.accounts.position.owner == Pubkey::default() {
        ctx.accounts.position.init_if_needed(ctx.accounts.user.key(), ctx.accounts.market.key(), ctx.bumps.position);
        ctx.accounts.market.open_positions = ctx.accounts.market.open_positions.checked_add(1).ok_or(KickTickError::Overflow)?;
    }
    ctx.accounts.position.shares[0] = ctx.accounts.position.shares[0].checked_add(amount).ok_or(KickTickError::Overflow)?;
    ctx.accounts.position.shares[1] = ctx.accounts.position.shares[1].checked_add(amount).ok_or(KickTickError::Overflow)?;
    ctx.accounts.market.collateral = ctx.accounts.market.collateral.checked_add(amount).ok_or(KickTickError::Overflow)?;
    Ok(())
}

pub fn merge_handler(ctx: Context<Merge>, amount: u64) -> Result<()> {
    require!(amount > 0, KickTickError::ZeroAmount);
    binary_open(&ctx.accounts.market)?;
    let available_yes = ctx.accounts.position.shares[0].checked_sub(ctx.accounts.position.locked_shares[0]).ok_or(KickTickError::Overflow)?;
    let available_no = ctx.accounts.position.shares[1].checked_sub(ctx.accounts.position.locked_shares[1]).ok_or(KickTickError::Overflow)?;
    require!(available_yes >= amount && available_no >= amount, KickTickError::InsufficientShares);
    require!(ctx.accounts.market.collateral >= amount, KickTickError::InsufficientLiquidity);
    let fixture = ctx.accounts.market.fixture_id.to_le_bytes();
    let market_type = [ctx.accounts.market.market_type as u8];
    let seq = ctx.accounts.market.market_seq.to_le_bytes();
    let bump = [ctx.accounts.market.bump];
    transfer_checked(
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.market_vault.to_account_info(),
        ctx.accounts.collateral_mint.to_account_info(),
        ctx.accounts.user_vault.to_account_info(),
        ctx.accounts.market.to_account_info(),
        amount,
        ctx.accounts.config.collateral_decimals,
        Some(&[&[SEED_MARKET, &fixture, &market_type, &seq, &bump]]),
    )?;
    ctx.accounts.position.shares[0] -= amount;
    ctx.accounts.position.shares[1] -= amount;
    ctx.accounts.market.collateral -= amount;
    ctx.accounts.user_account.available_balance = ctx.accounts.user_account.available_balance.checked_add(amount).ok_or(KickTickError::Overflow)?;
    Ok(())
}
