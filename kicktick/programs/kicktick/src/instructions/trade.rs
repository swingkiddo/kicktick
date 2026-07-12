use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::errors::KickTickError;
use crate::state::*;

#[derive(Accounts)]
pub struct SettleCompleteSet<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = config.relayer == relayer.key() @ KickTickError::UnauthorizedRelayer)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(mut, seeds = [SEED_MARKET_VAULT, market.key().as_ref()], bump = market.vault_bump,
        token::mint = collateral_mint, token::authority = market, token::token_program = token_program)]
    pub market_vault: Box<Account<'info, TokenAccount>>,
    #[account(address = config.collateral_mint @ KickTickError::InvalidCollateralMint)] pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(address = config.collateral_token_program @ KickTickError::InvalidCollateralTokenProgram)] pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct SettleShareTrade<'info> {
    #[account(mut)]
    pub relayer: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = config.relayer == relayer.key() @ KickTickError::UnauthorizedRelayer)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Box<Account<'info, Market>>,
    #[account(address = config.collateral_mint @ KickTickError::InvalidCollateralMint)] pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(address = config.collateral_token_program @ KickTickError::InvalidCollateralTokenProgram)] pub token_program: Program<'info, Token>,
    /// CHECK: signatures are authenticated by the configured relayer.
    pub buyer: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_USER, buyer.key().as_ref()], bump = buyer_account.bump, constraint = buyer_account.owner == buyer.key() @ KickTickError::Unauthorized)]
    pub buyer_account: Box<Account<'info, UserAccount>>,
    #[account(mut, seeds = [SEED_USER_VAULT, buyer.key().as_ref()], bump = buyer_account.vault_bump,
        token::mint = collateral_mint, token::authority = buyer_account, token::token_program = token_program)]
    pub buyer_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_POSITION, market.key().as_ref(), buyer.key().as_ref()], bump = buyer_position.bump, constraint = buyer_position.owner == buyer.key() @ KickTickError::Unauthorized, constraint = buyer_position.market == market.key() @ KickTickError::InvalidAccountData)]
    pub buyer_position: Box<Account<'info, Position>>,
    #[account(mut, seeds = [SEED_ORDER, buyer.key().as_ref(), &buyer_order.nonce.to_le_bytes()], bump = buyer_order.bump)]
    pub buyer_order: Box<Account<'info, OrderAccount>>,
    /// CHECK: signatures are authenticated by the configured relayer.
    pub seller: UncheckedAccount<'info>,
    #[account(mut, seeds = [SEED_USER, seller.key().as_ref()], bump = seller_account.bump, constraint = seller_account.owner == seller.key() @ KickTickError::Unauthorized)]
    pub seller_account: Box<Account<'info, UserAccount>>,
    #[account(mut, seeds = [SEED_USER_VAULT, seller.key().as_ref()], bump = seller_account.vault_bump,
        token::mint = collateral_mint, token::authority = seller_account, token::token_program = token_program)]
    pub seller_vault: Box<Account<'info, TokenAccount>>,
    #[account(mut, seeds = [SEED_POSITION, market.key().as_ref(), seller.key().as_ref()], bump = seller_position.bump, constraint = seller_position.owner == seller.key() @ KickTickError::Unauthorized, constraint = seller_position.market == market.key() @ KickTickError::InvalidAccountData)]
    pub seller_position: Box<Account<'info, Position>>,
    #[account(mut, seeds = [SEED_ORDER, seller.key().as_ref(), &seller_order.nonce.to_le_bytes()], bump = seller_order.bump)]
    pub seller_order: Box<Account<'info, OrderAccount>>,
}

pub fn settle_complete_set_handler<'info>(
    ctx: Context<'info, SettleCompleteSet<'info>>,
    fill_seq: u64,
    prices_bps: Vec<u16>,
    quantity: u64,
) -> Result<()> {
    check_fill(&ctx.accounts.market, fill_seq, quantity)?;
    let outcome_count = ctx.accounts.market.outcome_count as usize;
    require!(outcome_count == 2, KickTickError::BinaryMarketOnly);
    require!(prices_bps.len() == outcome_count, KickTickError::InvalidOutcomeCount);
    require!(ctx.remaining_accounts.len() == outcome_count * 4, KickTickError::InvalidAccountData);
    check_complete_prices(&prices_bps)?;

    let market_key = ctx.accounts.market.key();
    let mut owners = [Pubkey::default(); MAX_OUTCOMES];
    let mut costs = [0u64; 2];
    let mut capacities = [0u64; 2];
    for outcome in 0..outcome_count {
        let order = Account::<OrderAccount>::try_from(&ctx.remaining_accounts[outcome * 4 + 2])?;
        costs[outcome] = order_fill_cost(&order, quantity, prices_bps[outcome])?;
        capacities[outcome] = order.reserved_collateral;
    }
    normalize_complete_set_costs(&mut costs, &capacities, quantity)?;
    let mut total_cost = 0u64;
    for outcome in 0..outcome_count {
        let accounts = &ctx.remaining_accounts[outcome * 4..outcome * 4 + 4];
        let (owner, cost) = settle_remaining_participant(
            ctx.program_id,
            accounts,
            &ctx.accounts.market_vault.to_account_info(),
            &ctx.accounts.collateral_mint.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            ctx.accounts.config.collateral_mint,
            ctx.accounts.config.collateral_decimals,
            market_key,
            outcome as u8,
            prices_bps[outcome],
            quantity,
            &owners[..outcome],
            costs[outcome],
        )?;
        owners[outcome] = owner;
        total_cost = total_cost.checked_add(cost).ok_or(KickTickError::Overflow)?;
    }
    require!(total_cost == quantity, KickTickError::Overflow);
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
    require!(ctx.accounts.market.outcome_count == 2, KickTickError::BinaryMarketOnly);
    check_price(price)?;
    require!(
        outcome < ctx.accounts.market.outcome_count,
        KickTickError::InvalidOutcomeIndex
    );
    let i = outcome as usize;
    validate_order(&ctx.accounts.buyer_order, ctx.accounts.buyer.key(), ctx.accounts.market.key(), OrderSide::Buy, outcome, price, quantity)?;
    validate_order(&ctx.accounts.seller_order, ctx.accounts.seller.key(), ctx.accounts.market.key(), OrderSide::Sell, outcome, price, quantity)?;
    require!(ctx.accounts.seller_position.locked_shares[i] >= quantity, KickTickError::InsufficientShares);
    let market_key = ctx.accounts.market.key();
    validate_position(
        &mut ctx.accounts.buyer_position,
        ctx.accounts.buyer.key(),
        market_key,
    )?;
    let cost = order_fill_cost(&ctx.accounts.buyer_order, quantity, price)?;
    transfer_reserved_collateral(
        &mut ctx.accounts.buyer_account,
        ctx.accounts.buyer_vault.to_account_info(),
        ctx.accounts.seller_vault.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.collateral_mint.to_account_info(),
        ctx.accounts.buyer.key(),
        cost,
        ctx.accounts.config.collateral_decimals,
    )?;
    ctx.accounts.buyer_order.reserved_collateral = ctx.accounts.buyer_order.reserved_collateral.checked_sub(cost).ok_or(KickTickError::Overflow)?;
    consume_buy_order(&mut ctx.accounts.buyer_order, &mut ctx.accounts.buyer_account, quantity)?;
    ctx.accounts.seller_order.remaining_quantity = ctx.accounts.seller_order.remaining_quantity.checked_sub(quantity).ok_or(KickTickError::Overflow)?;
    update_order_status(&mut ctx.accounts.seller_order);
    ctx.accounts.seller_account.available_balance = ctx
        .accounts
        .seller_account
        .available_balance
        .checked_add(cost)
        .ok_or(KickTickError::Overflow)?;
    ctx.accounts.seller_position.shares[i] = ctx.accounts.seller_position.shares[i]
        .checked_sub(quantity)
        .ok_or(KickTickError::Overflow)?;
    ctx.accounts.seller_position.locked_shares[i] = ctx.accounts.seller_position.locked_shares[i]
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
#[allow(clippy::too_many_arguments)]
fn settle_remaining_participant<'info>(
    program_id: &Pubkey,
    accounts: &'info [AccountInfo<'info>],
    market_vault: &AccountInfo<'info>,
    collateral_mint: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    expected_mint: Pubkey,
    decimals: u8,
    market_key: Pubkey,
    outcome: u8,
    price: u16,
    quantity: u64,
    previous_owners: &[Pubkey],
    exact_cost: u64,
) -> Result<(Pubkey, u64)> {
    let user_info = &accounts[0];
    let vault_info = &accounts[1];
    let order_info = &accounts[2];
    let position_info = &accounts[3];
    require!(user_info.is_writable && vault_info.is_writable && order_info.is_writable && position_info.is_writable, KickTickError::InvalidAccountData);
    require_keys_eq!(*user_info.owner, *program_id, KickTickError::InvalidAccountData);
    require_keys_eq!(*order_info.owner, *program_id, KickTickError::InvalidAccountData);
    require_keys_eq!(*position_info.owner, *program_id, KickTickError::InvalidAccountData);
    require_keys_eq!(*vault_info.owner, *token_program.key, KickTickError::InvalidCollateralTokenProgram);

    let mut user = Account::<UserAccount>::try_from(user_info)?;
    let owner = user.owner;
    require!(!previous_owners.contains(&owner), KickTickError::InvalidAccountData);
    assert_pda(user_info.key, &[SEED_USER, owner.as_ref(), &[user.bump]], program_id)?;
    assert_pda(vault_info.key, &[SEED_USER_VAULT, owner.as_ref(), &[user.vault_bump]], program_id)?;

    let vault = Account::<TokenAccount>::try_from(vault_info)?;
    require_keys_eq!(vault.mint, expected_mint, KickTickError::InvalidTokenAccount);
    require_keys_eq!(vault.owner, *user_info.key, KickTickError::InvalidTokenAccount);
    drop(vault);

    let mut order = Account::<OrderAccount>::try_from(order_info)?;
    assert_pda(order_info.key, &[SEED_ORDER, owner.as_ref(), &order.nonce.to_le_bytes(), &[order.bump]], program_id)?;
    validate_order(&order, owner, market_key, OrderSide::Buy, outcome, price, quantity)?;

    let mut position = Account::<Position>::try_from(position_info)?;
    assert_pda(position_info.key, &[SEED_POSITION, market_key.as_ref(), owner.as_ref(), &[position.bump]], program_id)?;
    validate_position(&position, owner, market_key)?;

    let cost = exact_cost;
    require!(cost <= order.reserved_collateral, KickTickError::InsufficientBalance);
    transfer_reserved_collateral(
        &mut user,
        vault_info.clone(),
        market_vault.clone(),
        token_program.clone(),
        collateral_mint.clone(),
        owner,
        cost,
        decimals,
    )?;
    order.reserved_collateral = order.reserved_collateral.checked_sub(cost).ok_or(KickTickError::Overflow)?;
    position.shares[outcome as usize] = position.shares[outcome as usize]
        .checked_add(quantity)
        .ok_or(KickTickError::Overflow)?;
    consume_buy_order(&mut order, &mut user, quantity)?;

    user.exit(program_id)?;
    order.exit(program_id)?;
    position.exit(program_id)?;
    Ok((owner, cost))
}

fn assert_pda(actual: &Pubkey, seeds: &[&[u8]], program_id: &Pubkey) -> Result<()> {
    let expected = Pubkey::create_program_address(seeds, program_id)
        .map_err(|_| error!(KickTickError::InvalidAccountData))?;
    require_keys_eq!(*actual, expected, KickTickError::InvalidAccountData);
    Ok(())
}
fn validate_position<'info>(
    position: &Account<'info, Position>,
    owner: Pubkey,
    market_key: Pubkey,
) -> Result<()> {
    require!(position.owner == owner, KickTickError::Unauthorized);
    require!(
        position.market == market_key,
        KickTickError::InvalidAccountData
    );
    require!(!position.claimed, KickTickError::AlreadyClaimed);
    Ok(())
}
fn transfer_reserved_collateral<'info>(
    ua: &mut Account<'info, UserAccount>,
    source: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    token_program: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    owner: Pubkey,
    transfer_amount: u64,
    decimals: u8,
) -> Result<()> {
    require!(
        ua.reserved_balance >= transfer_amount,
        KickTickError::InsufficientBalance
    );
    ua.reserved_balance = ua
        .reserved_balance
        .checked_sub(transfer_amount)
        .ok_or(KickTickError::Overflow)?;
    let bump = [ua.bump];
    let seeds: &[&[u8]] = &[SEED_USER, owner.as_ref(), &bump];
    crate::instructions::token::transfer_checked(token_program, source, mint, destination,
        ua.to_account_info(), transfer_amount, decimals, Some(&[seeds]))
}
fn validate_order(order: &OrderAccount, owner: Pubkey, market: Pubkey, side: OrderSide, outcome: u8, price: u16, quantity: u64) -> Result<()> {
    require!(order.owner == owner && order.market == market && order.side == side && order.outcome_index == outcome && matches!(order.status, OrderStatus::Open | OrderStatus::Partial), KickTickError::InvalidOrder);
    require!(match side {
        OrderSide::Buy => price <= order.price_bps,
        OrderSide::Sell => price >= order.price_bps,
    }, KickTickError::InvalidOrder);
    require!(order.remaining_quantity >= quantity, KickTickError::InsufficientShares);
    Ok(())
}
fn consume_buy_order(order: &mut OrderAccount, user: &mut UserAccount, quantity: u64) -> Result<()> {
    order.remaining_quantity = order.remaining_quantity.checked_sub(quantity).ok_or(KickTickError::Overflow)?;
    if order.remaining_quantity == 0 && order.reserved_collateral > 0 {
        let refund = order.reserved_collateral;
        user.reserved_balance = user.reserved_balance.checked_sub(refund).ok_or(KickTickError::Overflow)?;
        user.available_balance = user.available_balance.checked_add(refund).ok_or(KickTickError::Overflow)?;
        order.reserved_collateral = 0;
    }
    update_order_status(order);
    Ok(())
}
fn order_fill_cost(order: &OrderAccount, quantity: u64, price: u16) -> Result<u64> {
    let remaining = order.remaining_quantity.checked_sub(quantity).ok_or(KickTickError::Overflow)?;
    price_cost(order.remaining_quantity, price)?
        .checked_sub(price_cost(remaining, price)?)
        .ok_or(KickTickError::Overflow.into())
}
fn normalize_complete_set_costs(costs: &mut [u64; 2], capacities: &[u64; 2], quantity: u64) -> Result<()> {
    let total = costs[0].checked_add(costs[1]).ok_or(KickTickError::Overflow)?;
    if total < quantity {
        let remainder = quantity.checked_sub(total).ok_or(KickTickError::Overflow)?;
        let index = (0..2)
            .find(|index| capacities[*index].saturating_sub(costs[*index]) >= remainder)
            .ok_or(KickTickError::InsufficientBalance)?;
        costs[index] = costs[index].checked_add(remainder).ok_or(KickTickError::Overflow)?;
    } else if total > quantity {
        let mut excess = total.checked_sub(quantity).ok_or(KickTickError::Overflow)?;
        for index in (0..2).rev() {
            let reduction = costs[index].min(excess);
            costs[index] -= reduction;
            excess -= reduction;
        }
        require!(excess == 0, KickTickError::Overflow);
    }
    require!(costs[0] <= capacities[0] && costs[1] <= capacities[1], KickTickError::InsufficientBalance);
    Ok(())
}
fn update_order_status(order: &mut OrderAccount) {
    order.status = if order.remaining_quantity == 0 { OrderStatus::Filled } else { OrderStatus::Partial };
}
use crate::instructions::token::price_cost;

#[cfg(test)]
mod tests {
    use super::normalize_complete_set_costs;

    #[test]
    fn assigns_remainder_to_available_reserve() {
        let mut costs = [39, 61];
        normalize_complete_set_costs(&mut costs, &[40, 62], 101).unwrap();
        assert_eq!(costs, [40, 61]);
    }

    #[test]
    fn removes_excess_deterministically() {
        let mut costs = [40, 62];
        normalize_complete_set_costs(&mut costs, &[40, 62], 101).unwrap();
        assert_eq!(costs, [40, 61]);
    }
}
