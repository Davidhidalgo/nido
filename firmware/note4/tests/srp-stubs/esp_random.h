#pragma once
#include <stdlib.h>
#include <stdint.h>
#include <stddef.h>
static inline uint32_t esp_random(void) { return arc4random(); }
static inline void esp_fill_random(void* p,size_t n) { arc4random_buf(p,n); }
