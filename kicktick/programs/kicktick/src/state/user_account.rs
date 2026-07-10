use anchor_lang::prelude::*;

#[account]
pub struct UserAccount {
    pub owner: Pubkey,
    pub available_balance: u64,
    pub reserved_balance: u64,
    pub vault_bump: u8,
    pub bump: u8,
}

impl UserAccount {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 1 + 1;
}
