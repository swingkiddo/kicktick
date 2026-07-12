use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, TokenAccount, TransferChecked};

use crate::{errors::KickTickError, state::Config};

pub fn validate_collateral(config: &Config, mint: &Account<Mint>, token_program: Pubkey) -> Result<()> {
    require_keys_eq!(mint.key(), config.collateral_mint, KickTickError::InvalidCollateralMint);
    require_keys_eq!(token_program, config.collateral_token_program, KickTickError::InvalidCollateralTokenProgram);
    require!(mint.decimals == config.collateral_decimals, KickTickError::InvalidCollateralDecimals);
    Ok(())
}

pub fn validate_user_vault(config: &Config, vault: &Account<TokenAccount>, authority: Pubkey) -> Result<()> {
    require_keys_eq!(vault.mint, config.collateral_mint, KickTickError::InvalidTokenAccount);
    require_keys_eq!(vault.owner, authority, KickTickError::InvalidTokenAccount);
    Ok(())
}

pub fn validate_user_custody(user: &crate::state::UserAccount, vault: &Account<TokenAccount>) -> Result<()> {
    let ledger = user.available_balance.checked_add(user.reserved_balance).ok_or(KickTickError::Overflow)?;
    require!(ledger <= vault.amount, KickTickError::CollateralCustodyMismatch);
    Ok(())
}

pub fn transfer_checked<'info>(
    token_program: AccountInfo<'info>, source: AccountInfo<'info>, mint: AccountInfo<'info>,
    destination: AccountInfo<'info>, authority: AccountInfo<'info>, amount: u64, decimals: u8,
    signer_seeds: Option<&[&[&[u8]]]>,
) -> Result<()> {
    let accounts = TransferChecked { from: source, mint, to: destination, authority };
    match signer_seeds {
        Some(seeds) => token::transfer_checked(CpiContext::new_with_signer(*token_program.key, accounts, seeds), amount, decimals),
        None => token::transfer_checked(CpiContext::new(*token_program.key, accounts), amount, decimals),
    }
}

pub fn price_cost(quantity: u64, price_bps: u16) -> Result<u64> {
    let value = (quantity as u128).checked_mul(price_bps as u128).ok_or(KickTickError::Overflow)?
        .checked_div(crate::constants::PRICE_SCALE_BPS as u128).ok_or(KickTickError::DivisionByZero)?;
    u64::try_from(value).map_err(|_| KickTickError::Overflow.into())
}
