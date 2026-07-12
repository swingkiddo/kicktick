use crate::constants::*;
use crate::state::*;
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};
use crate::errors::KickTickError;

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = Config::LEN,
        seeds = [SEED_CONFIG],
        bump,
    )]
    pub config: Account<'info, Config>,

    #[account(address = DEVNET_USDC_MINT @ KickTickError::InvalidCollateralMint)]
    pub collateral_mint: Account<'info, Mint>,
    #[account(address = anchor_spl::token::ID @ KickTickError::InvalidCollateralTokenProgram)]
    pub token_program: Program<'info, Token>,

    pub system_program: Program<'info, System>,
}

pub fn init_config_handler(ctx: Context<InitConfig>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.relayer = ctx.accounts.admin.key();
    config.txoracle_program_id = TXORACLE_PROGRAM_ID;
    config.daily_scores_merkle_roots = Pubkey::find_program_address(
        &[b"daily_scores_merkle_roots"],
        &TXORACLE_PROGRAM_ID,
    )
    .0;
    config.finality_delay = 0;
    require!(ctx.accounts.collateral_mint.decimals == USDC_DECIMALS, KickTickError::InvalidCollateralDecimals);
    config.min_liquidity = MIN_MARKET_LIQUIDITY_BASE_UNITS;
    config.collateral_mint = ctx.accounts.collateral_mint.key();
    config.collateral_decimals = ctx.accounts.collateral_mint.decimals;
    config.collateral_token_program = ctx.accounts.token_program.key();
    config.bump = ctx.bumps.config;

    Ok(())
}
