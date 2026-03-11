use anchor_lang::prelude::*;

use crate::constants::*;
use crate::error::SSSError;
use crate::events;
use crate::state::*;

pub fn add_to_allowlist_handler(
    ctx: Context<AllowlistAdd>,
    address: Pubkey,
) -> Result<()> {
    let stablecoin = &ctx.accounts.stablecoin;
    require!(stablecoin.enable_allowlist, SSSError::AllowlistNotEnabled);
    require!(
        ctx.accounts.authority.key() == stablecoin.authority,
        SSSError::Unauthorized
    );

    let allowlist_entry = &mut ctx.accounts.allowlist_entry;
    allowlist_entry.stablecoin = stablecoin.key();
    allowlist_entry.address = address;
    allowlist_entry.added_at = Clock::get()?.unix_timestamp;
    allowlist_entry.added_by = ctx.accounts.authority.key();
    allowlist_entry.bump = ctx.bumps.allowlist_entry;

    emit!(events::AllowlistAdded {
        mint: stablecoin.mint,
        address,
        by: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

pub fn remove_from_allowlist_handler(
    ctx: Context<AllowlistRemove>,
    _address: Pubkey,
) -> Result<()> {
    let stablecoin = &ctx.accounts.stablecoin;
    require!(stablecoin.enable_allowlist, SSSError::AllowlistNotEnabled);
    require!(
        ctx.accounts.authority.key() == stablecoin.authority,
        SSSError::Unauthorized
    );

    emit!(events::AllowlistRemoved {
        mint: stablecoin.mint,
        address: ctx.accounts.allowlist_entry.address,
        by: ctx.accounts.authority.key(),
        timestamp: Clock::get()?.unix_timestamp,
    });

    // Account closed by Anchor's `close` constraint

    Ok(())
}

#[derive(Accounts)]
#[instruction(address: Pubkey)]
pub struct AllowlistAdd<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, stablecoin.mint.as_ref()],
        bump = stablecoin.bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,

    #[account(
        init,
        payer = authority,
        space = AllowlistEntry::LEN,
        seeds = [ALLOWLIST_SEED, stablecoin.key().as_ref(), address.as_ref()],
        bump,
    )]
    pub allowlist_entry: Account<'info, AllowlistEntry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(address: Pubkey)]
pub struct AllowlistRemove<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        seeds = [STABLECOIN_SEED, stablecoin.mint.as_ref()],
        bump = stablecoin.bump,
    )]
    pub stablecoin: Account<'info, Stablecoin>,

    #[account(
        mut,
        close = authority,
        seeds = [ALLOWLIST_SEED, stablecoin.key().as_ref(), address.as_ref()],
        bump = allowlist_entry.bump,
    )]
    pub allowlist_entry: Account<'info, AllowlistEntry>,
}
