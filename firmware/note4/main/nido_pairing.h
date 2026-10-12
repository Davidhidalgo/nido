#pragma once
#include <string>
#include "esp_http_server.h"
#include "cJSON.h"
namespace nido {
using PairApply=bool(*)(const cJSON*);
struct PairView {std::string code,ip,state;};
bool PairRegister(httpd_handle_t server,PairApply apply);
bool PairStart(const std::string& name,const std::string& ip);
void PairStop();
bool PairViewChanged(PairView& view);
}
