use crate::constants::MAX_OUTCOMES;
use anchor_lang::prelude::*;

#[account]
pub struct Position {
    pub owner: Pubkey,
    pub market: Pubkey,
    pub shares: [u64; MAX_OUTCOMES],
    pub locked_shares: [u64; MAX_OUTCOMES],
    pub claimed: bool,
    pub bump: u8,
}

impl Position {
    pub const LEN: usize = 8 + 32 + 32 + (8 * MAX_OUTCOMES) + (8 * MAX_OUTCOMES) + 1 + 1;

    pub fn init_if_needed(&mut self, owner: Pubkey, market: Pubkey, bump: u8) {
        if self.owner == Pubkey::default() {
            self.owner = owner;
            self.market = market;
            self.shares = [0; MAX_OUTCOMES];
            self.locked_shares = [0; MAX_OUTCOMES];
            self.claimed = false;
            self.bump = bump;
        }
    }
}
