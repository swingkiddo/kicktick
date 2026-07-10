use crate::constants::*;
use crate::state::*;
use anchor_lang::prelude::*;

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

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitConfig>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.relayer = ctx.accounts.admin.key();
    config.txoracle_program_id = TXORACLE_PROGRAM_ID;
    config.daily_scores_merkle_roots = Pubkey::find_program_address(
        &[b"daily_scores_merkle_roots"],
        &TXORACLE_PROGRAM_ID,
    )
    .0;
    config.min_liquidity = MIN_ROUND_LIQUIDITY;
    config.bump = ctx.bumps.config;

    Ok(())
}
