# Trident Fuzzing

This repo uses the current Trident 0.12 layout:

- root config: `Trident.toml`
- fuzz target: `trident-tests/fuzz_tests/fuzz_0`

Quick checks:

```bash
cargo check --manifest-path trident-tests/fuzz_tests/fuzz_0/Cargo.toml
TRIDENT_ITERATIONS=1 TRIDENT_FLOW_CALLS=1 cargo run --manifest-path trident-tests/fuzz_tests/fuzz_0/Cargo.toml --quiet
```

The current harness verifies:

- Trident can load the `sss-token` and `sss-transfer-hook` program binaries
- core PDA derivations for SSS-1 and SSS-2 match the on-chain seeds

To expand this into full transaction fuzzing, add generated instruction builders and
wire them into the `#[flow]` methods in `fuzz_0/test_fuzz.rs`.
