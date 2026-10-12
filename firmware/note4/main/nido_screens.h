#ifndef NIDO_SCREENS_H_
#define NIDO_SCREENS_H_
#include "hearth_canvas.h"
#include "nido_power_policy.h"
#include "nido_device.h"
namespace nido {
enum class ButtonSymbol { Upper, Lower, Front };
void DrawButtonSymbol(HearthCanvas& canvas,int x,int y,ButtonSymbol button);
void DrawHome(HearthCanvas& canvas, const HomeDay* day, const char* today, bool updating=false, bool failed=false, bool demo=false, bool low_battery=false, const HomeSnapshot* snapshot=nullptr);
void DrawModal(HearthCanvas& canvas, const HearthCanvas& background, const DeviceCard& card);
bool DrawMaintenance(HearthCanvas& canvas, const HearthCanvas& background, const char* ssid,const char* version);
void DrawReady(HearthCanvas& canvas, bool connected = false);
void DrawListening(HearthCanvas& canvas, bool connected = false);
void DrawRecorded(HearthCanvas& canvas, const AudioSummary& summary,
                  bool limited, bool failed);
void DrawDeviceCard(HearthCanvas& canvas, const DeviceCard& card);
void DrawDeviceError(HearthCanvas& canvas, bool uncertain);
void DrawStatusIcons(HearthCanvas& canvas, bool low_battery, bool wifi_connected);
}  // namespace nido
#endif
