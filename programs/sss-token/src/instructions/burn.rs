use anchor_lang::prelude::*;
use anchor_spl::token_2022;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::*;
use crate::error::SSSError;
use crate::events;
use crate::state::*;

/// Burn tokens from the burner's own token account.
/// Enforces pause state, burner role, and optional oracle price peg validation.
pub fn handler(ctx: Context<BurnTokens>, amount: u64) -> Result<()> {
    let stablecoin = &ctx.accounts.stablecoin;
    require!(!stablecoin.paused, SSSError::Paused);

    // Verify burner role
    let role_assignment = &ctx.accounts.role_assignment;
    require!(role_assignment.active, SSSError::Unauthorized);
    require!(role_assignment.role == Role::Burner, SSSError::Unauthorized);
    require!(
        role_assignment.assignee == ctx.accounts.burner.key(),
        SSSError::Unauthorized
    );

    // Oracle price enforcement: if oracle_config is provided and enabled, validate price
    let clock = Clock::get()?;
    if let Some(oracle_config) = &ctx.accounts.oracle_config {
        if oracle_config.enabled {
            let price_feed_account = ctx.accounts.price_feed.as_ref()
                .ok_or(error!(SSSError::InvalidOracleFeed))?;
            super::oracle::validate_oracle_price(oracle_config, &price_feed_account.to_account_info(), clock.unix_timestamp)?;
        }
    }

    // Burn tokens
    token_2022::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            token_2022::Burn {
                mint: ctx.accounts.mint.to_account_info(),
                from: ctx.accounts.burn_from.to_account_info(),
                authority: ctx.accounts.burner.to_account_info(),
            },
        ),
        amount,
    )?;

    // Update total burned
    let stablecoin = &mut ctx.accounts.stablecoin;
    stablecoin.total_burned = stablecoin.total_burned.checked_add(amount).ok_or(SSSError::MathOverflow)?;

    emit!(events::TokensBurned {
        mint: ctx.accounts.mint.key(),
        amount,
        burner: ctx.accounts.burner.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}

/// Accounts required to burn tokens. Burner must have an active burner role.
#[derive(Accounts)]
pub struct BurnTokens<'info> {
    #[account(mut)]
    pub burner: Signer<'info>,

    #[account(
        mut,
        seeds = [STABLECOIN_SEED, mint.key().as_ref()],
        bump = stablecoin.bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,

    #[account(
        mut,
        constraint = mint.key() == stablecoin.mint,
    )]
    pub mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [ROLE_SEED, stablecoin.key().as_ref(), Role::Burner.to_seed(), burner.key().as_ref()],
        bump = role_assignment.bump,
    )]
    pub role_assignment: Account<'info, RoleAssignment>,

    /// Token account to burn from (must be owned by burner)
    #[account(
        mut,
        constraint = burn_from.owner == burner.key(),
    )]
    pub burn_from: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Interface<'info, TokenInterface>,

    /// Optional: Oracle config PDA — if provided and enabled, price is validated
    #[account(
        seeds = [ORACLE_CONFIG_SEED, stablecoin.key().as_ref()],
        bump = oracle_config.bump,
    )]
    pub oracle_config: Option<Account<'info, OracleConfig>>,

    /// Optional: Pyth price feed account — required if oracle_config is provided
    /// CHECK: Validated inside validate_oracle_price against oracle_config.price_feed
    pub price_feed: Option<UncheckedAccount<'info>>,
}
