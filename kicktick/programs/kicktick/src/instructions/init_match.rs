use crate::constants::*;
use crate::errors::KickTickError;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(fixture_id: i64, home_team: String, away_team: String)]
pub struct InitMatch<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        seeds = [SEED_CONFIG],
        bump = config.bump,
        constraint = config.admin == creator.key() @ KickTickError::Unauthorized,
    )]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = creator,
        space = Match_::LEN,
        seeds = [SEED_MATCH, &fixture_id.to_le_bytes()],
        bump
    )]
    pub match_pda: Account<'info, Match_>,

    pub system_program: Program<'info, System>,
}

pub fn init_match_handler(
    ctx: Context<InitMatch>,
    fixture_id: i64,
    home_team: String,
    away_team: String,
) -> Result<()> {
    require!(fixture_id > 0, KickTickError::InvalidFixtureId);
    require!(
        home_team.len() <= Match_::MAX_TEAM_NAME,
        KickTickError::InvalidAccountData
    );
    require!(
        away_team.len() <= Match_::MAX_TEAM_NAME,
        KickTickError::InvalidAccountData
    );

    let match_pda = &mut ctx.accounts.match_pda;
    match_pda.fixture_id = fixture_id;
    match_pda.status = MatchStatus::Pending;
    match_pda.home_team = home_team;
    match_pda.away_team = away_team;
    match_pda.competition_id = 0;

    // Retained only as an account-layout compatibility field. Match-level
    // collateral custody was removed; active custody is per-market USDC.
    match_pda.vault_bump = 0;

    match_pda.round_counter = 0;
    match_pda.total_deposited = 0;
    match_pda.total_sponsored = 0;
    match_pda.created_at = Clock::get()?.unix_timestamp;
    match_pda.bump = ctx.bumps.match_pda;

    Ok(())
}
