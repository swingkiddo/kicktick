use anchor_lang::prelude::*;
use crate::constants::*;
use crate::errors::KickTickError;
use crate::state::*;

#[derive(Accounts)]
pub struct ConfirmRound<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_MATCH, &match_pda.fixture_id.to_le_bytes()],
        bump = match_pda.bump,
    )]
    pub match_pda: Account<'info, Match_>,

    #[account(
        mut,
        seeds = [SEED_ROUND, match_pda.key().as_ref(), &round.round_id.to_le_bytes()],
        bump = round.bump,
    )]
    pub round: Account<'info, Round>,
}

pub fn handler(ctx: Context<ConfirmRound>) -> Result<()> {
    let round = &mut ctx.accounts.round;

    require!(
        round.status == RoundStatus::ResolvedPending,
        KickTickError::RoundNotSettled
    );

    round.status = RoundStatus::Settled;

    Ok(())
}
