use anchor_lang::prelude::*;
use crate::state::*;
use crate::constants::*;
use crate::errors::KickTickError;

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
        seeds = [SEED_MATCH, fixture_id.to_le_bytes().as_ref()],
        bump
    )]
    pub match_pda: Account<'info, Match_>,

    /// Vault: system-owned PDA, created here.
    #[account(mut)]
    pub match_vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
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

    let (vault_pda, vault_bump) = Pubkey::find_program_address(
        &[SEED_MATCH_VAULT, match_pda.key().as_ref()],
        &ctx.program_id,
    );

    // Enforce vault is the correctly derived PDA
    require!(
        ctx.accounts.match_vault.key() == vault_pda,
        KickTickError::InvalidAccountData
    );

    match_pda.vault_bump = vault_bump;
    match_pda.vault_authority_bump = vault_bump;

    // Create vault system account if not exists (0 data, system-owned, rent-exempt)
    if ctx.accounts.match_vault.lamports() == 0 || *ctx.accounts.match_vault.owner != system_program::ID {
        let rent = Rent::get()?;
        let cpi_accounts = anchor_lang::system_program::CreateAccount {
            from: ctx.accounts.creator.to_account_info(),
            to: ctx.accounts.match_vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            *ctx.accounts.system_program.key,
            cpi_accounts,
        );
        anchor_lang::system_program::create_account(
            cpi_ctx,
            rent.minimum_balance(0),
            0,
            &system_program::ID,
        )?;
    }

    match_pda.round_counter = 0;
    match_pda.total_deposited = 0;
    match_pda.total_sponsored = 0;
    match_pda.created_at = Clock::get()?.unix_timestamp;
    match_pda.bump = ctx.bumps.match_pda;

    Ok(())
}
