use anchor_lang::prelude::*;
use crate::{constants::*, errors::KickTickError, state::*};

#[derive(Accounts)]
#[instruction(side: OrderSide, outcome_index: u8, price_bps: u16, quantity: u64, nonce: u64, expires_at: i64)]
pub struct CreateOrder<'info> {
    #[account(mut)] pub owner: Signer<'info>,
    #[account(mut, seeds = [SEED_USER, owner.key().as_ref()], bump = user_account.bump, constraint = user_account.owner == owner.key() @ KickTickError::Unauthorized)]
    pub user_account: Account<'info, UserAccount>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(init, payer = owner, space = OrderAccount::LEN, seeds = [SEED_ORDER, owner.key().as_ref(), &nonce.to_le_bytes()], bump)]
    pub order: Account<'info, OrderAccount>,
    #[account(init_if_needed, payer = owner, space = Position::LEN, seeds = [SEED_POSITION, market.key().as_ref(), owner.key().as_ref()], bump)]
    pub position: Account<'info, Position>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelOrder<'info> {
    #[account(mut)] pub owner: Signer<'info>,
    #[account(mut, seeds = [SEED_USER, owner.key().as_ref()], bump = user_account.bump, constraint = user_account.owner == owner.key() @ KickTickError::Unauthorized)]
    pub user_account: Box<Account<'info, UserAccount>>,
    #[account(mut, close = owner, seeds = [SEED_ORDER, owner.key().as_ref(), &order.nonce.to_le_bytes()], bump = order.bump, constraint = order.owner == owner.key() @ KickTickError::Unauthorized)]
    pub order: Box<Account<'info, OrderAccount>>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump, constraint = order.market == market.key() @ KickTickError::InvalidOrder)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [SEED_POSITION, market.key().as_ref(), owner.key().as_ref()], bump = position.bump, constraint = position.owner == owner.key() @ KickTickError::Unauthorized)]
    pub position: Box<Account<'info, Position>>,
}

#[derive(Accounts)]
pub struct ExpireOrder<'info> {
    #[account(mut)] pub relayer: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = config.relayer == relayer.key() @ KickTickError::UnauthorizedRelayer)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [SEED_USER, order.owner.as_ref()], bump = user_account.bump, constraint = user_account.owner == order.owner @ KickTickError::InvalidOrder)]
    pub user_account: Box<Account<'info, UserAccount>>,
    #[account(mut, close = relayer, seeds = [SEED_ORDER, order.owner.as_ref(), &order.nonce.to_le_bytes()], bump = order.bump)]
    pub order: Box<Account<'info, OrderAccount>>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump, constraint = order.market == market.key() @ KickTickError::InvalidOrder)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [SEED_POSITION, market.key().as_ref(), order.owner.as_ref()], bump = position.bump, constraint = position.owner == order.owner @ KickTickError::InvalidOrder)]
    pub position: Box<Account<'info, Position>>,
}

#[derive(Accounts)]
pub struct CancelOrderAfterLock<'info> {
    #[account(mut)] pub relayer: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = config.relayer == relayer.key() @ KickTickError::UnauthorizedRelayer)]
    pub config: Box<Account<'info, Config>>,
    /// CHECK: constrained to order.owner and only receives the closed order account rent.
    #[account(mut, address = order.owner @ KickTickError::InvalidOrder)] pub owner: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_USER, order.owner.as_ref()], bump = user_account.bump, constraint = user_account.owner == order.owner @ KickTickError::InvalidOrder)]
    pub user_account: Box<Account<'info, UserAccount>>,
    #[account(mut, close = owner, seeds = [SEED_ORDER, order.owner.as_ref(), &order.nonce.to_le_bytes()], bump = order.bump)]
    pub order: Box<Account<'info, OrderAccount>>,
    #[account(seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump, constraint = order.market == market.key() @ KickTickError::InvalidOrder)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [SEED_POSITION, market.key().as_ref(), order.owner.as_ref()], bump = position.bump,
        constraint = position.owner == order.owner @ KickTickError::InvalidOrder,
        constraint = position.market == market.key() @ KickTickError::InvalidOrder)]
    pub position: Box<Account<'info, Position>>,
}

fn release(order: &OrderAccount, user: &mut UserAccount, position: &mut Position) -> Result<()> {
    let remaining = order.remaining_quantity;
    match order.side {
        OrderSide::Buy => {
            let amount = crate::instructions::token::price_cost(remaining, order.price_bps)?;
            user.reserved_balance = user.reserved_balance.checked_sub(amount).ok_or(KickTickError::Overflow)?;
            user.available_balance = user.available_balance.checked_add(amount).ok_or(KickTickError::Overflow)?;
        }
        OrderSide::Sell => {
            let i = order.outcome_index as usize;
            position.locked_shares[i] = position.locked_shares[i].checked_sub(remaining).ok_or(KickTickError::Overflow)?;
        }
    }
    Ok(())
}

pub fn create_order_handler(ctx: Context<CreateOrder>, side: OrderSide, outcome_index: u8, price_bps: u16, quantity: u64, nonce: u64, expires_at: i64) -> Result<()> {
    require!(ctx.accounts.market.status == MarketStatus::Open, KickTickError::MarketNotOpen);
    let now = Clock::get()?.unix_timestamp;
    require!(now < expires_at && expires_at <= ctx.accounts.market.expires_at, KickTickError::DeadlinePassed);
    require!(outcome_index < ctx.accounts.market.outcome_count, KickTickError::InvalidOutcomeIndex);
    require!((MIN_PRICE_BPS..=MAX_PRICE_BPS).contains(&price_bps) && price_bps % PRICE_TICK_BPS == 0, KickTickError::InvalidPrice);
    require!(quantity >= MIN_TRADE_QUANTITY, KickTickError::QuantityTooSmall);
    if ctx.accounts.position.owner == Pubkey::default() {
        ctx.accounts.position.init_if_needed(ctx.accounts.owner.key(), ctx.accounts.market.key(), ctx.bumps.position);
        ctx.accounts.market.open_positions = ctx.accounts.market.open_positions.checked_add(1).ok_or(KickTickError::Overflow)?;
    }
    require!(ctx.accounts.position.owner == ctx.accounts.owner.key() && ctx.accounts.position.market == ctx.accounts.market.key(), KickTickError::InvalidAccountData);
    let order = &mut ctx.accounts.order;
    order.set_inner(OrderAccount { owner: ctx.accounts.owner.key(), market: ctx.accounts.market.key(), side, outcome_index, price_bps, quantity, remaining_quantity: quantity, nonce, expires_at, status: OrderStatus::Open, bump: ctx.bumps.order });
    match side {
        OrderSide::Buy => {
            let amount = crate::instructions::token::price_cost(quantity, price_bps)?;
            require!(ctx.accounts.user_account.available_balance >= amount, KickTickError::InsufficientBalance);
            ctx.accounts.user_account.available_balance -= amount;
            ctx.accounts.user_account.reserved_balance = ctx.accounts.user_account.reserved_balance.checked_add(amount).ok_or(KickTickError::Overflow)?;
        }
        OrderSide::Sell => {
            let i = outcome_index as usize;
            let available = ctx.accounts.position.shares[i].checked_sub(ctx.accounts.position.locked_shares[i]).ok_or(KickTickError::Overflow)?;
            require!(available >= quantity, KickTickError::InsufficientShares);
            ctx.accounts.position.locked_shares[i] = ctx.accounts.position.locked_shares[i].checked_add(quantity).ok_or(KickTickError::Overflow)?;
        }
    }
    Ok(())
}

pub fn cancel_order_handler(ctx: Context<CancelOrder>) -> Result<()> {
    require!(matches!(ctx.accounts.order.status, OrderStatus::Open | OrderStatus::Partial), KickTickError::OrderNotOpen);
    release(&ctx.accounts.order, &mut ctx.accounts.user_account, &mut ctx.accounts.position)?;
    ctx.accounts.order.status = OrderStatus::Cancelled;
    Ok(())
}

pub fn expire_order_handler(ctx: Context<ExpireOrder>) -> Result<()> {
    require!(matches!(ctx.accounts.order.status, OrderStatus::Open | OrderStatus::Partial), KickTickError::OrderNotOpen);
    require!(Clock::get()?.unix_timestamp >= ctx.accounts.order.expires_at, KickTickError::OrderNotExpired);
    release(&ctx.accounts.order, &mut ctx.accounts.user_account, &mut ctx.accounts.position)?;
    ctx.accounts.order.status = OrderStatus::Expired;
    Ok(())
}

pub fn cancel_order_after_lock_handler(ctx: Context<CancelOrderAfterLock>) -> Result<()> {
    require!(matches!(ctx.accounts.market.status, MarketStatus::Locked | MarketStatus::ResolvedPending | MarketStatus::Resolved | MarketStatus::Voided), KickTickError::MarketNotLocked);
    require!(matches!(ctx.accounts.order.status, OrderStatus::Open | OrderStatus::Partial), KickTickError::OrderNotOpen);
    release(&ctx.accounts.order, &mut ctx.accounts.user_account, &mut ctx.accounts.position)?;
    ctx.accounts.order.status = OrderStatus::Cancelled;
    Ok(())
}
