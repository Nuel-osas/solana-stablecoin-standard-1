use trident_fuzz::fuzzing::*;

#[derive(Default)]
pub struct AccountAddresses {
    pub authorities: AddressStorage,
    pub operators: AddressStorage,
    pub mints: AddressStorage,
    pub stablecoins: AddressStorage,
    pub minter_roles: AddressStorage,
    pub burner_roles: AddressStorage,
    pub blacklister_roles: AddressStorage,
    pub pauser_roles: AddressStorage,
    pub seizer_roles: AddressStorage,
    pub minter_infos: AddressStorage,
    pub blacklist_entries: AddressStorage,
    pub blacklisted_wallets: AddressStorage,
    pub treasury_wallets: AddressStorage,
}
