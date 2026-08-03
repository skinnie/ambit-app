/* Signature from openambit's src/libambit/sha256.h. Test implementation in
 * crypto.c. */
#ifndef __SHA256_H__
#define __SHA256_H__

#include <stddef.h>
#include <stdint.h>

void sha256(const uint8_t *data, size_t len, uint8_t *hash);

#endif
