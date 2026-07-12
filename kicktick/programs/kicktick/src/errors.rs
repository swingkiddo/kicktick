use anchor_lang::prelude::*;

#[error_code]
pub enum KickTickError {
    // Admin / Config
    #[msg("Unauthorized: only admin can call this")]
    Unauthorized,
    #[msg("Config already initialized")]
    ConfigAlreadyInitialized,
    #[msg("Config not initialized")]
    ConfigNotInitialized,

    // Match
    #[msg("Match already exists")]
    MatchAlreadyExists,
    #[msg("Match not found")]
    MatchNotFound,
    #[msg("Match not active")]
    MatchNotActive,
    #[msg("Invalid fixture ID")]
    InvalidFixtureId,

    // Round
    #[msg("Round already exists")]
    RoundAlreadyExists,
    #[msg("Round not found")]
    RoundNotFound,
    #[msg("Round not open")]
    RoundNotOpen,
    #[msg("Round already settled")]
    RoundAlreadySettled,
    #[msg("Round not settled")]
    RoundNotSettled,
    #[msg("Round not confirmable yet")]
    RoundNotConfirmable,
    #[msg("Round already confirmed")]
    RoundAlreadyConfirmed,
    #[msg("Invalid market type")]
    InvalidMarketType,
    #[msg("Invalid outcome count")]
    InvalidOutcomeCount,
    #[msg("Invalid outcome index")]
    InvalidOutcomeIndex,
    #[msg("Invalid price")]
    InvalidPrice,
    #[msg("Complete-set prices must sum to 10000 basis points")]
    InvalidPriceSum,
    #[msg("Market is not open")]
    MarketNotOpen,
    #[msg("Market is not locked")]
    MarketNotLocked,
    #[msg("Market is not resolved")]
    MarketNotResolved,
    #[msg("Market is not in a terminal state")]
    MarketNotTerminal,
    #[msg("Market may only be resolved after finality confirmation")]
    MarketNotConfirmed,
    #[msg("Only the configured relayer can call this instruction")]
    UnauthorizedRelayer,
    #[msg("Fill sequence is not the market's next sequence")]
    InvalidFillSequence,
    #[msg("Price is not on the required tick")]
    InvalidPriceTick,
    #[msg("Trade quantity is below the minimum")]
    QuantityTooSmall,
    #[msg("Void payout vector is invalid")]
    InvalidVoidPayout,
    #[msg("This market must be resolved with TxOracle proof")]
    OracleResolutionRequired,
    #[msg("This market may only be resolved off-chain")]
    OffchainResolutionRequired,
    #[msg("Market type not supported for on-chain settlement")]
    MarketTypeNotSupported,

    // Duration / Timing
    #[msg("Invalid round duration (must be 15-300 seconds)")]
    InvalidDuration,
    #[msg("Round deadline has passed")]
    DeadlinePassed,
    #[msg("Round still active")]
    RoundStillActive,

    // Betting
    #[msg("Bet amount must be greater than zero")]
    ZeroAmount,
    #[msg("Invalid bet side")]
    InvalidSide,
    #[msg("Insufficient available balance")]
    InsufficientBalance,
    #[msg("Insufficient shares")]
    InsufficientShares,

    // Sponsor / Liquidity
    #[msg("Insufficient sponsor liquidity")]
    InsufficientLiquidity,
    #[msg("Sponsor not found")]
    SponsorNotFound,
    #[msg("Minimum liquidity not met")]
    MinLiquidityNotMet,

    // Position
    #[msg("Position not found")]
    PositionNotFound,
    #[msg("Position already claimed")]
    AlreadyClaimed,
    #[msg("Not a winner")]
    NotWinner,

    // Settlement
    #[msg("Cannot settle off-chain market type on-chain")]
    InvalidSettlementMethod,
    #[msg("CPI call to txoracle failed")]
    CpiFailed,
    #[msg("Stat key mapping not found for market type")]
    StatKeyMappingNotFound,
    #[msg("Proof sequence not provided")]
    MissingProofSequence,
    #[msg("Predicate returned false")]
    PredicateFailed,

    // Equivocation
    #[msg("No conflicting settlement found")]
    NoEquivocation,
    #[msg("Equivocation already challenged")]
    EquivocationAlreadyChallenged,

    // General
    #[msg("Math overflow")]
    Overflow,
    #[msg("Division by zero")]
    DivisionByZero,
    #[msg("Account already initialized")]
    AlreadyInitialized,
    #[msg("Invalid account data")]
    InvalidAccountData,
    #[msg("Order is not open")]
    OrderNotOpen,
    #[msg("Order expiry has not been reached")]
    OrderNotExpired,
    #[msg("Order parameters do not match")]
    InvalidOrder,
    #[msg("Invalid collateral mint")]
    InvalidCollateralMint,
    #[msg("Invalid collateral token program")]
    InvalidCollateralTokenProgram,
    #[msg("Invalid collateral mint decimals")]
    InvalidCollateralDecimals,
    #[msg("Invalid token account mint or authority")]
    InvalidTokenAccount,
    #[msg("Token vault balance does not match its collateral ledger")]
    CollateralCustodyMismatch,
    #[msg("Token vault must be empty before it can be closed")]
    NonZeroVaultBalance,
    #[msg("Fill quantity produces unsupported collateral rounding dust")]
    RoundingDust,
}
