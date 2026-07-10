use anchor_lang::prelude::*;

use crate::constants::MAX_OUTCOMES;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum MarketType {
    NextGoalSide,
    GoalInWindow,
    NextCorner,
    CornerInWindow,
    NextYellowCard,
    YellowCardInWindow,
    RedCardInMatch,
    PenaltyShootoutShot,
    PenaltyShot,
    VARCheck,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum MarketStatus {
    Open,
    Locked,
    ResolvedPending,
    Resolved,
    Voided,
}

impl Default for MarketStatus {
    fn default() -> Self {
        Self::Open
    }
}

/// Immutable oracle context captured at market creation.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
pub struct MarketParams {
    pub participant: u8,
    pub period: i32,
    pub baseline_a: i32,
    pub baseline_b: i32,
}

#[account]
pub struct Market {
    pub fixture_id: i64,
    pub market_type: MarketType,
    pub market_seq: u64,
    pub params: MarketParams,
    pub outcome_count: u8,
    pub status: MarketStatus,
    pub winner: Option<u8>,
    pub expires_at: i64,
    pub resolved_at: i64,
    pub void_payout_bps: [u16; MAX_OUTCOMES],
    /// Lamports deposited by complete-set minting, excluding vault rent.
    pub collateral: u64,
    /// Number of shares settled across all fills.
    pub total_volume: u64,
    /// Next accepted relayer fill sequence. Starts at zero.
    pub fill_sequence: u64,
    /// Positions not yet claimed or cleaned up.
    pub open_positions: u64,
    pub vault_bump: u8,
    pub bump: u8,
}

impl Market {
    pub const LEN: usize = 8  // discriminator
        + 8                  // fixture_id
        + 1                  // market_type
        + 8                  // market_seq
        + 13                 // MarketParams
        + 1                  // outcome_count
        + 1                  // status
        + 2                  // Option<u8>
        + 8                  // expires_at
        + 8                  // resolved_at
        + (2 * MAX_OUTCOMES) // void_payout_bps
        + 8                  // collateral
        + 8                  // total_volume
        + 8                  // fill_sequence
        + 8                  // open_positions
        + 1                  // vault_bump
        + 1; // bump

    pub fn outcome_count_for(market_type: MarketType) -> u8 {
        match market_type {
            MarketType::NextGoalSide
            | MarketType::NextCorner
            | MarketType::NextYellowCard
            | MarketType::PenaltyShootoutShot => 3,
            _ => 2,
        }
    }

    pub fn requires_oracle(market_type: MarketType) -> bool {
        !matches!(market_type, MarketType::PenaltyShot | MarketType::VARCheck)
    }
}
