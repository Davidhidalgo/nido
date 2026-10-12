#pragma once
#include <cstddef>
#include <cstdint>
#include "nido_home.h"
namespace nido {
struct DeviceRow {
    char label[241];
    char value[321];
};
struct DeviceCard {
    char id[65];
    char title[241];
    char status[16];
    char type[16];
    char body[961];
    char date[11];
    char end_date[11];
    char summary[481];
    char start_time[6];
    char end_time[6];
    char location[481];
    bool all_day;
    bool duration_estimated;
    char meal[16];
    char before[481];
    char after[481];
    char labels[2][161];
    DeviceRow rows[3];
    int row_count;
    char before_label[81];
    char after_label[81];
    char value[161];
    char caption[241];
};
struct DeviceResult {
    bool cancelled = false;
    bool ok = false;
    bool question = false;
    bool uncertain = false;
    bool wifi_failed = false;
    char turn[37] = {};
    DeviceCard card = {};
    char affected_date[11] = {};
    int64_t server_time = 0;
    int64_t session_expires_at = 0;
};
// 0=keep running, 1=stop, 2=interrupt and preserve the conversation.
using DeviceCancelPoll = int (*)();
using DevicePaint = void (*)(const DeviceCard&);
bool DeviceHome(HomeSnapshot& snapshot, const char* anchor = nullptr, bool dismiss = false);
bool DeviceEnabled();
using DevicePower = bool (*)();
bool DeviceConfigured();
const char* DeviceVersion();
void DeviceConfirmFirmware();
void DeviceBootGuard();
bool DeviceMaintenanceStart(DevicePower power);
const char* DeviceMaintenanceName();
bool DevicePairingCard(DeviceCard& card);
bool DeviceMaintenanceTick(bool exit=false);
void DeviceCheckUpdate(DevicePower power, DevicePaint paint);
bool DeviceWifiConnected();
void DeviceWarmWifi();
bool DeviceWifiAwake();
bool DeviceWifiWarming();
void DeviceWifiIdle(bool keep);
void DeviceAudio(DeviceResult& result, const int16_t* pcm, size_t samples, DevicePaint paint, DeviceCancelPoll cancel=nullptr);
void DeviceAnswer(DeviceResult& result, const char* turn, const char* card, bool upper, DevicePaint paint, DeviceCancelPoll cancel=nullptr);
}
