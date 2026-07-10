use anchor_lang::prelude::*;
use anchor_lang::solana_program;

use crate::constants::*;
use crate::errors::KickTickError;
use crate::instructions::market::resolve_pending;
use crate::state::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct StatTerm {
    pub stat_to_prove: ScoreStat,
    pub event_stat_root: [u8; 32],
    pub stat_proof: Vec<ProofNode>,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: ScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug, PartialEq, Eq)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    EqualTo,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct TraderPredicate {
    pub threshold: i32,
    pub comparison: Comparison,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub enum BinaryExpression {
    Add,
    Subtract,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct ValidateStatArgs {
    pub ts: i64,
    pub fixture_summary: ScoresBatchSummary,
    pub fixture_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub predicate: TraderPredicate,
    pub stat_a: StatTerm,
    pub stat_b: Option<StatTerm>,
    pub op: Option<BinaryExpression>,
}

#[derive(Accounts)]
pub struct ResolveMarketWithProof<'info> {
    pub relayer: Signer<'info>,
    #[account(seeds = [SEED_CONFIG], bump = config.bump, constraint = config.relayer == relayer.key() @ KickTickError::UnauthorizedRelayer)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [SEED_MARKET, &market.fixture_id.to_le_bytes(), &[market.market_type as u8], &market.market_seq.to_le_bytes()], bump = market.bump)]
    pub market: Account<'info, Market>,
    /// CHECK: validated against the config and consumed by TxOracle.
    #[account(address = config.daily_scores_merkle_roots @ KickTickError::InvalidAccountData)]
    pub daily_scores_merkle_roots: UncheckedAccount<'info>,
    /// CHECK: validated against the config and invoked below.
    #[account(address = config.txoracle_program_id @ KickTickError::InvalidAccountData)]
    pub txoracle_program: UncheckedAccount<'info>,
}

pub fn resolve_market_with_proof_handler(
    ctx: Context<ResolveMarketWithProof>,
    args: ValidateStatArgs,
) -> Result<()> {
    let market = &ctx.accounts.market;
    require!(
        Market::requires_oracle(market.market_type),
        KickTickError::OffchainResolutionRequired
    );
    require!(
        market.status == MarketStatus::Locked,
        KickTickError::MarketNotLocked
    );
    require!(
        args.fixture_summary.fixture_id == market.fixture_id,
        KickTickError::InvalidFixtureId
    );
    require!(
        args.stat_a.stat_to_prove.period == market.params.period,
        KickTickError::InvalidAccountData
    );
    require!(
        args.predicate.comparison == Comparison::GreaterThan,
        KickTickError::InvalidAccountData
    );
    let (first_key, second_key) = expected_stat_keys(market.market_type)?;
    require!(
        args.stat_a.stat_to_prove.key == first_key,
        KickTickError::StatKeyMappingNotFound
    );
    require!(
        args.predicate.threshold == market.params.baseline_a,
        KickTickError::InvalidAccountData
    );
    let mut primary_args = args.clone();
    primary_args.stat_b = None;
    primary_args.op = None;

    let winner = if market.outcome_count == 2 {
        if invoke_validate_stat(
            ctx.accounts.daily_scores_merkle_roots.to_account_info(),
            ctx.accounts.txoracle_program.to_account_info(),
            &primary_args,
        )? {
            0
        } else {
            1
        }
    } else {
        let stat_b = args
            .stat_b
            .as_ref()
            .ok_or(KickTickError::InvalidAccountData)?;
        require!(
            stat_b.stat_to_prove.period == market.params.period,
            KickTickError::InvalidAccountData
        );
        require!(
            stat_b.stat_to_prove.key == second_key,
            KickTickError::StatKeyMappingNotFound
        );
        if invoke_validate_stat(
            ctx.accounts.daily_scores_merkle_roots.to_account_info(),
            ctx.accounts.txoracle_program.to_account_info(),
            &primary_args,
        )? {
            0
        } else {
            let mut secondary_args = args.clone();
            secondary_args.stat_a = stat_b.clone();
            secondary_args.stat_b = None;
            secondary_args.op = None;
            secondary_args.predicate.threshold = market.params.baseline_b;
            if invoke_validate_stat(
                ctx.accounts.daily_scores_merkle_roots.to_account_info(),
                ctx.accounts.txoracle_program.to_account_info(),
                &secondary_args,
            )? {
                1
            } else {
                2
            }
        }
    };
    resolve_pending(
        &mut ctx.accounts.market,
        winner,
        Clock::get()?.unix_timestamp,
    )
}

fn expected_stat_keys(market_type: MarketType) -> Result<(u32, u32)> {
    match market_type {
        MarketType::NextGoalSide | MarketType::GoalInWindow => {
            Ok((STATKEY_P1_GOALS, STATKEY_P2_GOALS))
        }
        MarketType::NextCorner | MarketType::CornerInWindow => {
            Ok((STATKEY_P1_CORNERS, STATKEY_P2_CORNERS))
        }
        MarketType::NextYellowCard | MarketType::YellowCardInWindow => {
            Ok((STATKEY_P1_YC, STATKEY_P2_YC))
        }
        MarketType::RedCardInMatch => Ok((STATKEY_P1_RC, STATKEY_P2_RC)),
        MarketType::PenaltyShootoutShot => Ok((STATKEY_P1_PE, STATKEY_P2_PE)),
        _ => Err(KickTickError::MarketTypeNotSupported.into()),
    }
}

fn invoke_validate_stat<'a>(
    daily_scores_merkle_roots: AccountInfo<'a>,
    txoracle_program: AccountInfo<'a>,
    args: &ValidateStatArgs,
) -> Result<bool> {
    let data = build_validate_stat_ix(args)?;
    let ix = solana_program::instruction::Instruction {
        program_id: txoracle_program.key(),
        accounts: vec![solana_program::instruction::AccountMeta::new_readonly(
            daily_scores_merkle_roots.key(),
            false,
        )],
        data,
    };
    match solana_program::program::invoke(&ix, &[daily_scores_merkle_roots, txoracle_program]) {
        Ok(()) => Ok(true),
        Err(err) => {
            if is_predicate_failed(&err) {
                Ok(false)
            } else {
                Err(KickTickError::CpiFailed.into())
            }
        }
    }
}

fn is_predicate_failed(err: &ProgramError) -> bool {
    let err = err.to_string();
    err.contains("PredicateFailed") || err.contains("0x1781")
}
fn build_validate_stat_ix(args: &ValidateStatArgs) -> Result<Vec<u8>> {
    let mut data = Vec::with_capacity(512);
    data.extend_from_slice(&VALIDATE_STAT_DISCRIMINATOR);
    data.extend_from_slice(&borsh::to_vec(args).map_err(|_| KickTickError::CpiFailed)?);
    Ok(data)
}
