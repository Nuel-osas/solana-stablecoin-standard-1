# SSS Devnet Smoke Test Evidence

**Run timestamp:** 2026-03-12 14:00:57 UTC

**Authority wallet:** `DBk7Bu7tdfJ3CwmMWf9L3u1ScsbzN2FCnGrsGeuZvQAk`

## Transaction Log

| # | Preset | Operation | Command (abbreviated) | Transaction Signature | Status |
|---|--------|-----------|----------------------|----------------------|--------|
| 1 | SSS-1 | Initialize token | `sss-token init sss-1 ...` | [`3noDCD3uE4Uf...`](https://explorer.solana.com/tx/3noDCD3uE4UfsHanEyZLD9VC1zCpZ7FRGF9PWBCHeSSzRvXdmkBT85AmejEHq9qdFs3f29rBLx1b17ym6TiRJToj?cluster=devnet) | SUCCESS |
| 2 | SSS-1 | Assign minter role | `sss-token roles assign --role minter ...` | [`5GB4sqd7GBzG...`](https://explorer.solana.com/tx/5GB4sqd7GBzGbvpaP3x8zLMcCL5VUtLTjYXKJ1RsQYHRkgs1j9N6kUSZJZp7QvpHy7TRdwrqzFWYkJyykhs1ZNdi?cluster=devnet) | SUCCESS |
| 3 | SSS-1 | Add minter | `sss-token minters add ...` | [`5Lyy9Bomopxt...`](https://explorer.solana.com/tx/5Lyy9BomopxtbkRbJyjDZjy2dCsLhs9WaeNR6zPnyqW7GyW8o76vBAPKgcMXvz7rNDvE7gEVBdmjtTqDai9NJv4u?cluster=devnet) | SUCCESS |
| 4 | SSS-1 | Mint 1000 tokens | `sss-token mint --amount 1000 ...` | [`2KcdfGdBcWJ3...`](https://explorer.solana.com/tx/2KcdfGdBcWJ3458eDCPS7rXfH551veX6cvSRg4ZFFpj9N3UzXNYJ73uqJMh8wKMoFkH9SmznU3z5PLitQzmNhg8Y?cluster=devnet) | SUCCESS |
| 5 | SSS-1 | Assign pauser role | `sss-token roles assign --role pauser ...` | [`36Ro5tU1hVmH...`](https://explorer.solana.com/tx/36Ro5tU1hVmHbwk7MNvqsk1B5pJ9AGuW2MjJaXMFneFX5BCbZxuaturZ3BqNis3oaV6QcA1bQ9rQzvz58LBQuj1Q?cluster=devnet) | SUCCESS |
| 6 | SSS-1 | Freeze token account | `sss-token freeze ...` | [`5Yekzg4FAynp...`](https://explorer.solana.com/tx/5Yekzg4FAynpj3UjEzXG8iC2wiLF88ywbxYWXqA5QzEEC5RfuyNJvdzMS8MAi5E6ciXmzdgvvJo7fVZh14RYJND1?cluster=devnet) | SUCCESS |
| 7 | SSS-1 | Thaw token account | `sss-token thaw ...` | [`55hYyT4vkvsP...`](https://explorer.solana.com/tx/55hYyT4vkvsP1kevwkHG6jUXh15JJ6YGC9mFxFZvtMhPr4o4wNoKiLVWVyySEsmwtbjaZbWgEfiM8frmnbKdtoh9?cluster=devnet) | SUCCESS |
| 8 | SSS-1 | Pause token | `sss-token pause ...` | [`3s7YCqasxdr7...`](https://explorer.solana.com/tx/3s7YCqasxdr74HeNQK4ZCKjoiEQzpFFbmRUCJWPYsWm5ba5QEGQ1gdPocSnD9V647sQCYsgpewRngwmjxdRXWXXQ?cluster=devnet) | SUCCESS |
| 9 | SSS-1 | Unpause token | `sss-token unpause ...` | [`4p5PdHbD6JmD...`](https://explorer.solana.com/tx/4p5PdHbD6JmDWP5rPyt5iDW8vVnhX6rPs5WKnVYXXbKsTCxQfJ8K4gYTFxZUbkdw4spUwJ17iZWdxXRvpau2XWgY?cluster=devnet) | SUCCESS |
| 10 | SSS-1 | Query status | `sss-token status ...` | `(not captured)` | SUCCESS |
| 11 | SSS-1 | Query supply | `sss-token supply ...` | `(not captured)` | SUCCESS |
| 12 | SSS-1 | Query holders | `sss-token holders ...` | `(not captured)` | SUCCESS |
| 13 | SSS-2 | Initialize token | `sss-token init sss-2 ...` | [`9zBzAxGxYVbr...`](https://explorer.solana.com/tx/9zBzAxGxYVbrzkwCfq9VoMGxpo39eUKwXCN1jdoCd6mUwr6beLhj5J25CSgfz9fLJCaWxExhrrvpk8wJ3yAcWks?cluster=devnet) | SUCCESS |
| 14 | SSS-2 | Assign minter role | `sss-token roles assign --role minter ...` | [`5VPGauv1xNzN...`](https://explorer.solana.com/tx/5VPGauv1xNzNNdVaQJAPqNyEF688zAxcLQ9BbiigqvJg3DLNqE2f9782AohFcdEbhERCsuekaf1HRYMGziWJ1D2t?cluster=devnet) | SUCCESS |
| 15 | SSS-2 | Assign blacklister role | `sss-token roles assign --role blacklister ...` | [`664ZzjATt78p...`](https://explorer.solana.com/tx/664ZzjATt78p3jysEar7g3V8c33pNDdvDSncwuhdFhHRbHJXEYNAAfSSJ7HzNKVTUeaNmDezw8xYbnkSFiW4nrGk?cluster=devnet) | SUCCESS |
| 16 | SSS-2 | Assign seizer role | `sss-token roles assign --role seizer ...` | [`47XgVbLq3Zne...`](https://explorer.solana.com/tx/47XgVbLq3ZneoFrDmjdqw44yq2ZMesNTXSLNtLqnhEWWqhaZP8YkKHXURJxifctn8cjEvDRVLQnMmMjjuALydmCL?cluster=devnet) | SUCCESS |
| 17 | SSS-2 | Add minter | `sss-token minters add ...` | [`3ppDXaSWdYKi...`](https://explorer.solana.com/tx/3ppDXaSWdYKiXcqhpfXrE459qxd4aWSXZHpBKid4uXFZYAPWaSTAowaraHM2Xxi44hGHXfNEPEM9sgMpKdzpXFHt?cluster=devnet) | SUCCESS |
| 18 | SSS-2 | Mint 5000 tokens to authority | `sss-token mint --amount 5000 ...` | [`52TFbGs3iA7G...`](https://explorer.solana.com/tx/52TFbGs3iA7GHRku5eA8iXT8e2PqZQKUvgeXhd6w9UhKWHR8UabCzXY6MJSgamMnsS5kRKnnKLkDHSVA1covhjce?cluster=devnet) | SUCCESS |
| 19 | SSS-2 | Transfer 500 to secondary | `sss-token transfer --amount 500 ...` | [`3mvZ8ixXdtVC...`](https://explorer.solana.com/tx/3mvZ8ixXdtVC9Hoheth6rcn3dckXdSzzdQkSfCgs5B38Y5m3Y3zeyjV93RnmagnuhWB816br8MC8QX59gZGVVffQ?cluster=devnet) | SUCCESS |
| 20 | SSS-2 | Blacklist secondary addr | `sss-token blacklist add ...` | [`2NA9sRZsUqBM...`](https://explorer.solana.com/tx/2NA9sRZsUqBMSzuDCdEoE7mafD2MWnz5TmopjhexixeaUC7iB3JY2xxEgGcvFau55qRiSdpyQi9DwmUVcu2N5cA8?cluster=devnet) | SUCCESS |
| 21 | SSS-2 | Seize tokens from blacklisted | `sss-token seize ...` | [`2GMUysdhadbp...`](https://explorer.solana.com/tx/2GMUysdhadbpapQusGVBS7VJXm2KEQqmHpL5E4rnyKrP5wLyppGL3tkx2TqNRj4Uh2ydtK4Leaiv59dwVCFDY6Yt?cluster=devnet) | SUCCESS |
| 22 | SSS-2 | Transfer 100 tokens | `sss-token transfer --amount 100 ...` | [`3DwHUw6zwy7g...`](https://explorer.solana.com/tx/3DwHUw6zwy7gyvFp1cXXpj2R2DCekAnWMZ4S2R1fatgh3aC6M47gtGMc9GRtd139JWKWpd9uTYaM9qxTYGnMCikv?cluster=devnet) | SUCCESS |
| 23 | SSS-2 | Query status | `sss-token status ...` | `(not captured)` | SUCCESS |
| 24 | SSS-2 | Query supply | `sss-token supply ...` | `(not captured)` | SUCCESS |
| 25 | SSS-2 | Query holders | `sss-token holders ...` | `(not captured)` | SUCCESS |
| 26 | SSS-3 | Initialize token | `sss-token init sss-3 ...` | [`2u6KtkPyaYu9...`](https://explorer.solana.com/tx/2u6KtkPyaYu9ouaV9d9sXeBu91HNnngUePG5Sb2tJa94WQLxVKW5X8AjumuNEJA4nYsR2bnGouxn9c9qxrZJ1qa6?cluster=devnet) | SUCCESS |
| 27 | SSS-3 | Assign minter role | `sss-token roles assign --role minter ...` | [`3fvcMvahgSsM...`](https://explorer.solana.com/tx/3fvcMvahgSsMcfEewMBVnQhvxrvRBtQQRTJxgPvxKu33rNp619qr6hW6kSCnw5cTDygMSsoSLvoSD8Z2m9nJ1Fg7?cluster=devnet) | SUCCESS |
| 28 | SSS-3 | Add minter | `sss-token minters add ...` | [`8JyuY4ou9Ztg...`](https://explorer.solana.com/tx/8JyuY4ou9ZtgHv5PZ9ewCMEGtk6Erfr3fBBvGNBeqLvm17B9zv4tnvf4X57HwQVSgRPETTafDzsp9FhC4wmSxMX?cluster=devnet) | SUCCESS |
| 29 | SSS-3 | Mint 2000 tokens | `sss-token mint --amount 2000 ...` | [`42AN1oJXM5f6...`](https://explorer.solana.com/tx/42AN1oJXM5f6RHfkyhPTbQRcfntV3SjUbLJpCHAtoPLfwTb3vceLsQmD6H2goTjKCcBzGwg4MwzxRnK88ZujQBe8?cluster=devnet) | SUCCESS |
| 30 | SSS-3 | Transfer without allowlist (expect fail) | `sss-token transfer ... (no allowlist)` | `(expected failure)` | EXPECTED FAIL |
| 31 | SSS-3 | Add authority to allowlist | `sss-token allowlist add (authority) ...` | [`4W6XtWERZcYn...`](https://explorer.solana.com/tx/4W6XtWERZcYnTrtEXzzZYrTFCKC1yQnNf5x47LZj4FJqNAnMW8eyhAwZcDugddDrZdoaEXW76pWMLM96VCDqwj7F?cluster=devnet) | SUCCESS |
| 32 | SSS-3 | Add secondary to allowlist | `sss-token allowlist add (secondary) ...` | [`5ppDwbNxW9r1...`](https://explorer.solana.com/tx/5ppDwbNxW9r1kN5MwEytHJxLdmS3WwV7Hj74nqEBGwFMMTtsg4CMh21XWMCyqW9BCvJg3T7CcCGZxrHVownfgzq6?cluster=devnet) | SUCCESS |
| 33 | SSS-3 | Transfer with allowlist | `sss-token transfer ... (allowlisted)` | [`4gbPiQEV5vMc...`](https://explorer.solana.com/tx/4gbPiQEV5vMcQLwXDztfAsiQVKrLTwVB2xPyDq36cUnE3GYkJGJuSZoxfQKUN8bF6uEsRjHTjFjhWdQ7pZ2jS6pD?cluster=devnet) | SUCCESS |
| 34 | SSS-3 | Query status | `sss-token status ...` | `(not captured)` | SUCCESS |
| 35 | SSS-3 | Query supply | `sss-token supply ...` | `(not captured)` | SUCCESS |
| 36 | SSS-3 | Query holders | `sss-token holders ...` | `(not captured)` | SUCCESS |

## Mint Addresses

| Preset | Mint Address |
|--------|-------------|
| SSS-1  | `DkX4idrdkdhH8XxNG1s1nyqmtU7yKNyFAUNpHRLepCiG` |
| SSS-2  | `8MzsR95J7KnJgnD9q5ZPMCjbL4bZUxwuKhSCFWufTaAu` |
| SSS-3  | `8XM7we4U1VvjDqiaHiMpWZfajSPEsXaGW6Wzo9dVhUhJ` |

## Test Wallets

| Role | Address |
|------|---------|
| Authority | `DBk7Bu7tdfJ3CwmMWf9L3u1ScsbzN2FCnGrsGeuZvQAk` |
| Secondary | `BFc2pNcPF7sGCg4R6BYQy67fx6THnBQocoGSixT4cr7D` |
| Third     | `5c1rPhuQvpX7sEn7PnbA7FyQc9eBVFopoB3gMbej364K` |

## Run Info

- **Cluster:** devnet
- **Total operations:** 36
- **Full log:** `evidence/devnet-smoke-test.log`
- **Generated by:** `scripts/devnet-smoke-test.sh`
