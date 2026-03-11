use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::SSSError;
use crate::events;
use crate::state::*;

/// Configure oracle price enforcement for a stablecoin.
/// Only the master authority can call this.
pub fn configure_oracle_handler(
    ctx: Context<ConfigureOracle>,
    price_feed: Pubkey,
    max_deviation_bps: u16,
    max_staleness_secs: u64,
    enabled: bool,
) -> Result<()> {
    let stablecoin = &ctx.accounts.stablecoin;
    require!(
        stablecoin.authority == ctx.accounts.authority.key(),
        SSSError::Unauthorized
    );

    let oracle_config = &mut ctx.accounts.oracle_config;
    oracle_config.stablecoin = stablecoin.key();
    oracle_config.price_feed = price_feed;
    oracle_config.max_deviation_bps = max_deviation_bps;
    oracle_config.max_staleness_secs = max_staleness_secs;
    oracle_config.enabled = enabled;
    oracle_config.bump = ctx.bumps.oracle_config;

    emit!(events::OracleConfigured {
        mint: stablecoin.mint,
        price_feed,
        max_deviation_bps,
        max_staleness_secs,
        enabled,
        by: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Validate the Pyth oracle price feed. Returns Ok if price is within peg tolerance.
/// Caller must ensure oracle_config is enabled before calling.
pub fn validate_oracle_price(
    oracle_config: &OracleConfig,
    price_feed_account: &AccountInfo,
    current_timestamp: i64,
) -> Result<()> {
    // Verify the price feed account matches the configured one
    require!(
        price_feed_account.key() == oracle_config.price_feed,
        SSSError::InvalidOracleFeed
    );

    // Load Pyth price feed
    let price_feed = pyth_sdk_solana::state::SolanaPriceAccount::account_info_to_feed(price_feed_account)
        .map_err(|_| SSSError::InvalidOracleFeed)?;

    let price = price_feed
        .get_price_no_older_than(current_timestamp, oracle_config.max_staleness_secs)
        .ok_or(SSSError::OraclePriceStale)?;

    // Price is in fixed-point with `expo` decimal places.
    // For USD stablecoins, we expect price ~= 1.00 USD.
    // Pyth price has a negative exponent, e.g., price=100000000, expo=-8 means $1.00
    let expo = price.expo;
    let price_val = price.price;

    // Target price: 1.0 USD = 10^(-expo). Pyth USD feeds always have negative expo.
    require!(expo < 0, SSSError::InvalidOracleFeed);
    let target = 10i64.checked_pow((-expo) as u32).ok_or(SSSError::MathOverflow)?;

    // Deviation in basis points: |price - target| * 10000 / target
    let deviation = price_val.checked_sub(target).ok_or(SSSError::MathOverflow)?.abs();
    let deviation_bps_i64 = deviation
        .checked_mul(10_000)
        .ok_or(SSSError::MathOverflow)?
        .checked_div(target)
        .ok_or(SSSError::MathOverflow)?;

    let deviation_bps = u16::try_from(deviation_bps_i64)
        .map_err(|_| error!(SSSError::MathOverflow))?;

    require!(
        deviation_bps <= oracle_config.max_deviation_bps,
        SSSError::OraclePriceDepegged
    );

    Ok(())
}

#[derive(Accounts)]
pub struct ConfigureOracle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, stablecoin.mint.as_ref()],
        bump = stablecoin.bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,

    #[account(
        init_if_needed,
        payer = authority,
        space = OracleConfig::LEN,
        seeds = [ORACLE_CONFIG_SEED, stablecoin.key().as_ref()],
        bump,
    )]
    pub oracle_config: Account<'info, OracleConfig>,

    pub system_program: Program<'info, System>,
}
