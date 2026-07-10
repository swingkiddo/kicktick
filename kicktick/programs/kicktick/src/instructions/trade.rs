use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::KickTickError;
use crate::state::*;

#[derive(Accounts)]
pub struct SettleCompleteSetBinary<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = config.relayer == relayer.key() @ KickTickError::UnauthorizedRelayer)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [SEED_MARKET_VAULT, market.key().as_ref()], bump = market.vault_bump)]
    pub market_vault: SystemAccount<'info>,
    /// CHECK: signatures are authenticated by the configured relayer.
    pub outcome_0_owner: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_USER, outcome_0_owner.key().as_ref()], bump = outcome_0_account.bump, constraint = outcome_0_account.owner == outcome_0_owner.key() @ KickTickError::Unauthorized)]
    pub outcome_0_account: Box<Account<'info, UserAccount>>,
    #[account(mut, seeds = [SEED_USER_VAULT, outcome_0_owner.key().as_ref()], bump = outcome_0_account.vault_bump)]
    pub outcome_0_vault: SystemAccount<'info>,
    #[account(init_if_needed, payer = relayer, space = Position::LEN, seeds = [SEED_POSITION, market.key().as_ref(), outcome_0_owner.key().as_ref()], bump)]
    pub outcome_0_position: Box<Account<'info, Position>>,
    /// CHECK: signatures are authenticated by the configured relayer.
    pub outcome_1_owner: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_USER, outcome_1_owner.key().as_ref()], bump = outcome_1_account.bump, constraint = outcome_1_account.owner == outcome_1_owner.key() @ KickTickError::Unauthorized)]
    pub outcome_1_account: Box<Account<'info, UserAccount>>,
    #[account(mut, seeds = [SEED_USER_VAULT, outcome_1_owner.key().as_ref()], bump = outcome_1_account.vault_bump)]
    pub outcome_1_vault: SystemAccount<'info>,
    #[account(init_if_needed, payer = relayer, space = Position::LEN, seeds = [SEED_POSITION, market.key().as_ref(), outcome_1_owner.key().as_ref()], bump)]
    pub outcome_1_position: Box<Account<'info, Position>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleCompleteSetTernary<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = config.relayer == relayer.key() @ KickTickError::UnauthorizedRelayer)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [SEED_MARKET_VAULT, market.key().as_ref()], bump = market.vault_bump)]
    pub market_vault: SystemAccount<'info>,
    /// CHECK: signatures are authenticated by the configured relayer.
    pub outcome_0_owner: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_USER, outcome_0_owner.key().as_ref()], bump = outcome_0_account.bump, constraint = outcome_0_account.owner == outcome_0_owner.key() @ KickTickError::Unauthorized)]
    pub outcome_0_account: Box<Account<'info, UserAccount>>,
    #[account(mut, seeds = [SEED_USER_VAULT, outcome_0_owner.key().as_ref()], bump = outcome_0_account.vault_bump)]
    pub outcome_0_vault: SystemAccount<'info>,
    #[account(init_if_needed, payer = relayer, space = Position::LEN, seeds = [SEED_POSITION, market.key().as_ref(), outcome_0_owner.key().as_ref()], bump)]
    pub outcome_0_position: Box<Account<'info, Position>>,
    /// CHECK: signatures are authenticated by the configured relayer.
    pub outcome_1_owner: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_USER, outcome_1_owner.key().as_ref()], bump = outcome_1_account.bump, constraint = outcome_1_account.owner == outcome_1_owner.key() @ KickTickError::Unauthorized)]
    pub outcome_1_account: Box<Account<'info, UserAccount>>,
    #[account(mut, seeds = [SEED_USER_VAULT, outcome_1_owner.key().as_ref()], bump = outcome_1_account.vault_bump)]
    pub outcome_1_vault: SystemAccount<'info>,
    #[account(init_if_needed, payer = relayer, space = Position::LEN, seeds = [SEED_POSITION, market.key().as_ref(), outcome_1_owner.key().as_ref()], bump)]
    pub outcome_1_position: Box<Account<'info, Position>>,
    /// CHECK: signatures are authenticated by the configured relayer.
    pub outcome_2_owner: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_USER, outcome_2_owner.key().as_ref()], bump = outcome_2_account.bump, constraint = outcome_2_account.owner == outcome_2_owner.key() @ KickTickError::Unauthorized)]
    pub outcome_2_account: Box<Account<'info, UserAccount>>,
    #[account(mut, seeds = [SEED_USER_VAULT, outcome_2_owner.key().as_ref()], bump = outcome_2_account.vault_bump)]
    pub outcome_2_vault: SystemAccount<'info>,
    #[account(init_if_needed, payer = relayer, space = Position::LEN, seeds = [SEED_POSITION, market.key().as_ref(), outcome_2_owner.key().as_ref()], bump)]
    pub outcome_2_position: Box<Account<'info, Position>>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleShareTrade<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = config.relayer == relayer.key() @ KickTickError::UnauthorizedRelayer)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    /// CHECK: signatures are authenticated by the configured relayer.
    pub buyer: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_USER, buyer.key().as_ref()], bump = buyer_account.bump, constraint = buyer_account.owner == buyer.key() @ KickTickError::Unauthorized)]
    pub buyer_account: Box<Account<'info, UserAccount>>,
    #[account(mut, seeds = [SEED_USER_VAULT, buyer.key().as_ref()], bump = buyer_account.vault_bump)]
    pub buyer_vault: SystemAccount<'info>,
    #[account(init_if_needed, payer = relayer, space = Position::LEN, seeds = [SEED_POSITION, market.key().as_ref(), buyer.key().as_ref()], bump)]
    pub buyer_position: Box<Account<'info, Position>>,
    /// CHECK: signatures are authenticated by the configured relayer.
    pub seller: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_USER, seller.key().as_ref()], bump = seller_account.bump, constraint = seller_account.owner == seller.key() @ KickTickError::Unauthorized)]
    pub seller_account: Box<Account<'info, UserAccount>>,
    #[account(mut, seeds = [SEED_USER_VAULT, seller.key().as_ref()], bump = seller_account.vault_bump)]
    pub seller_vault: SystemAccount<'info>,
    #[account(mut, seeds = [SEED_POSITION, market.key().as_ref(), seller.key().as_ref()], bump = seller_position.bump, constraint = seller_position.owner == seller.key() @ KickTickError::Unauthorized, constraint = seller_position.market == market.key() @ KickTickError::InvalidAccountData)]
    pub seller_position: Box<Account<'info, Position>>,
    pub system_program: Program<'info, System>,
}

pub fn settle_complete_set_binary_handler(
    ctx: Context<SettleCompleteSetBinary>,
    fill_seq: u64,
    p0: u16,
    p1: u16,
    quantity: u64,
) -> Result<()> {
    require!(
        ctx.accounts.outcome_0_owner.key() != ctx.accounts.outcome_1_owner.key(),
        KickTickError::InvalidAccountData
    );
    check_fill(&ctx.accounts.market, fill_seq, quantity)?;
    require!(
        ctx.accounts.market.outcome_count == 2,
        KickTickError::InvalidOutcomeCount
    );
    check_complete_prices(&[p0, p1])?;
    let c0 = price_cost(quantity, p0)?;
    let c1 = quantity.checked_sub(c0).ok_or(KickTickError::Overflow)?;
    let market_key = ctx.accounts.market.key();
    let mb = ctx.accounts.market_vault.to_account_info();
    let sys = ctx.accounts.system_program.to_account_info();
    settle_participant(
        &mut ctx.accounts.outcome_0_account,
        ctx.accounts.outcome_0_vault.to_account_info(),
        mb.clone(),
        sys.clone(),
        ctx.accounts.outcome_0_owner.key(),
        &mut ctx.accounts.outcome_0_position,
        &mut ctx.accounts.market,
        market_key,
        ctx.bumps.outcome_0_position,
        0,
        c0,
        quantity,
    )?;
    settle_participant(
        &mut ctx.accounts.outcome_1_account,
        ctx.accounts.outcome_1_vault.to_account_info(),
        mb,
        sys,
        ctx.accounts.outcome_1_owner.key(),
        &mut ctx.accounts.outcome_1_position,
        &mut ctx.accounts.market,
        market_key,
        ctx.bumps.outcome_1_position,
        1,
        c1,
        quantity,
    )?;
    record_complete_fill(&mut ctx.accounts.market, quantity)
}

pub fn settle_complete_set_ternary_handler(
    ctx: Context<SettleCompleteSetTernary>,
    fill_seq: u64,
    p0: u16,
    p1: u16,
    p2: u16,
    quantity: u64,
) -> Result<()> {
    require!(
        ctx.accounts.outcome_0_owner.key() != ctx.accounts.outcome_1_owner.key()
            && ctx.accounts.outcome_0_owner.key() != ctx.accounts.outcome_2_owner.key()
            && ctx.accounts.outcome_1_owner.key() != ctx.accounts.outcome_2_owner.key(),
        KickTickError::InvalidAccountData
    );
    check_fill(&ctx.accounts.market, fill_seq, quantity)?;
    require!(
        ctx.accounts.market.outcome_count == 3,
        KickTickError::InvalidOutcomeCount
    );
    check_complete_prices(&[p0, p1, p2])?;
    let c0 = price_cost(quantity, p0)?;
    let c1 = price_cost(quantity, p1)?;
    let c2 = quantity
        .checked_sub(c0)
        .and_then(|v| v.checked_sub(c1))
        .ok_or(KickTickError::Overflow)?;
    let market_key = ctx.accounts.market.key();
    let mb = ctx.accounts.market_vault.to_account_info();
    let sys = ctx.accounts.system_program.to_account_info();
    settle_participant(
        &mut ctx.accounts.outcome_0_account,
        ctx.accounts.outcome_0_vault.to_account_info(),
        mb.clone(),
        sys.clone(),
        ctx.accounts.outcome_0_owner.key(),
        &mut ctx.accounts.outcome_0_position,
        &mut ctx.accounts.market,
        market_key,
        ctx.bumps.outcome_0_position,
        0,
        c0,
        quantity,
    )?;
    settle_participant(
        &mut ctx.accounts.outcome_1_account,
        ctx.accounts.outcome_1_vault.to_account_info(),
        mb.clone(),
        sys.clone(),
        ctx.accounts.outcome_1_owner.key(),
        &mut ctx.accounts.outcome_1_position,
        &mut ctx.accounts.market,
        market_key,
        ctx.bumps.outcome_1_position,
        1,
        c1,
        quantity,
    )?;
    settle_participant(
        &mut ctx.accounts.outcome_2_account,
        ctx.accounts.outcome_2_vault.to_account_info(),
        mb,
        sys,
        ctx.accounts.outcome_2_owner.key(),
        &mut ctx.accounts.outcome_2_position,
        &mut ctx.accounts.market,
        market_key,
        ctx.bumps.outcome_2_position,
        2,
        c2,
        quantity,
    )?;
    record_complete_fill(&mut ctx.accounts.market, quantity)
}

pub fn settle_share_trade_handler(
    ctx: Context<SettleShareTrade>,
    fill_seq: u64,
    outcome: u8,
    price: u16,
    quantity: u64,
) -> Result<()> {
    require!(
        ctx.accounts.buyer.key() != ctx.accounts.seller.key(),
        KickTickError::InvalidAccountData
    );
    check_fill(&ctx.accounts.market, fill_seq, quantity)?;
    check_price(price)?;
    require!(
        outcome < ctx.accounts.market.outcome_count,
        KickTickError::InvalidOutcomeIndex
    );
    let i = outcome as usize;
    let available = ctx.accounts.seller_position.shares[i]
        .checked_sub(ctx.accounts.seller_position.locked_shares[i])
        .ok_or(KickTickError::Overflow)?;
    require!(available >= quantity, KickTickError::InsufficientShares);
    let market_key = ctx.accounts.market.key();
    init_position(
        &mut ctx.accounts.buyer_position,
        ctx.accounts.buyer.key(),
        market_key,
        ctx.bumps.buyer_position,
        &mut ctx.accounts.market,
    )?;
    let cost = price_cost(quantity, price)?;
    transfer_user_balance(
        &mut ctx.accounts.buyer_account,
        ctx.accounts.buyer_vault.to_account_info(),
        ctx.accounts.seller_vault.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
        ctx.accounts.buyer.key(),
        cost,
    )?;
    ctx.accounts.seller_account.available_balance = ctx
        .accounts
        .seller_account
        .available_balance
        .checked_add(cost)
        .ok_or(KickTickError::Overflow)?;
    ctx.accounts.seller_position.shares[i] = ctx.accounts.seller_position.shares[i]
        .checked_sub(quantity)
        .ok_or(KickTickError::Overflow)?;
    ctx.accounts.buyer_position.shares[i] = ctx.accounts.buyer_position.shares[i]
        .checked_add(quantity)
        .ok_or(KickTickError::Overflow)?;
    ctx.accounts.market.total_volume = ctx
        .accounts
        .market
        .total_volume
        .checked_add(quantity)
        .ok_or(KickTickError::Overflow)?;
    ctx.accounts.market.fill_sequence = ctx
        .accounts
        .market
        .fill_sequence
        .checked_add(1)
        .ok_or(KickTickError::Overflow)?;
    Ok(())
}

fn check_fill(market: &Market, fill_seq: u64, quantity: u64) -> Result<()> {
    require!(
        market.status == MarketStatus::Open,
        KickTickError::MarketNotOpen
    );
    require!(
        Clock::get()?.unix_timestamp < market.expires_at,
        KickTickError::DeadlinePassed
    );
    require!(
        fill_seq == market.fill_sequence,
        KickTickError::InvalidFillSequence
    );
    require!(
        quantity >= MIN_TRADE_QUANTITY,
        KickTickError::QuantityTooSmall
    );
    Ok(())
}
fn check_price(price: u16) -> Result<()> {
    require!(
        (MIN_PRICE_BPS..=MAX_PRICE_BPS).contains(&price),
        KickTickError::InvalidPrice
    );
    require!(price % PRICE_TICK_BPS == 0, KickTickError::InvalidPriceTick);
    Ok(())
}
fn check_complete_prices(prices: &[u16]) -> Result<()> {
    let mut sum = 0u16;
    for price in prices {
        check_price(*price)?;
        sum = sum.checked_add(*price).ok_or(KickTickError::Overflow)?;
    }
    require!(sum == PRICE_SCALE_BPS, KickTickError::InvalidPriceSum);
    Ok(())
}
fn record_complete_fill(market: &mut Market, quantity: u64) -> Result<()> {
    market.collateral = market
        .collateral
        .checked_add(quantity)
        .ok_or(KickTickError::Overflow)?;
    market.total_volume = market
        .total_volume
        .checked_add(quantity)
        .ok_or(KickTickError::Overflow)?;
    market.fill_sequence = market
        .fill_sequence
        .checked_add(1)
        .ok_or(KickTickError::Overflow)?;
    Ok(())
}
fn settle_participant<'info>(
    ua: &mut Account<'info, UserAccount>,
    uv: AccountInfo<'info>,
    mv: AccountInfo<'info>,
    sys: AccountInfo<'info>,
    owner: Pubkey,
    position: &mut Account<'info, Position>,
    market: &mut Account<'info, Market>,
    market_key: Pubkey,
    bump: u8,
    outcome: usize,
    cost: u64,
    quantity: u64,
) -> Result<()> {
    init_position(position, owner, market_key, bump, market)?;
    transfer_user_balance(ua, uv, mv, sys, owner, cost)?;
    position.shares[outcome] = position.shares[outcome]
        .checked_add(quantity)
        .ok_or(KickTickError::Overflow)?;
    Ok(())
}
fn init_position<'info>(
    position: &mut Account<'info, Position>,
    owner: Pubkey,
    market_key: Pubkey,
    bump: u8,
    market: &mut Account<'info, Market>,
) -> Result<()> {
    if position.owner == Pubkey::default() {
        position.init_if_needed(owner, market_key, bump);
        market.open_positions = market
            .open_positions
            .checked_add(1)
            .ok_or(KickTickError::Overflow)?;
    }
    require!(position.owner == owner, KickTickError::Unauthorized);
    require!(
        position.market == market_key,
        KickTickError::InvalidAccountData
    );
    require!(!position.claimed, KickTickError::AlreadyClaimed);
    Ok(())
}
fn transfer_user_balance<'info>(
    ua: &mut Account<'info, UserAccount>,
    source: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    owner: Pubkey,
    amount: u64,
) -> Result<()> {
    require!(
        ua.available_balance >= amount,
        KickTickError::InsufficientBalance
    );
    ua.available_balance = ua
        .available_balance
        .checked_sub(amount)
        .ok_or(KickTickError::Overflow)?;
    let bump = [ua.vault_bump];
    let seeds: &[&[u8]] = &[SEED_USER_VAULT, owner.as_ref(), &bump];
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
fn price_cost(quantity: u64, price: u16) -> Result<u64> {
    let cost = (quantity as u128)
        .checked_mul(price as u128)
        .ok_or(KickTickError::Overflow)?
        .checked_div(PRICE_SCALE_BPS as u128)
        .ok_or(KickTickError::DivisionByZero)?;
    u64::try_from(cost).map_err(|_| KickTickError::Overflow.into())
}
