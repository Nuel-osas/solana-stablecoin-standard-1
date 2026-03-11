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

    // Parse Pyth price account directly (avoids pyth-sdk-solana borsh conflict).
    // Pyth v2 price account layout:
    //   offset 0:   magic (u32) = 0xa1b2c3d4
    //   offset 208: expo (i32)
    //   offset 216: price (i64)
    //   offset 224: conf (u64)
    //   offset 232: status (u32): 1 = Trading
    //   offset 40:  timestamp (i64) — publish_time at v2 offset
    // We use the documented offsets from pyth-client.
    let data = price_feed_account.try_borrow_data()
        .map_err(|_| SSSError::InvalidOracleFeed)?;

    // Minimum size check
    require!(data.len() >= 240, SSSError::InvalidOracleFeed);

    // Verify magic number
    let magic = u32::from_le_bytes(data[0..4].try_into().unwrap());
    require!(magic == 0xa1b2c3d4, SSSError::InvalidOracleFeed);

    let expo = i32::from_le_bytes(data[208..212].try_into().unwrap());
    let price_val = i64::from_le_bytes(data[216..224].try_into().unwrap());
    let status = u32::from_le_bytes(data[232..236].try_into().unwrap());
    let publish_time = i64::from_le_bytes(data[40..48].try_into().unwrap());

    // Status must be Trading (1)
    require!(status == 1, SSSError::OraclePriceStale);

    // Staleness check
    let age = current_timestamp.saturating_sub(publish_time);
    require!(age <= oracle_config.max_staleness_secs as i64, SSSError::OraclePriceStale);

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

    // Compare as i64 to avoid u16 overflow on far-from-peg feeds (e.g. SOL/USD at $150).
    // Any deviation exceeding u16::MAX bps (~655%) is clearly depegged.
    require!(
        deviation_bps_i64 <= oracle_config.max_deviation_bps as i64,
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
