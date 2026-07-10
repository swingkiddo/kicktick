use crate::constants::*;
use crate::errors::KickTickError;
use crate::instructions::market::ensure_system_vault;
use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitUser<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = UserAccount::LEN,
        seeds = [SEED_USER, user.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,

    /// CHECK: System-owned SOL vault PDA. Created and verified in the handler.
    #[account(mut)]
    pub user_vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = UserAccount::LEN,
        seeds = [SEED_USER, user.key().as_ref()],
        bump
    )]
    pub user_account: Account<'info, UserAccount>,

    /// CHECK: System-owned SOL vault PDA. Created and verified in the handler.
    #[account(mut)]
    pub user_vault: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [SEED_USER, user.key().as_ref()],
        bump = user_account.bump,
        constraint = user_account.owner == user.key() @ KickTickError::Unauthorized,
    )]
    pub user_account: Account<'info, UserAccount>,

    #[account(
        mut,
        seeds = [SEED_USER_VAULT, user.key().as_ref()],
        bump = user_account.vault_bump,
    )]
    pub user_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn init_user_handler(ctx: Context<InitUser>) -> Result<()> {
    init_user_account(
        &mut ctx.accounts.user_account,
        ctx.accounts.user.key(),
        ctx.bumps.user_account,
        ctx.accounts.user_vault.to_account_info(),
        ctx.accounts.user.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.program_id,
    )
}

pub fn deposit_handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    require!(amount > 0, KickTickError::ZeroAmount);

    init_user_account(
        &mut ctx.accounts.user_account,
        ctx.accounts.user.key(),
        ctx.bumps.user_account,
        ctx.accounts.user_vault.to_account_info(),
        ctx.accounts.user.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.program_id,
    )?;

    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.user.to_account_info(),
                to: ctx.accounts.user_vault.to_account_info(),
            },
        ),
        amount,
    )?;

    let user_account = &mut ctx.accounts.user_account;
    user_account.available_balance = user_account
        .available_balance
        .checked_add(amount)
        .ok_or(KickTickError::Overflow)?;

    Ok(())
}

pub fn withdraw_handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    require!(amount > 0, KickTickError::ZeroAmount);

    let user_account = &mut ctx.accounts.user_account;
    require!(
        user_account.available_balance >= amount,
        KickTickError::InsufficientBalance
    );

    user_account.available_balance = user_account
        .available_balance
        .checked_sub(amount)
        .ok_or(KickTickError::Overflow)?;

    let user_key = ctx.accounts.user.key();
    let bump = [user_account.vault_bump];
    let signer_seeds: &[&[u8]] = &[SEED_USER_VAULT, user_key.as_ref(), &bump];

    anchor_lang::system_program::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.user_vault.to_account_info(),
                to: ctx.accounts.user.to_account_info(),
            },
            &[signer_seeds],
        ),
        amount,
    )?;

    Ok(())
}

fn init_user_account<'info>(
    user_account: &mut Account<'info, UserAccount>,
    user: Pubkey,
    user_bump: u8,
    user_vault: AccountInfo<'info>,
    payer: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    program_id: &Pubkey,
) -> Result<()> {
    let (vault_pda, vault_bump) =
        Pubkey::find_program_address(&[SEED_USER_VAULT, user.as_ref()], program_id);
    require!(
        user_vault.key() == vault_pda,
        KickTickError::InvalidAccountData
    );

    let bump = [vault_bump];
    let vault_seeds: &[&[u8]] = &[SEED_USER_VAULT, user.as_ref(), &bump];
    ensure_system_vault(user_vault, payer, system_program, vault_seeds)?;

    if user_account.owner == Pubkey::default() {
        user_account.owner = user;
        user_account.available_balance = 0;
        user_account.reserved_balance = 0;
        user_account.vault_bump = vault_bump;
        user_account.bump = user_bump;
    } else {
        require!(user_account.owner == user, KickTickError::Unauthorized);
        require!(
            user_account.vault_bump == vault_bump,
            KickTickError::InvalidAccountData
        );
    }

    Ok(())
}
