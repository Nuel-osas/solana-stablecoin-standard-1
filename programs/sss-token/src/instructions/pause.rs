use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::SSSError;
use crate::events;
use crate::state::*;

/// Pause all token operations (mint, burn, freeze). Requires pauser role or master authority.
pub fn pause_handler(ctx: Context<PauseUnpause>) -> Result<()> {
    let stablecoin = &ctx.accounts.stablecoin;

    // Verify pauser role or master authority
    let is_master = ctx.accounts.authority.key() == stablecoin.authority;
    let is_pauser = ctx.accounts.role_assignment.as_ref()
        .map(|r| r.active && r.role == Role::Pauser && r.assignee == ctx.accounts.authority.key())
        .unwrap_or(false);
    require!(is_master || is_pauser, SSSError::Unauthorized);

    let stablecoin = &mut ctx.accounts.stablecoin;
    stablecoin.paused = true;

    emit!(events::Paused {
        mint: stablecoin.mint,
        by: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Resume token operations after a pause. Requires pauser role or master authority.
pub fn unpause_handler(ctx: Context<PauseUnpause>) -> Result<()> {
    let stablecoin = &ctx.accounts.stablecoin;

    let is_master = ctx.accounts.authority.key() == stablecoin.authority;
    let is_pauser = ctx.accounts.role_assignment.as_ref()
        .map(|r| r.active && r.role == Role::Pauser && r.assignee == ctx.accounts.authority.key())
        .unwrap_or(false);
    require!(is_master || is_pauser, SSSError::Unauthorized);

    let stablecoin = &mut ctx.accounts.stablecoin;
    stablecoin.paused = false;

    emit!(events::Unpaused {
        mint: stablecoin.mint,
        by: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

/// Accounts required to pause or unpause the stablecoin.
#[derive(Accounts)]
pub struct PauseUnpause<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [STABLECOIN_SEED, stablecoin.mint.as_ref()],
        bump = stablecoin.bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,

    #[account(
        seeds = [ROLE_SEED, stablecoin.key().as_ref(), Role::Pauser.to_seed(), authority.key().as_ref()],
        bump,
    )]
    pub role_assignment: Option<Account<'info, RoleAssignment>>,
}
