use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum OrderSide { Buy, Sell }

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum OrderStatus { Open, Cancelled, Expired }

#[account]
pub struct OrderAccount {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub side: OrderSide,
    pub outcome_index: u8,
    pub price_bps: u16,
    pub quantity: u64,
    pub remaining_quantity: u64,
    pub nonce: u64,
    pub expires_at: i64,
    pub status: OrderStatus,
    pub bump: u8,
}

impl OrderAccount {
    pub const LEN: usize = 8 + 32 + 32 + 1 + 1 + 2 + 8 + 8 + 8 + 8 + 1 + 1;
}
