use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::KickTickError;
use crate::state::*;

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, seeds = [SEED_USER, user.key().as_ref()], bump = user_account.bump, constraint = user_account.owner == user.key() @ KickTickError::Unauthorized)]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut, seeds = [SEED_USER_VAULT, user.key().as_ref()], bump = user_account.vault_bump)]
    pub user_vault: SystemAccount<'info>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, seeds = [SEED_MARKET_VAULT, market.key().as_ref()], bump = market.vault_bump)]
    pub market_vault: SystemAccount<'info>,
    #[account(mut, seeds = [SEED_POSITION, market.key().as_ref(), user.key().as_ref()], bump = position.bump, constraint = position.owner == user.key() @ KickTickError::Unauthorized, constraint = position.market == market.key() @ KickTickError::InvalidAccountData, close = user)]
    pub position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
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
    #[account(mut, seeds = [SEED_MARKET_VAULT, market.key().as_ref()], bump = market.vault_bump)]
    pub market_vault: SystemAccount<'info>,
    #[account(mut)]
    pub recipient: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn claim_handler(ctx: Context<Claim>) -> Result<()> {
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
            market.key(),
            ctx.accounts.market_vault.to_account_info(),
            ctx.accounts.user_vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            payout,
        )?;
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
    let amount = ctx.accounts.market_vault.lamports();
    if amount > 0 {
        transfer_market_balance(
            &ctx.accounts.market,
            ctx.accounts.market.key(),
            ctx.accounts.market_vault.to_account_info(),
            ctx.accounts.recipient.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            amount,
        )?;
    }
    Ok(())
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
    market_key: Pubkey,
    source: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    let bump = [market.vault_bump];
    let seeds: &[&[u8]] = &[SEED_MARKET_VAULT, market_key.as_ref(), &bump];
    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            system_program.key(),
            anchor_lang::system_program::Transfer {
                from: source,
                to: destination,
            },
            &[seeds],
        ),
        amount,
    )
}
