use anchor_lang::prelude::*;

#[error_code]
pub enum SSSError {
    #[msg("Token operations are paused")]
    Paused,
    #[msg("Unauthorized: caller does not have the required role")]
    Unauthorized,
    #[msg("Address is blacklisted")]
    Blacklisted,
    #[msg("Address is not blacklisted")]
    NotBlacklisted,
    #[msg("Compliance module not enabled for this stablecoin")]
    ComplianceNotEnabled,
    #[msg("Account is frozen")]
    AccountFrozen,
    #[msg("Account is not frozen")]
    AccountNotFrozen,
    #[msg("Minter quota exceeded")]
    MinterQuotaExceeded,
    #[msg("Invalid configuration: name too long")]
    NameTooLong,
    #[msg("Invalid configuration: symbol too long")]
    SymbolTooLong,
    #[msg("Invalid configuration: URI too long")]
    UriTooLong,
    #[msg("Reason string too long")]
    ReasonTooLong,
    #[msg("Invalid decimals: must be between 0 and 18")]
    InvalidDecimals,
    #[msg("Overflow in arithmetic operation")]
    MathOverflow,
    #[msg("Transfer hook not enabled for this stablecoin")]
    TransferHookNotEnabled,
    #[msg("Cannot seize from a non-blacklisted account")]
    SeizeRequiresBlacklist,
    #[msg("Supply cap would be exceeded")]
    SupplyCapExceeded,
    #[msg("No pending authority nomination")]
    NoPendingAuthority,
    #[msg("Caller is not the nominated pending authority")]
    NotPendingAuthority,
    #[msg("Allowlist is not enabled for this stablecoin")]
    AllowlistNotEnabled,
    #[msg("Address is not on the allowlist")]
    NotAllowlisted,
    #[msg("Oracle price is stale")]
    OraclePriceStale,
    #[msg("Stablecoin price has depegged beyond the allowed threshold")]
    OraclePriceDepegged,
    #[msg("Invalid oracle price feed")]
    InvalidOracleFeed,
}
