#include "nido_device.h"
#include "nido_card.h"
#include "sdkconfig.h"
#include "nido_ota.h"
#include "esp_system.h"
#if CONFIG_NIDO_DEVICE_ENABLED
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <string>
#include <memory>
#include <vector>
#include <mutex>
#include <atomic>
#include "cJSON.h"
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "nido_config.h"
#include "nido_ota.h"
#include "nido_maintenance_page.h"
#include "nido_portal.h"
#include "nido_pairing.h"
#include "nido_github.h"
#include "esp_http_server.h"
#include "esp_app_desc.h"
#include "esp_mac.h"
#include "nvs.h"
#include "lwip/sockets.h"
#include "lwip/inet.h"
#include <sys/time.h>

namespace nido {
namespace {
constexpr char kTag[] = "nido_device";
EventGroupHandle_t g_wifi_events;
constexpr int kConnected = BIT0;
constexpr int kDisconnected = BIT1;
bool g_initialized;
std::mutex g_wifi_mutex;
std::atomic<bool> g_wifi_started{false},g_wifi_warming{false};
unsigned g_wifi_users=0;
int64_t g_wifi_until=0;
constexpr int64_t kWifiWarmUs=60000000;

void WifiEvent(void*, esp_event_base_t base, int32_t id, void* data) {
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) xEventGroupSetBits(g_wifi_events, kConnected);
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        const auto* event = static_cast<wifi_event_sta_disconnected_t*>(data);
        ESP_LOGW(kTag,"wifi disconnected reason=%u",event ? event->reason : 0);
        xEventGroupClearBits(g_wifi_events,kConnected);
        xEventGroupSetBits(g_wifi_events,kDisconnected);
    }
}
void InitWifi();
RuntimeConfig g_config;
bool g_config_loaded=false,g_storage_ready=false;
std::atomic<bool> g_maintenance{false},g_exit_maintenance{false},g_restart{false};
std::atomic<int64_t> g_maintenance_activity{0};
httpd_handle_t g_http_server=nullptr;
std::string g_ap_name,g_web_session,g_boot_job;
std::atomic<bool> g_pair_start{false};
std::atomic<bool> g_pair_requested{false};
int64_t g_pair_finish_at=0;
esp_netif_t* g_ap_netif=nullptr;
DevicePower g_power=nullptr;
std::string RandomHex(size_t bytes) {
    std::string out;out.reserve(bytes*2);for(size_t i=0;i<bytes;++i){uint8_t value;esp_fill_random(&value,1);char hex[3];std::snprintf(hex,sizeof(hex),"%02x",value);out+=hex;}return out;
}
std::string SavedString(const char* key) {
    nvs_handle_t h;if(!g_storage_ready || nvs_open_from_partition("nido_config","nido",NVS_READONLY,&h)!=ESP_OK)return "";
    char id[65]={};size_t size=sizeof(id);nvs_get_str(h,key,id,&size);nvs_close(h);return id;
}
bool SaveJob(const char* id,const char* version) {
    nvs_handle_t h;if(!g_storage_ready || nvs_open_from_partition("nido_config","nido",NVS_READWRITE,&h)!=ESP_OK)return false;
    const bool ok=nvs_set_str(h,"ota_job",id)==ESP_OK && nvs_set_str(h,"ota_version",version)==ESP_OK && nvs_commit(h)==ESP_OK;nvs_close(h);return ok;
}
bool SaveConfig(const char* key,const RuntimeConfig& config) {
    if(!g_storage_ready)return false;
    nvs_handle_t handle;if(nvs_open_from_partition("nido_config","nido",NVS_READWRITE,&handle)!=ESP_OK)return false;
    const std::string json=ConfigJson(config);
    const bool ok=!json.empty() && nvs_set_str(handle,key,json.c_str())==ESP_OK && nvs_commit(handle)==ESP_OK;nvs_close(handle);return ok;
}
bool LoadConfig(const char* key,RuntimeConfig& config,bool pairing=false) {
    if(!g_storage_ready)return false;
    nvs_handle_t handle;if(nvs_open_from_partition("nido_config","nido",NVS_READONLY,&handle)!=ESP_OK)return false;
    size_t size=0;bool ok=nvs_get_str(handle,key,nullptr,&size)==ESP_OK && size<=8192;
    std::vector<char> bytes(ok ? size : 1);if(ok)ok=nvs_get_str(handle,key,bytes.data(),&size)==ESP_OK;nvs_close(handle);
    if(!ok)return false;
    cJSON* root=cJSON_Parse(bytes.data());ok=ParseRuntimeConfig(root,config,pairing);cJSON_Delete(root);return ok;
}
void LoadRuntime() {
    if(g_config_loaded)return;
    g_storage_ready=nvs_flash_init_partition("nido_config")==ESP_OK;
    LoadConfig("active",g_config);g_boot_job=SavedString("ota_job");g_config_loaded=true;
}
bool SetStation(const RuntimeConfig& config) {
    wifi_config_t station={};std::memcpy(station.sta.ssid,config.ssid.data(),std::min(config.ssid.size(),sizeof(station.sta.ssid)));
    std::memcpy(station.sta.password,config.password.data(),std::min(config.password.size(),sizeof(station.sta.password)));
    station.sta.threshold.authmode=config.password.empty() ? WIFI_AUTH_OPEN : WIFI_AUTH_WPA2_PSK;station.sta.pmf_cfg.capable=true;
    return esp_wifi_set_config(WIFI_IF_STA,&station)==ESP_OK;
}
bool WebAp(httpd_req_t* req) {
    sockaddr_storage local{};socklen_t size=sizeof(local);
    return getsockname(httpd_req_to_sockfd(req),reinterpret_cast<sockaddr*>(&local),&size)==0 && MaintenanceAddress(local,size);
}
bool WebOrigin(httpd_req_t* req,bool session=true) {
    if(!WebAp(req))return false;
    char host[64]={};if(httpd_req_get_hdr_value_str(req,"Host",host,sizeof(host))!=ESP_OK || (std::strcmp(host,"192.168.4.1") && std::strcmp(host,"192.168.4.1:80")))return false;
    if(httpd_req_get_hdr_value_len(req,"Origin")){char origin[64]={};if(httpd_req_get_hdr_value_str(req,"Origin",origin,sizeof(origin))!=ESP_OK || std::strcmp(origin,"http://192.168.4.1"))return false;}
    if(session){char token[65]={};if(httpd_req_get_hdr_value_str(req,"X-Nido-Session",token,sizeof(token))!=ESP_OK || g_web_session!=token)return false;}
    return true;
}
esp_err_t WebReply(httpd_req_t* req,int status,const char* message) {
    httpd_resp_set_status(req,status==200 ? "200 OK" : status==403 ? "403 Forbidden" : "400 Bad Request");
    httpd_resp_set_type(req,"application/json");httpd_resp_set_hdr(req,"Cache-Control","no-store");
    cJSON* root=cJSON_CreateObject();cJSON_AddStringToObject(root,status==200 ? "message" : "error",message);char* body=cJSON_PrintUnformatted(root);
    const auto result=httpd_resp_send(req,body ? body : "{}",HTTPD_RESP_USE_STRLEN);cJSON_free(body);cJSON_Delete(root);return result;
}
bool Receive(httpd_req_t* req,void* bytes,size_t size) {
    auto* out=static_cast<char*>(bytes);while(size){const int n=httpd_req_recv(req,out,size);if(n<=0)return false;out+=n;size-=n;g_maintenance_activity=esp_timer_get_time();}return true;
}
esp_err_t WebPortal(httpd_req_t* req,httpd_err_code_t) {
    if(!WebAp(req))return WebReply(req,403,"Acceso no permitido");
    httpd_resp_set_status(req,"302 Found");
    httpd_resp_set_hdr(req,"Location","http://192.168.4.1/");
    httpd_resp_set_hdr(req,"Cache-Control","no-store");
    return httpd_resp_send(req,"Abre http://192.168.4.1/ para configurar Nido.",HTTPD_RESP_USE_STRLEN);
}
esp_err_t WebRoot(httpd_req_t* req) {
    if(!WebOrigin(req,false))return WebPortal(req,HTTPD_404_NOT_FOUND);
    g_maintenance_activity=esp_timer_get_time();std::string html=kMaintenancePage;html.replace(html.find("__SESSION__"),11,g_web_session);
    httpd_resp_set_type(req,"text/html; charset=utf-8");httpd_resp_set_hdr(req,"Cache-Control","no-store");httpd_resp_set_hdr(req,"Referrer-Policy","no-referrer");
    httpd_resp_set_hdr(req,"Content-Security-Policy","default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    return httpd_resp_send(req,html.c_str(),html.size());
}
esp_err_t WebStatus(httpd_req_t* req) {
    if(!WebOrigin(req))return WebReply(req,403,"Acceso no permitido");
    g_maintenance_activity=esp_timer_get_time();
    cJSON* root=cJSON_CreateObject();cJSON_AddStringToObject(root,"version",esp_app_get_description()->version);cJSON_AddBoolToObject(root,"configured",g_config.configured());cJSON_AddBoolToObject(root,"wifiConfigured",!g_config.ssid.empty());
    char* json=cJSON_PrintUnformatted(root);httpd_resp_set_type(req,"application/json");httpd_resp_set_hdr(req,"Cache-Control","no-store");auto result=httpd_resp_send(req,json ? json : "{}",HTTPD_RESP_USE_STRLEN);cJSON_free(json);cJSON_Delete(root);return result;
}
esp_err_t WebNetworks(httpd_req_t* req) {
    if(!WebOrigin(req))return WebReply(req,403,"Acceso no permitido");
    g_maintenance_activity=esp_timer_get_time();std::lock_guard<std::mutex> lock(g_wifi_mutex);
    wifi_scan_config_t scan={};
    if(esp_wifi_scan_start(&scan,true)!=ESP_OK)return WebReply(req,400,"No se pudieron consultar las redes");
    uint16_t count=20;std::vector<wifi_ap_record_t> networks(count);
    if(esp_wifi_scan_get_ap_records(&count,networks.data())!=ESP_OK)return WebReply(req,400,"No se pudieron consultar las redes");
    cJSON* root=cJSON_CreateObject();auto* list=cJSON_AddArrayToObject(root,"networks");
    for(uint16_t i=0;i<count;++i){const std::string ssid(reinterpret_cast<char*>(networks[i].ssid),strnlen(reinterpret_cast<char*>(networks[i].ssid),32));if(ssid.empty())continue;auto* item=cJSON_CreateObject();cJSON_AddStringToObject(item,"ssid",ssid.c_str());cJSON_AddNumberToObject(item,"rssi",networks[i].rssi);cJSON_AddItemToArray(list,item);}
    char* json=cJSON_PrintUnformatted(root);httpd_resp_set_type(req,"application/json");httpd_resp_set_hdr(req,"Cache-Control","no-store");const auto result=httpd_resp_send(req,json ? json : "{}",HTTPD_RESP_USE_STRLEN);cJSON_free(json);cJSON_Delete(root);g_maintenance_activity=esp_timer_get_time();return result;
}
bool CandidateConnect(const RuntimeConfig& config) {
    esp_wifi_disconnect();xEventGroupClearBits(g_wifi_events,kConnected|kDisconnected);
    if(!SetStation(config)||esp_wifi_connect()!=ESP_OK)return false;
    const auto bits=xEventGroupWaitBits(g_wifi_events,kConnected|kDisconnected,pdFALSE,pdFALSE,pdMS_TO_TICKS(15000));
    return bits&kConnected;
}
bool CandidateRequest(const RuntimeConfig& config,const char* path,const char* body) {
    const std::string url=config.endpoint+path;esp_http_client_config_t settings={};settings.url=url.c_str();settings.cert_pem=config.certificate.c_str();settings.timeout_ms=15000;settings.disable_auto_redirect=true;
    auto client=esp_http_client_init(&settings);if(!client)return false;
    const std::string auth="Bearer "+config.token;esp_http_client_set_header(client,"Authorization",auth.c_str());
    if(body){esp_http_client_set_method(client,HTTP_METHOD_POST);esp_http_client_set_header(client,"Content-Type","application/json");esp_http_client_set_post_field(client,body,std::strlen(body));}
    const bool ok=esp_http_client_perform(client)==ESP_OK && esp_http_client_get_status_code(client)==200;esp_http_client_cleanup(client);return ok;
}
bool ApplyCodePairing(const cJSON* packet) {
    std::lock_guard<std::mutex> lock(g_wifi_mutex);
    RuntimeConfig candidate=g_config,previous;
    cJSON* combined=cJSON_Duplicate(packet,true);if(!combined)return false;
    const auto* grant=cJSON_GetObjectItemCaseSensitive(packet,"grant");
    const bool resume=LoadConfig("candidate",previous,true)&&cJSON_IsString(grant)&&previous.grant==grant->valuestring;
    const std::string token=resume?previous.token:RandomHex(32);
    uint8_t mac[6];if(esp_efuse_mac_get_default(mac)!=ESP_OK){cJSON_Delete(combined);return false;}
    char id[32];std::snprintf(id,sizeof(id),"note4-%02x%02x%02x%02x%02x%02x",mac[0],mac[1],mac[2],mac[3],mac[4],mac[5]);
    for(const char* key:{"ssid","password","token","deviceId"})cJSON_DeleteItemFromObjectCaseSensitive(combined,key);
    cJSON_AddStringToObject(combined,"ssid",g_config.ssid.c_str());cJSON_AddStringToObject(combined,"password",g_config.password.c_str());
    cJSON_AddStringToObject(combined,"token",token.c_str());cJSON_AddStringToObject(combined,"deviceId",id);
    bool ok=ParseRuntimeConfig(combined,candidate,true);cJSON_Delete(combined);if(!ok||!SaveConfig("candidate",candidate))return false;
    timeval now{static_cast<time_t>(candidate.issued_at),0};settimeofday(&now,nullptr);
    cJSON* request=cJSON_CreateObject();cJSON_AddStringToObject(request,"grant",candidate.grant.c_str());cJSON_AddStringToObject(request,"token",candidate.token.c_str());cJSON_AddStringToObject(request,"deviceId",candidate.device_id.c_str());
    char* raw=cJSON_PrintUnformatted(request);ok=raw&&CandidateRequest(candidate,"/v1/pair",raw);cJSON_free(raw);cJSON_Delete(request);
    if(!ok)return false;
    candidate.grant.clear();if(!SaveConfig("active",candidate))return false;g_config=candidate;return true;
}
esp_err_t WebConfigure(httpd_req_t* req) {
    if(!WebOrigin(req))return WebReply(req,403,"Acceso no permitido");
    if(req->content_len<=0 || req->content_len>8192)return WebReply(req,400,"Configuración demasiado grande");
    std::string body(req->content_len,'\0');if(!Receive(req,body.data(),body.size()))return ESP_FAIL;
    cJSON* root=cJSON_Parse(body.c_str());if(!root)return WebReply(req,400,"Configuración inválida");
    const auto* ssid=cJSON_GetObjectItemCaseSensitive(root,"ssid");const auto* password=cJSON_GetObjectItemCaseSensitive(root,"password");
    RuntimeConfig candidate=g_config;const auto* pairing=cJSON_GetObjectItemCaseSensitive(root,"pairing");
    const bool saved_wifi=pairing && !ssid && !password && !g_config.ssid.empty();
    if(!saved_wifi && (!cJSON_IsString(ssid)||!cJSON_IsString(password))){cJSON_Delete(root);return WebReply(req,400,"Guarda primero la red Wi-Fi");}
    const bool new_pair=pairing!=nullptr;
    cJSON* combined=pairing ? cJSON_Duplicate(pairing,true) : cJSON_Parse(ConfigJson(candidate).c_str());
    if(!combined){cJSON_Delete(root);return WebReply(req,400,"Importa el paquete de vinculación");}
    cJSON_DeleteItemFromObjectCaseSensitive(combined,"ssid");cJSON_AddStringToObject(combined,"ssid",saved_wifi ? g_config.ssid.c_str() : ssid->valuestring);
    cJSON_DeleteItemFromObjectCaseSensitive(combined,"password");cJSON_AddStringToObject(combined,"password",saved_wifi ? g_config.password.c_str() : password->valuestring);
    if(new_pair){
      // Recover the same candidate token after a lost pairing response.
      RuntimeConfig previous;const bool resume=LoadConfig("candidate",previous,true);
      const auto* grant=cJSON_GetObjectItemCaseSensitive(pairing,"grant");
      const std::string token=resume && cJSON_IsString(grant) && previous.grant==grant->valuestring ? previous.token : RandomHex(32);
      uint8_t mac[6];esp_read_mac(mac,ESP_MAC_WIFI_STA);char id[32];std::snprintf(id,sizeof(id),"note4-%02x%02x%02x%02x%02x%02x",mac[0],mac[1],mac[2],mac[3],mac[4],mac[5]);
      cJSON_DeleteItemFromObjectCaseSensitive(combined,"token");cJSON_AddStringToObject(combined,"token",token.c_str());
      cJSON_DeleteItemFromObjectCaseSensitive(combined,"deviceId");cJSON_AddStringToObject(combined,"deviceId",id);
    }
    bool ok=ParseRuntimeConfig(combined,candidate,new_pair);cJSON_Delete(combined);cJSON_Delete(root);
    if(!ok)return WebReply(req,400,new_pair ? "Paquete de vinculación inválido" : "Red o contraseña Wi-Fi inválidas");
    // Persist candidate before redeeming: a network failure must not generate a second token.
    if(!SaveConfig("candidate",candidate))return WebReply(req,400,"No se pudo guardar la configuración candidata");
    std::lock_guard<std::mutex> lock(g_wifi_mutex);
    if(new_pair){timeval now{static_cast<time_t>(candidate.issued_at),0};settimeofday(&now,nullptr);}
    ok=CandidateConnect(candidate);
    if(ok && new_pair){
        cJSON* request=cJSON_CreateObject();cJSON_AddStringToObject(request,"grant",candidate.grant.c_str());cJSON_AddStringToObject(request,"token",candidate.token.c_str());cJSON_AddStringToObject(request,"deviceId",candidate.device_id.c_str());
        char* raw=cJSON_PrintUnformatted(request);ok=raw && CandidateRequest(candidate,"/v1/pair",raw);cJSON_free(raw);cJSON_Delete(request);
    } else if(ok) {
        // Wi-Fi-only changes remain possible when the bridge is temporarily unavailable.
        ok=true;
    }
    if(ok){candidate.grant.clear();ok=SaveConfig("active",candidate);if(ok)g_config=candidate;}
    if(!ok){esp_wifi_disconnect();SetStation(g_config);return WebReply(req,400,"No se pudo confirmar la conexión. Se conservan los ajustes anteriores; vuelve a comprobarla.");}
    if(!g_config.configured()&&!g_pair_requested.exchange(true))g_pair_start=true;
    return WebReply(req,200,new_pair ? "Note4 vinculado con Nido" : "Wi-Fi guardada. Vuelve a tu red de casa y abre los ajustes de Nido. Introduce allí el código que muestra el Note4.");
}
esp_err_t WebPairStart(httpd_req_t* req) {
    if(!WebOrigin(req))return WebReply(req,403,"Acceso no permitido");
    if(g_config.ssid.empty())return WebReply(req,400,"Guarda primero la Wi-Fi");
    if(g_pair_requested)return WebReply(req,400,"Consulta la pantalla. Para otro código, sal y vuelve a entrar en mantenimiento.");
    std::lock_guard<std::mutex> lock(g_wifi_mutex);
    if(!CandidateConnect(g_config))return WebReply(req,400,"No se pudo conectar a la Wi-Fi guardada");
    g_pair_requested=true;g_pair_start=true;return WebReply(req,200,"Introduce en Nido el código que muestra la pantalla del Note4.");
}
esp_err_t WebExit(httpd_req_t* req) {if(!WebOrigin(req))return WebReply(req,403,"Acceso no permitido");g_exit_maintenance=true;return WebReply(req,200,"Saliendo");}
esp_err_t WebFirmware(httpd_req_t* req) {
    if(!WebOrigin(req))return WebReply(req,403,"Acceso no permitido");
    if(!g_power || !g_power())return WebReply(req,400,"Batería insuficiente. Conecta la alimentación.");
    if(req->content_len<16 || req->content_len>4196000)return WebReply(req,400,"Tamaño de firmware inválido");
    unsigned char header[16];if(!Receive(req,header,sizeof(header)))return ESP_FAIL;
    if(std::memcmp(header,"NIDOOTA1",8))return WebReply(req,400,"Archivo de firmware incompatible");
    const auto u32=[](const unsigned char* p){return uint32_t(p[0])|uint32_t(p[1])<<8|uint32_t(p[2])<<16|uint32_t(p[3])<<24;};
    const auto manifest_size=u32(header+8),signature_size=u32(header+12);
    if(manifest_size>1024 || signature_size!=512 || manifest_size+signature_size+16>=req->content_len)return WebReply(req,400,"Cabecera inválida");
    std::string manifest(manifest_size,'\0'),signature(signature_size,'\0');if(!Receive(req,manifest.data(),manifest.size())||!Receive(req,signature.data(),signature.size()))return ESP_FAIL;
    OtaWriter writer;if(!writer.Begin(manifest,signature) || writer.remaining()!=req->content_len-16-manifest_size-signature_size)return WebReply(req,400,"Firma, versión o tamaño inválidos");
    unsigned char buffer[4096];while(writer.remaining()){const size_t size=std::min(sizeof(buffer),writer.remaining());if(!Receive(req,buffer,size)||!writer.Write(buffer,size))return WebReply(req,400,"Transferencia interrumpida; se conserva el firmware actual");}
    if(!writer.Finish())return WebReply(req,400,"No se pudo verificar el firmware; se conserva la versión actual");
    auto result=WebReply(req,200,"Firmware verificado; reiniciando");g_restart=true;return result;
}
}
bool DeviceConfigured(){LoadRuntime();return g_config.configured();}
const char* DeviceVersion(){return esp_app_get_description()->version;}
void DeviceConfirmFirmware(){ConfirmFirmware();}
void DeviceBootGuard(){FirmwareBootGuard();}
int g_dns_socket=-1;
std::atomic<bool> g_dns_running{false};
std::atomic<bool> g_dns_stop{false};
void PortalDnsTask(void*) {
    uint8_t packet[512];
    while(!g_dns_stop) {
        sockaddr_in peer{};socklen_t peer_size=sizeof(peer);
        const int count=recvfrom(g_dns_socket,packet,sizeof(packet),0,reinterpret_cast<sockaddr*>(&peer),&peer_size);
        if(count<=0)continue;
        const uint32_t ip=ntohl(peer.sin_addr.s_addr);
        if((ip&0xffffff00U)!=0xc0a80400U)continue;
        const size_t response=PortalDns(packet,count,sizeof(packet));
        if(response)sendto(g_dns_socket,packet,response,0,reinterpret_cast<sockaddr*>(&peer),peer_size);
    }
    close(g_dns_socket);g_dns_socket=-1;g_dns_running=false;vTaskDelete(nullptr);
}
void StartPortalDns() {
    g_dns_socket=socket(AF_INET,SOCK_DGRAM,IPPROTO_UDP);if(g_dns_socket<0)return;
    sockaddr_in address{};address.sin_family=AF_INET;address.sin_port=htons(53);address.sin_addr.s_addr=inet_addr("192.168.4.1");
    timeval timeout{0,200000};setsockopt(g_dns_socket,SOL_SOCKET,SO_RCVTIMEO,&timeout,sizeof(timeout));
    if(bind(g_dns_socket,reinterpret_cast<sockaddr*>(&address),sizeof(address))!=0){close(g_dns_socket);g_dns_socket=-1;return;}
    g_dns_stop=false;g_dns_running=true;
    if(xTaskCreate(PortalDnsTask,"nido_dns",4096,nullptr,3,nullptr)!=pdPASS){close(g_dns_socket);g_dns_socket=-1;g_dns_running=false;}
}
bool DeviceMaintenanceStart(DevicePower power) {
    std::lock_guard<std::mutex> lock(g_wifi_mutex);LoadRuntime();InitWifi();if(g_wifi_users || g_wifi_warming)return false;
    if(g_wifi_started){esp_wifi_disconnect();esp_wifi_stop();g_wifi_started=false;}
    if(!g_ap_netif)g_ap_netif=esp_netif_create_default_wifi_ap();
    if(!g_ap_netif)return false;
    uint8_t factory_mac[6];if(esp_efuse_mac_get_default(factory_mac)!=ESP_OK)return false;
    if(esp_wifi_start()!=ESP_OK)return false;
    g_power=power;g_ap_name=MaintenanceSsid(factory_mac);g_web_session=RandomHex(32);
    esp_wifi_stop();
    wifi_config_t ap={};std::memcpy(ap.ap.ssid,g_ap_name.data(),g_ap_name.size());ap.ap.ssid_len=g_ap_name.size();ap.ap.channel=1;ap.ap.max_connection=1;ap.ap.authmode=WIFI_AUTH_OPEN;
    if(esp_wifi_set_mode(WIFI_MODE_APSTA)!=ESP_OK || esp_wifi_set_config(WIFI_IF_AP,&ap)!=ESP_OK || esp_wifi_start()!=ESP_OK)return false;
    g_wifi_started=true;esp_wifi_set_ps(WIFI_PS_NONE);
    esp_netif_dhcps_stop(g_ap_netif);
    esp_netif_dns_info_t dns{};dns.ip.type=ESP_IPADDR_TYPE_V4;dns.ip.u_addr.ip4.addr=inet_addr("192.168.4.1");
    esp_netif_set_dns_info(g_ap_netif,ESP_NETIF_DNS_MAIN,&dns);
    uint8_t offer=1;esp_netif_dhcps_option(g_ap_netif,ESP_NETIF_OP_SET,ESP_NETIF_DOMAIN_NAME_SERVER,&offer,sizeof(offer));
    esp_netif_dhcps_start(g_ap_netif);
    httpd_config_t config=HTTPD_DEFAULT_CONFIG();config.stack_size=16384;config.recv_wait_timeout=30;config.send_wait_timeout=30;config.max_open_sockets=3;config.max_uri_handlers=12;config.lru_purge_enable=true;
    if(httpd_start(&g_http_server,&config)!=ESP_OK){esp_wifi_stop();g_wifi_started=false;esp_wifi_set_mode(WIFI_MODE_STA);return false;}
    for(const auto& route : {httpd_uri_t{"/",HTTP_GET,WebRoot,nullptr},httpd_uri_t{"/status",HTTP_GET,WebStatus,nullptr},httpd_uri_t{"/networks",HTTP_GET,WebNetworks,nullptr},httpd_uri_t{"/configure",HTTP_POST,WebConfigure,nullptr},httpd_uri_t{"/firmware",HTTP_POST,WebFirmware,nullptr},httpd_uri_t{"/exit",HTTP_POST,WebExit,nullptr}})httpd_register_uri_handler(g_http_server,&route);
    if(!PairRegister(g_http_server,ApplyCodePairing)){httpd_stop(g_http_server);g_http_server=nullptr;esp_wifi_stop();g_wifi_started=false;return false;}
    httpd_uri_t pair_route{"/pair/start",HTTP_POST,WebPairStart,nullptr};httpd_register_uri_handler(g_http_server,&pair_route);
    g_pair_requested=false;g_pair_start=false;
    if(!g_config.configured()&&!g_config.ssid.empty()&&CandidateConnect(g_config)){g_pair_requested=true;g_pair_start=true;}
    g_pair_finish_at=0;
    httpd_register_err_handler(g_http_server,HTTPD_404_NOT_FOUND,WebPortal);StartPortalDns();
    g_maintenance_activity=esp_timer_get_time();g_exit_maintenance=false;g_restart=false;g_maintenance=true;return true;
}
const char* DeviceMaintenanceName(){return g_ap_name.c_str();}
bool DevicePairingCard(DeviceCard& card){
    PairView view;if(!PairViewChanged(view))return false;card={};std::strcpy(card.type,"text");std::strcpy(card.status,"progress");
    if(view.state=="waiting"){std::strcpy(card.title,"Vincular con Nido");std::snprintf(card.body,sizeof(card.body),"Código: %s\nEn Nido: Ajustes > Note4\nIP: %s\nVálido durante cinco minutos",view.code.c_str(),view.ip.c_str());}
    else if(view.state=="linked"){std::strcpy(card.status,"done");std::strcpy(card.title,"Vinculado con Nido");std::strcpy(card.body,"La conexión está guardada. Volviendo a Nido…");g_pair_finish_at=esp_timer_get_time()+2000000;}
    else {std::strcpy(card.status,"error");std::strcpy(card.title,"Vinculación cerrada");std::strcpy(card.body,"El código ha caducado o se han agotado los intentos. Sal y vuelve a entrar en mantenimiento para obtener otro.");}
    return true;
}

bool DeviceMaintenanceTick(bool exit) {
    if(!g_maintenance)return false;
    if(g_pair_start.exchange(false)) {
        esp_netif_ip_info_t info{};auto* sta=esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
        if(sta&&esp_netif_get_ip_info(sta,&info)==ESP_OK&&info.ip.addr){char ip[16];std::snprintf(ip,sizeof(ip),IPSTR,IP2STR(&info.ip));PairStart(g_ap_name,ip);}
    }
    if(g_pair_finish_at&&esp_timer_get_time()>=g_pair_finish_at)exit=true;
    if(g_restart){vTaskDelay(pdMS_TO_TICKS(500));esp_restart();}
    if(!exit && !g_exit_maintenance && esp_timer_get_time()-g_maintenance_activity<600000000LL)return true;
    // httpd_stop waits for an active transfer/configuration; do not take its Wi-Fi mutex first.
    if(g_http_server){httpd_stop(g_http_server);g_http_server=nullptr;}
    PairStop();g_pair_start=false;
    g_dns_stop=true;while(g_dns_running)vTaskDelay(pdMS_TO_TICKS(20));
    std::lock_guard<std::mutex> lock(g_wifi_mutex);esp_wifi_disconnect();esp_wifi_stop();g_wifi_started=false;esp_wifi_set_mode(WIFI_MODE_STA);SetStation(g_config);
    g_maintenance=false;g_web_session.clear();return false;
}

namespace {
void InitWifi() {
    if (g_initialized) return;
    // Do not erase NVS if it belongs to an older factory image.
    // PHY calibration uses NVS even with Wi-Fi credentials kept only in RAM.
    const esp_err_t nvs = nvs_flash_init();
    if (nvs != ESP_OK) ESP_LOGW(kTag,"NVS unavailable (%s); preserving flash, PHY will fully calibrate",esp_err_to_name(nvs));
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();
    g_wifi_events = xEventGroupCreate();
    ESP_ERROR_CHECK(g_wifi_events ? ESP_OK : ESP_ERR_NO_MEM);
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, WifiEvent, nullptr));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, WifiEvent, nullptr));
    wifi_init_config_t config = WIFI_INIT_CONFIG_DEFAULT();
    config.nvs_enable = 0;
    ESP_ERROR_CHECK(esp_wifi_init(&config));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    LoadRuntime();
    SetStation(g_config);
    g_initialized = true;
}
struct WifiScope {
    bool acquired = false;
    int64_t retain_us=5000000;
    bool Connect(bool interactive=false,bool setup=false) {
        retain_us=interactive ? kWifiWarmUs : 5000000;
        const int64_t began=esp_timer_get_time();
        std::lock_guard<std::mutex> lock(g_wifi_mutex);
        if(!acquired){++g_wifi_users;acquired=true;}
        LoadRuntime();if((setup ? g_config.ssid.empty() : !g_config.configured()) || g_maintenance)return false;
        InitWifi();
        g_wifi_until=std::max(g_wifi_until,esp_timer_get_time()+retain_us);
        if(g_wifi_started && (xEventGroupGetBits(g_wifi_events)&kConnected)) {
            ESP_LOGI(kTag,"latency wifi_ms=%lld reused=1",(esp_timer_get_time()-began)/1000);
            return true;
        }
        xEventGroupClearBits(g_wifi_events, kConnected | kDisconnected);
        if(!g_wifi_started)g_wifi_started=esp_wifi_start()==ESP_OK;
        if (!g_wifi_started) return false;
        esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
        const int64_t deadline = esp_timer_get_time() + 15000000LL;
        for (int attempt=1;attempt<=3 && esp_timer_get_time()<deadline;++attempt) {
            xEventGroupClearBits(g_wifi_events,kConnected | kDisconnected);
            const esp_err_t error = esp_wifi_connect();
            if (error != ESP_OK) { ESP_LOGW(kTag,"wifi connect attempt=%d error=%s",attempt,esp_err_to_name(error)); break; }
            const int64_t remaining_ms = std::max<int64_t>(1,(deadline-esp_timer_get_time())/1000);
            const auto bits = xEventGroupWaitBits(g_wifi_events,kConnected | kDisconnected,pdFALSE,pdFALSE,pdMS_TO_TICKS(remaining_ms));
            if (bits & kConnected) { ESP_LOGI(kTag,"latency wifi_ms=%lld reused=0 attempt=%d",(esp_timer_get_time()-began)/1000,attempt); return true; }
            if (!(bits & kDisconnected)) break;
            if (attempt<3 && esp_timer_get_time()+250000<deadline) vTaskDelay(pdMS_TO_TICKS(250));
        }
        ESP_LOGW(kTag,"wifi connection failed within 15s budget");
        return false;
    }
    ~WifiScope() {
        std::lock_guard<std::mutex> lock(g_wifi_mutex);
        if(acquired){--g_wifi_users;g_wifi_until=std::max(g_wifi_until,esp_timer_get_time()+retain_us);}
    }
};
void WarmWifiTask(void*) {
    {WifiScope wifi;wifi.Connect(true);}
    g_wifi_warming=false;
    vTaskDelete(nullptr);
}
struct Response { std::string body; };
esp_err_t HttpEvent(esp_http_client_event_t* event) {
    if (event->event_id == HTTP_EVENT_ON_DATA) {
        auto* response = static_cast<Response*>(event->user_data);
        if (response->body.size() + event->data_len > 65536) return ESP_ERR_NO_MEM;
        response->body.append(static_cast<char*>(event->data), event->data_len);
    }
    return ESP_OK;
}
struct HttpSession {
    Response response;
    esp_http_client_handle_t client = nullptr;
    explicit HttpSession(const char* turn, bool home=false) {
        char url[256];
        if(home) std::snprintf(url,sizeof(url),"%s%s",g_config.endpoint.c_str(),turn);
        else std::snprintf(url,sizeof(url),"%s/v1/turns/%s",g_config.endpoint.c_str(),turn);
        esp_http_client_config_t config = {};
        config.url = url; config.cert_pem = g_config.certificate.c_str();
        config.timeout_ms = 15000; config.event_handler = HttpEvent; config.user_data = &response;
        config.buffer_size = 2048; config.buffer_size_tx = 1024;
        config.disable_auto_redirect = true; config.keep_alive_enable = true;
        client = esp_http_client_init(&config);
        if (client) {
            std::string auth = std::string("Bearer ") + g_config.token.c_str();
            esp_http_client_set_header(client,"Authorization",auth.c_str());
            esp_http_client_set_header(client,"X-Nido-Card-Version","2");
            esp_http_client_set_header(client,"X-Nido-Firmware-Version",DeviceVersion());
        }
    }
    ~HttpSession() { if (client) esp_http_client_cleanup(client); }
    bool SetPath(const char* path) {
        if(!client)return false;
        const std::string url=g_config.endpoint+path;
        return esp_http_client_set_url(client,url.c_str())==ESP_OK;
    }
    bool Request(const void* body, size_t size, const char* mime) {
        if (!client) return false;
        esp_http_client_set_method(client,body ? HTTP_METHOD_POST : HTTP_METHOD_GET);
        esp_http_client_set_post_field(client,static_cast<const char*>(body),size);
        if (body) esp_http_client_set_header(client,"Content-Type",mime);
        response.body.clear();
        const int64_t began=esp_timer_get_time();
        const esp_err_t error = esp_http_client_perform(client);
        const int status = esp_http_client_get_status_code(client);
        ESP_LOGI(kTag,"latency http_ms=%lld sent=%u status=%d transport=%s received=%u",
            (esp_timer_get_time()-began)/1000,static_cast<unsigned>(size),status,esp_err_to_name(error),static_cast<unsigned>(response.body.size()));
        return error == ESP_OK && (status == 200 || status == 202);
    }
};
void Id(char (&id)[37]) {
    uint8_t bytes[16];
    esp_fill_random(bytes, sizeof(bytes));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    std::snprintf(id, sizeof(id), "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x", bytes[0],bytes[1],bytes[2],bytes[3],bytes[4],bytes[5],bytes[6],bytes[7],bytes[8],bytes[9],bytes[10],bytes[11],bytes[12],bytes[13],bytes[14],bytes[15]);
}
bool String(cJSON* parent, const char* key, char* target, size_t size) {
    cJSON* value = cJSON_GetObjectItemCaseSensitive(parent, key);
    if (!cJSON_IsString(value) || std::strlen(value->valuestring) >= size) return false;
    std::strcpy(target, value->valuestring);
    return true;
}
bool Parse(const Response& response, DeviceResult& result, bool& active) {
    cJSON* root = cJSON_Parse(response.body.c_str());
    if (!root) return false;
    cJSON* card = cJSON_GetObjectItemCaseSensitive(root, "card");
    char turn[37], phase[24];
    bool valid = String(root,"turnId",turn,sizeof(turn)) && std::strcmp(turn,result.turn)==0 &&
        String(root,"phase",phase,sizeof(phase)) && ParseDeviceCard(card,result.card);
    const auto* busy = cJSON_GetObjectItemCaseSensitive(root,"active");
    valid = valid && cJSON_IsBool(busy);
    if (valid) {
        active = cJSON_IsTrue(busy);
        result.question = std::strcmp(phase,"question")==0;
        result.uncertain = std::strcmp(phase,"uncertain")==0;
        const auto* affected=cJSON_GetObjectItemCaseSensitive(root,"affectedDate");
        if(cJSON_IsString(affected)&&ValidHomeDate(affected->valuestring)&&std::strcmp(phase,"done")==0)
            std::strcpy(result.affected_date,affected->valuestring);
        const auto* time = cJSON_GetObjectItemCaseSensitive(root,"serverTime");
        if (cJSON_IsNumber(time) && time->valuedouble > 1700000000 && time->valuedouble < 2200000000) result.server_time = static_cast<int64_t>(time->valuedouble);
        const auto* expires = cJSON_GetObjectItemCaseSensitive(root,"sessionExpiresAt");
        if (cJSON_IsNumber(expires) && expires->valuedouble >= result.server_time && expires->valuedouble <= result.server_time + 301) result.session_expires_at = static_cast<int64_t>(expires->valuedouble);
    }
    cJSON_Delete(root);
    return valid;
}
void Exchange(DeviceResult& result, const void* body, size_t size, const char* mime, DevicePaint paint, DeviceCancelPoll cancel) {
    Id(result.turn);
    WifiScope wifi;
    {
        auto progress=std::make_unique<DeviceCard>();
        std::strcpy(progress->status, "progress"); std::strcpy(progress->type, "text");
        std::strcpy(progress->title, "Conectando con Nido"); std::strcpy(progress->body, "Estoy enviando tu petición…");
        paint(*progress);
    }
    if (!wifi.Connect(true)) { result.wifi_failed = true; return; }
    HttpSession http(result.turn);
    result.uncertain = true;
    bool accepted = http.Request(body,size,mime);
    // Same UUID + same bytes: safe even if the POST reached Nido but its reply was lost.
    if (!accepted) accepted = http.Request(body,size,mime);
    if (!accepted) return;
    const int64_t deadline = esp_timer_get_time() + 180000000LL;
    bool active = true;
    while (esp_timer_get_time() < deadline) {
        if (!Parse(http.response,result,active)) { result.uncertain = true; return; }
        if (!active) {
            result.ok = true;
            if (result.server_time) { timeval now{static_cast<time_t>(result.server_time),0}; settimeofday(&now,nullptr); }
            return;
        }
        if (std::strcmp(result.card.type,"binary")==0) {
            std::strcpy(result.card.status,"progress"); std::strcpy(result.card.type,"text");
            paint(result.card);
        } else paint(result.card);
        for(int tick=0;tick<50;++tick) {
            const int stop=cancel ? cancel() : 0;
            if(stop) {
                char path[80];std::snprintf(path,sizeof(path),"/v1/turns/%s/cancel%s",result.turn,stop==2 ? "?continue=1" : "");
                if(!http.SetPath(path)||!http.Request("{}",2,"application/json")){result.uncertain=true;return;}
                result.cancelled=true;result.ok=true;return;
            }
            vTaskDelay(pdMS_TO_TICKS(20));
        }
        if (!http.Request(nullptr,0,nullptr)) { result.uncertain = true; return; }
    }
    result.uncertain = true;
    return;
}
void U32(uint8_t* to, uint32_t value) { for (int i=0;i<4;++i) to[i]=(value>>(8*i))&255; }
void U16(uint8_t* to, uint16_t value) { to[0]=value&255; to[1]=value>>8; }
}
bool DeviceHome(HomeSnapshot& snapshot,const char* anchor,bool dismiss) {
    if(anchor && *anchor && !ValidHomeDate(anchor))return false;
    WifiScope wifi;if(!wifi.Connect())return false;
    char path[64];std::snprintf(path,sizeof(path),"/v1/home%s%s",anchor && *anchor ? "?date=" : "",anchor && *anchor ? anchor : "");
    HttpSession http(path,true);
    if(dismiss) {if(!http.SetPath("/v1/session/dismiss")||!http.Request("{}",2,"application/json"))return false;http.SetPath(path);}
    if(!http.Request(nullptr,0,nullptr))return false;
    cJSON* root=cJSON_Parse(http.response.body.c_str());if(!root)return false;
    const bool valid=ParseHome(root,snapshot);cJSON_Delete(root);
    if(valid){timeval now{static_cast<time_t>(snapshot.server_time),0};settimeofday(&now,nullptr);}
    return valid;
}
namespace { GithubRelease g_github_release; }
bool DeviceGithubCheck(char* version,size_t capacity){
    g_github_release={};const int64_t deadline=esp_timer_get_time()+20000000LL;
    WifiScope wifi;if(!wifi.Connect(true,true))return false;
    if(!GithubLatest(DeviceVersion(),g_github_release,deadline))return false;
    std::snprintf(version,capacity,"%s",g_github_release.version.c_str());return true;
}
bool DeviceGithubInstall(DevicePower power){
    if(!power||!power()||!GithubNewer(g_github_release.version,DeviceVersion()))return false;
    WifiScope wifi;if(!wifi.Connect(true,true)||!power())return false;
    const auto old_job=SavedString("ota_job"),old_version=SavedString("ota_version");
    if(!SaveJob("",g_github_release.version.c_str()))return false;
    if(!GithubInstall(g_github_release)){SaveJob(old_job.c_str(),old_version.c_str());return false;}
    esp_restart();return true;
}
void DeviceCheckUpdate(DevicePower power,DevicePaint paint) {
    WifiScope wifi;if(!wifi.Connect())return;
    char path[256];const std::string job=SavedString("ota_job"),expected_version=SavedString("ota_version");std::snprintf(path,sizeof(path),"/v1/maintenance/check?version=%s&boot=%s&job=%s",DeviceVersion(),job==g_boot_job ? FirmwareBootState(expected_version.c_str()) : "valid",job.c_str());
    HttpSession http(path,true);if(!http.Request(nullptr,0,nullptr))return;
    cJSON* root=cJSON_Parse(http.response.body.c_str());if(!root)return;
    auto* update=cJSON_GetObjectItemCaseSensitive(root,"update");
    auto field=[update](const char* key){auto* v=cJSON_GetObjectItemCaseSensitive(update,key);return std::string(cJSON_IsString(v) ? v->valuestring : "");};
    const std::string id=field("id"),manifest=field("manifest"),signature=field("signature");cJSON_Delete(root);
    if(id.empty() || id.size()>64)return;
    for(char c:id)if(!((c>='a'&&c<='z')||(c>='A'&&c<='Z')||(c>='0'&&c<='9')||c=='-'||c=='_'||c=='.'))return;
    auto report=[&http,&id](const char* phase,const char* detail=""){
      cJSON* r=cJSON_CreateObject();cJSON_AddStringToObject(r,"id",id.c_str());cJSON_AddStringToObject(r,"phase",phase);cJSON_AddStringToObject(r,"detail",detail);
      char* raw=cJSON_PrintUnformatted(r);const bool ok=raw && http.SetPath("/v1/maintenance/report") && http.Request(raw,std::strlen(raw),"application/json");cJSON_free(raw);cJSON_Delete(r);return ok;
    };
    if(!power || !power()){report("deferred","battery");return;}
    // Acquire the job before writing. A lost reply is reconciled on the next status read.
    if(!report("installing"))return;
    DeviceCard progress={};std::strcpy(progress.status,"progress");std::strcpy(progress.type,"text");std::strcpy(progress.title,"Actualizando Nido");std::strcpy(progress.body,"Mantén la alimentación. El Note4 se reiniciará al terminar.");paint(progress);
    OtaWriter writer;
    bool ok=writer.Begin(manifest,signature);
    if(!ok){report("failed","signature");return;}
    if(!SaveJob(id.c_str(),writer.version.c_str())){report("failed","storage");return;}
    const std::string url=g_config.endpoint+"/v1/maintenance/binary?id="+id;
    esp_http_client_config_t config={};config.url=url.c_str();config.cert_pem=g_config.certificate.c_str();config.timeout_ms=30000;config.disable_auto_redirect=true;
    auto client=esp_http_client_init(&config);
    if(client){
      const std::string auth="Bearer "+g_config.token;esp_http_client_set_header(client,"Authorization",auth.c_str());
      ok=esp_http_client_open(client,0)==ESP_OK;
      if(ok){const auto size=esp_http_client_fetch_headers(client);ok=esp_http_client_get_status_code(client)==200 && size==static_cast<int64_t>(writer.remaining());}
      unsigned char buffer[4096];
      while(ok && writer.remaining()) {const int n=esp_http_client_read(client,reinterpret_cast<char*>(buffer),std::min(sizeof(buffer),writer.remaining()));if(n<=0){ok=false;break;}ok=writer.Write(buffer,n);vTaskDelay(pdMS_TO_TICKS(1));}
      esp_http_client_close(client);esp_http_client_cleanup(client);
    }else ok=false;
    if(ok)ok=writer.Finish();
    if(ok){vTaskDelay(pdMS_TO_TICKS(250));esp_restart();}
    report("failed","download");
    std::strcpy(progress.status,"error");std::strcpy(progress.title,"Actualización interrumpida");std::strcpy(progress.body,"Se conserva el firmware actual. Consulta el estado en Nido.");paint(progress);
}

void DeviceWarmWifi() {
    if(g_wifi_warming.exchange(true))return;
    if(xTaskCreate(WarmWifiTask,"nido_wifi_warm",8192,nullptr,3,nullptr)!=pdPASS) {
        g_wifi_warming=false;ESP_LOGW(kTag,"wifi preconnect unavailable; will connect during send");
    }
}
bool DeviceWifiAwake(){return g_wifi_started || g_wifi_warming;}
bool DeviceWifiWarming(){return g_wifi_warming;}
void DeviceWifiIdle(bool keep) {
    std::unique_lock<std::mutex> lock(g_wifi_mutex,std::try_to_lock);
    if(!lock.owns_lock() || g_maintenance || g_wifi_users || g_wifi_warming || !g_wifi_started)return;
    if(keep)return;
    if(esp_timer_get_time()<g_wifi_until)return;
    esp_wifi_disconnect();esp_wifi_stop();g_wifi_started=false;
    xEventGroupClearBits(g_wifi_events,kConnected);
    ESP_LOGI(kTag,"wifi stopped after idle window");
}
bool DeviceEnabled() { return true; }
bool DeviceWifiConnected() { return g_wifi_events && (xEventGroupGetBits(g_wifi_events) & kConnected); }
void DeviceAudio(DeviceResult& result, const int16_t* pcm, size_t samples, DevicePaint paint, DeviceCancelPoll cancel) {
    const size_t bytes = samples*2;
    auto* wav = static_cast<uint8_t*>(heap_caps_malloc(bytes+44,MALLOC_CAP_SPIRAM|MALLOC_CAP_8BIT));
    if (!wav) return;
    std::memcpy(wav,"RIFF",4); U32(wav+4,bytes+36); std::memcpy(wav+8,"WAVEfmt ",8);
    U32(wav+16,16); U16(wav+20,1); U16(wav+22,1); U32(wav+24,16000); U32(wav+28,32000); U16(wav+32,2); U16(wav+34,16);
    std::memcpy(wav+36,"data",4); U32(wav+40,bytes); std::memcpy(wav+44,pcm,bytes);
    Exchange(result,wav,bytes+44,"audio/wav",paint,cancel);
    heap_caps_free(wav);
    return;
}
void DeviceAnswer(DeviceResult& result, const char* turn, const char* card, bool upper, DevicePaint paint, DeviceCancelPoll cancel) {
    cJSON* input = cJSON_CreateObject();
    cJSON_AddStringToObject(input,"turnId",turn); cJSON_AddStringToObject(input,"cardId",card); cJSON_AddStringToObject(input,"button",upper ? "upper" : "lower");
    char* body = cJSON_PrintUnformatted(input);
    if(body)Exchange(result,body,std::strlen(body),"application/json",paint,cancel);
    cJSON_free(body); cJSON_Delete(input);
    return;
}
}
#else
namespace nido {
bool DeviceHome(HomeSnapshot&,const char*,bool) { return false; }
bool DeviceEnabled() { return false; }
bool DeviceConfigured(){return false;}
const char* DeviceVersion(){return "local";}
void DeviceConfirmFirmware(){ConfirmFirmware();}
void DeviceBootGuard(){FirmwareBootGuard();}
bool DeviceGithubCheck(char*,size_t){return false;}
bool DeviceGithubInstall(DevicePower){return false;}
bool DeviceMaintenanceStart(DevicePower){return false;}
const char* DeviceMaintenanceName(){return "";}
bool DevicePairingCard(DeviceCard&){return false;}
bool DeviceMaintenanceTick(bool){return false;}
void DeviceCheckUpdate(DevicePower,DevicePaint){}
void DeviceWarmWifi() {}
bool DeviceWifiAwake(){return false;}
bool DeviceWifiWarming(){return false;}
void DeviceWifiIdle(bool){}
bool DeviceWifiConnected() { return false; }
void DeviceAudio(DeviceResult& result, const int16_t*, size_t, DevicePaint, DeviceCancelPoll) { result={}; }
void DeviceAnswer(DeviceResult& result, const char*, const char*, bool, DevicePaint, DeviceCancelPoll) { result={}; }
}
#endif
