/* Signatures from openambit's src/libambit/crc16.h, to build the serializer outside
 * the openambit tree. The test implementation is in crypto.c. */
#ifndef __CRC16_H__
#define __CRC16_H__

#include <stddef.h>
#include <stdint.h>

uint16_t crc16_ccitt_false(const uint8_t *buf, size_t buflen);
uint16_t crc16_ccitt_false_init(const uint8_t *buf, size_t buflen, uint16_t crc);

#endif
