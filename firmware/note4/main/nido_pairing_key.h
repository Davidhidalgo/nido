#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include "mbedtls/dhm.h"

// SRP requires A mod N != 0. Use the same standardized modulus as ESP-IDF.
static inline bool ValidPairingPublicKey(const uint8_t* key, size_t size) {
    static const uint8_t prime[] = MBEDTLS_DHM_RFC3526_MODP_3072_P_BIN;
    if (!key || size != sizeof(prime) || memcmp(key, prime, size) >= 0) return false;
    uint8_t nonzero = 0;
    for (size_t i = 0; i < size; ++i) nonzero |= key[i];
    return nonzero != 0;
}
