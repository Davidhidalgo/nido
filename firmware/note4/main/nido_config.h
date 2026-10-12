#pragma once
#include <cstdint>
#include <string>
#include "cJSON.h"
namespace nido {
struct RuntimeConfig {
    std::string ssid, password, endpoint, certificate, token, device_id, grant;
    int64_t issued_at=0,expires_at=0;
    bool configured() const { return !ssid.empty() && !endpoint.empty() && token.size()==64 && !certificate.empty(); }
};
std::string MaintenanceSsid(const uint8_t (&factory_mac)[6]);
bool LocalEndpoint(const char* value);
bool HexString(const char* value,size_t length);
bool ParseRuntimeConfig(const cJSON* root,RuntimeConfig& result,bool pairing);
std::string ConfigJson(const RuntimeConfig& config);
struct MaintenanceGesture {
    int64_t since=-1; bool ready=false;
    // Latch only after a full continuous chord, activate once both are released.
    bool Tick(bool front,bool lower,int64_t now_ms) {
        if(ready) { if(!front && !lower){ready=false;since=-1;return true;} return false; }
        if(front && lower) { if(since<0)since=now_ms; if(now_ms-since>=5000)ready=true; }
        else since=-1;
        return false;
    }
};
inline bool UpdatePowerAllowed(bool valid,uint8_t percent,bool external) { return external || (valid && percent>=40); }
}
