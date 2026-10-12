#pragma once
#include "nido_device.h"
struct cJSON;
namespace nido {
// Decode into a fresh card; malformed input never changes the displayed card.
bool ParseDeviceCard(const cJSON* json, DeviceCard& card);
}
