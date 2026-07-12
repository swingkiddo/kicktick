use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{constants::*, errors::KickTickError, instructions::token::*, state::*};

#[derive(Accounts)]
pub struct InitUser<'info> {
    #[account(mut)] pub user: Signer<'info>,
    #[account(init_if_needed, payer = user, space = UserAccount::LEN, seeds = [SEED_USER, user.key().as_ref()], bump)]
    pub user_account: Account<'info, UserAccount>,
    #[account(init_if_needed, payer = user, seeds = [SEED_USER_VAULT, user.key().as_ref()], bump,
        token::mint = collateral_mint, token::authority = user_account, token::token_program = token_program)]
    pub user_vault: Account<'info, TokenAccount>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)] pub config: Account<'info, Config>,
    #[account(address = config.collateral_mint @ KickTickError::InvalidCollateralMint)] pub collateral_mint: Account<'info, Mint>,
    #[account(address = config.collateral_token_program @ KickTickError::InvalidCollateralTokenProgram)] pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    pub user: Signer<'info>,
    #[account(mut, seeds = [SEED_USER, user.key().as_ref()], bump = user_account.bump, constraint = user_account.owner == user.key() @ KickTickError::Unauthorized)]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut, seeds = [SEED_USER_VAULT, user.key().as_ref()], bump = user_account.vault_bump,
        token::mint = collateral_mint, token::authority = user_account, token::token_program = token_program)]
    pub user_vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = collateral_mint, token::authority = user, token::token_program = token_program)]
    pub user_source: Account<'info, TokenAccount>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)] pub config: Account<'info, Config>,
    #[account(address = config.collateral_mint @ KickTickError::InvalidCollateralMint)] pub collateral_mint: Account<'info, Mint>,
    #[account(address = config.collateral_token_program @ KickTickError::InvalidCollateralTokenProgram)] pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub user: Signer<'info>,
    #[account(mut, seeds = [SEED_USER, user.key().as_ref()], bump = user_account.bump, constraint = user_account.owner == user.key() @ KickTickError::Unauthorized)]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut, seeds = [SEED_USER_VAULT, user.key().as_ref()], bump = user_account.vault_bump,
        token::mint = collateral_mint, token::authority = user_account, token::token_program = token_program)]
    pub user_vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = collateral_mint, token::authority = user, token::token_program = token_program)]
    pub user_destination: Account<'info, TokenAccount>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump)] pub config: Account<'info, Config>,
    #[account(address = config.collateral_mint @ KickTickError::InvalidCollateralMint)] pub collateral_mint: Account<'info, Mint>,
    #[account(address = config.collateral_token_program @ KickTickError::InvalidCollateralTokenProgram)] pub token_program: Program<'info, Token>,
}

pub fn init_user_handler(ctx: Context<InitUser>) -> Result<()> {
    validate_collateral(&ctx.accounts.config, &ctx.accounts.collateral_mint, ctx.accounts.token_program.key())?;
    let account = &mut ctx.accounts.user_account;
    if account.owner == Pubkey::default() {
        account.owner = ctx.accounts.user.key(); account.available_balance = 0; account.reserved_balance = 0;
        account.vault_bump = ctx.bumps.user_vault; account.bump = ctx.bumps.user_account;
    } else {
        require_keys_eq!(account.owner, ctx.accounts.user.key(), KickTickError::Unauthorized);
        require!(account.vault_bump == ctx.bumps.user_vault, KickTickError::InvalidAccountData);
    }
    validate_user_vault(&ctx.accounts.config, &ctx.accounts.user_vault, account.key())
}

pub fn deposit_handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, KickTickError::ZeroAmount);
    validate_collateral(&ctx.accounts.config, &ctx.accounts.collateral_mint, ctx.accounts.token_program.key())?;
    validate_user_vault(&ctx.accounts.config, &ctx.accounts.user_vault, ctx.accounts.user_account.key())?;
    transfer_checked(ctx.accounts.token_program.to_account_info(), ctx.accounts.user_source.to_account_info(),
        ctx.accounts.collateral_mint.to_account_info(), ctx.accounts.user_vault.to_account_info(),
        ctx.accounts.user.to_account_info(), amount, ctx.accounts.config.collateral_decimals, None)?;
    ctx.accounts.user_account.available_balance = ctx.accounts.user_account.available_balance.checked_add(amount).ok_or(KickTickError::Overflow)?;
    Ok(())
}

pub fn withdraw_handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, KickTickError::ZeroAmount);
    require!(ctx.accounts.user_account.available_balance >= amount, KickTickError::InsufficientBalance);
    validate_collateral(&ctx.accounts.config, &ctx.accounts.collateral_mint, ctx.accounts.token_program.key())?;
    validate_user_custody(&ctx.accounts.user_account, &ctx.accounts.user_vault)?;
    let owner = ctx.accounts.user.key(); let bump = [ctx.accounts.user_account.bump];
    let seeds: &[&[u8]] = &[SEED_USER, owner.as_ref(), &bump];
    transfer_checked(ctx.accounts.token_program.to_account_info(), ctx.accounts.user_vault.to_account_info(),
        ctx.accounts.collateral_mint.to_account_info(), ctx.accounts.user_destination.to_account_info(),
        ctx.accounts.user_account.to_account_info(), amount, ctx.accounts.config.collateral_decimals, Some(&[seeds]))?;
    ctx.accounts.user_account.available_balance = ctx.accounts.user_account.available_balance.checked_sub(amount).ok_or(KickTickError::Overflow)?;
    Ok(())
}
