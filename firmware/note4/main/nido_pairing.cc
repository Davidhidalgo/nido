#include "nido_pairing.h"
#include "nido_pairing_key.h"
#include "protocomm.h"
#include "protocomm_security2.h"
#include "esp_srp.h"
#include "session.pb-c.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "mdns.h"
#include "lwip/sockets.h"
#include <mutex>
#include <cstring>
#include <cstdlib>
#include <vector>
#include <cstdio>
namespace nido {
namespace {
std::mutex mutex;
protocomm_t* pc=nullptr;
char *salt=nullptr,*verifier=nullptr;
std::string code,ip,name,window,state;
int64_t expires=0;
int attempts=0,stage=0;
bool changed=false,mdns_ready=false,session_open=false;
PairApply apply=nullptr;
void Close() {
    if(pc){if(session_open)protocomm_close_session(pc,1);protocomm_delete(pc);pc=nullptr;}
    session_open=false;free(salt);free(verifier);salt=verifier=nullptr;
    if(mdns_ready){mdns_free();mdns_ready=false;}
    code.clear();window.clear();
}
bool Active(){return pc && state=="waiting" && esp_timer_get_time()<expires;}
esp_err_t Reply(httpd_req_t* req,const char* status,const char* body) {httpd_resp_set_status(req,status);httpd_resp_set_type(req,"application/json");httpd_resp_set_hdr(req,"Cache-Control","no-store");return httpd_resp_send(req,body,HTTPD_RESP_USE_STRLEN);}
bool Station(httpd_req_t* req){
    // Provisioning endpoints exist only on the acquired station address, never on the open AP.
    sockaddr_storage address{};socklen_t size=sizeof(address);
    if(ip.empty()||getsockname(httpd_req_to_sockfd(req),reinterpret_cast<sockaddr*>(&address),&size))return false;
    uint32_t expected=inet_addr(ip.c_str());
    if(address.ss_family==AF_INET){sockaddr_in a{};std::memcpy(&a,&address,sizeof(a));return a.sin_addr.s_addr==expected;}
    if(address.ss_family==AF_INET6){sockaddr_in6 a{};std::memcpy(&a,&address,sizeof(a));const uint8_t prefix[12]={0,0,0,0,0,0,0,0,0,0,255,255};return !std::memcmp(&a.sin6_addr,prefix,12)&&!std::memcmp(reinterpret_cast<uint8_t*>(&a.sin6_addr)+12,&expected,4);}
    return false;
}
esp_err_t Apply(uint32_t,const uint8_t* in,ssize_t size,uint8_t** out,ssize_t* out_size,void*){
    if(size<=0||size>8192||!apply)return ESP_ERR_INVALID_ARG;
    const std::string json(reinterpret_cast<const char*>(in),size);
    cJSON* packet=cJSON_Parse(json.c_str());const bool ok=packet&&apply(packet);cJSON_Delete(packet);
    const char* result=ok?"{\"ok\":true}":"{\"ok\":false}";
    *out_size=std::strlen(result);*out=static_cast<uint8_t*>(std::malloc(*out_size));if(!*out)return ESP_ERR_NO_MEM;
    std::memcpy(*out,result,*out_size);
    if(ok){state="linked";changed=true;}return ESP_OK;
}
esp_err_t Info(httpd_req_t* req){std::lock_guard<std::mutex> guard(mutex);if(!Station(req)||!Active())return Reply(req,"403 Forbidden","{\"error\":\"No hay vinculación abierta\"}");
    const std::string json="{\"protocol\":\"nido-srp2-1\",\"name\":\""+name+"\",\"window\":\""+window+"\"}";return Reply(req,"200 OK",json.c_str());}
esp_err_t Exchange(httpd_req_t* req){
    std::lock_guard<std::mutex> guard(mutex);
    char token[40]={};
    if(!Station(req)||!Active()||httpd_req_get_hdr_value_len(req,"Origin")||httpd_req_get_hdr_value_str(req,"X-Nido-Pairing",token,sizeof(token))!=ESP_OK||window!=token||req->content_len<=0||req->content_len>8192)return Reply(req,"403 Forbidden","{\"error\":\"Vinculación no disponible\"}");
    std::vector<uint8_t> input(req->content_len);size_t used=0;
    while(used<input.size()){const int count=httpd_req_recv(req,reinterpret_cast<char*>(input.data()+used),input.size()-used);if(count<=0)return ESP_FAIL;used+=count;}
    const bool security=std::strcmp(req->uri,"/pair/session")==0;
    if(security){
        SessionData* msg=session_data__unpack(nullptr,input.size(),input.data());
        const bool hello=msg&&msg->sec_ver==2&&msg->proto_case==SESSION_DATA__PROTO_SEC2&&msg->sec2&&msg->sec2->msg==SEC2_MSG_TYPE__S2Session_Command0&&msg->sec2->payload_case==SEC2_PAYLOAD__PAYLOAD_SC0&&msg->sec2->sc0&&ValidPairingPublicKey(msg->sec2->sc0->client_pubkey.data,msg->sec2->sc0->client_pubkey.len)&&msg->sec2->sc0->client_username.len==4&&!std::memcmp(msg->sec2->sc0->client_username.data,"nido",4);
        const bool proof=msg&&msg->sec_ver==2&&msg->proto_case==SESSION_DATA__PROTO_SEC2&&msg->sec2&&msg->sec2->msg==SEC2_MSG_TYPE__S2Session_Command1&&msg->sec2->payload_case==SEC2_PAYLOAD__PAYLOAD_SC1&&msg->sec2->sc1&&msg->sec2->sc1->client_proof.len==64;
        if(msg)session_data__free_unpacked(msg,nullptr);
        if(hello){if(attempts>=5){state="locked";changed=true;return Reply(req,"403 Forbidden","{}");}++attempts;if(session_open)protocomm_close_session(pc,1);session_open=protocomm_open_session(pc,1)==ESP_OK;stage=0;if(!session_open)return ESP_FAIL;}
        else if(!proof||stage!=1)return Reply(req,"403 Forbidden","{}");
    }else if(stage!=2)return Reply(req,"403 Forbidden","{}");
    uint8_t* output=nullptr;ssize_t length=0;
    const esp_err_t err=protocomm_req_handle(pc,security?"session":"config",1,input.data(),input.size(),&output,&length);
    if(err!=ESP_OK){free(output);stage=0;if(attempts>=5){state="locked";changed=true;}return Reply(req,"403 Forbidden","{\"error\":\"Código incorrecto o mensaje inválido\"}");}
    if(security)++stage;
    httpd_resp_set_type(req,"application/octet-stream");httpd_resp_set_hdr(req,"Cache-Control","no-store");const auto sent=httpd_resp_send(req,reinterpret_cast<char*>(output),length);free(output);return sent;
}
}
bool PairRegister(httpd_handle_t server,PairApply handler){apply=handler;for(const auto& route:{httpd_uri_t{"/pair/info",HTTP_GET,Info,nullptr},httpd_uri_t{"/pair/session",HTTP_POST,Exchange,nullptr},httpd_uri_t{"/pair/config",HTTP_POST,Exchange,nullptr}})if(httpd_register_uri_handler(server,&route)!=ESP_OK)return false;return true;}
bool PairStart(const std::string& device_name,const std::string& address){
    std::lock_guard<std::mutex> guard(mutex);Close();name=device_name;ip=address;attempts=stage=0;
    uint32_t random;do{esp_fill_random(&random,sizeof(random));}while(random>=4294000000U);
    char digits[7];std::snprintf(digits,sizeof(digits),"%06u",static_cast<unsigned>(random%1000000));code=digits;
    uint8_t nonce[16];esp_fill_random(nonce,sizeof(nonce));window.clear();for(auto b:nonce){char hex[3];std::snprintf(hex,sizeof(hex),"%02x",b);window+=hex;}
    // Never emit salt/verifier/passcode through the SDK's debug logging.
    esp_log_level_set("srp6a",ESP_LOG_WARN);esp_log_level_set("protocomm_security2",ESP_LOG_WARN);
    int verifier_size=0;
    if(esp_srp_gen_salt_verifier("nido",4,code.c_str(),6,&salt,16,&verifier,&verifier_size)!=ESP_OK){Close();return false;}
    protocomm_security2_params_t params{salt,16,verifier,static_cast<uint16_t>(verifier_size)};pc=protocomm_new();
    if(!pc||protocomm_set_security(pc,"session",&protocomm_security2,&params)!=ESP_OK||protocomm_add_endpoint(pc,"config",Apply,nullptr)!=ESP_OK){Close();return false;}
    int version=0;uint8_t patch=0;if(protocomm_get_sec_version(pc,&version,&patch)!=ESP_OK||version!=2||patch!=1){Close();return false;}
    if(mdns_init()==ESP_OK){mdns_ready=true;std::string hostname=name;for(auto& c:hostname)if(c>='A'&&c<='Z')c+=32;mdns_hostname_set(hostname.c_str());mdns_service_add(name.c_str(),"_nido-pair","_tcp",80,nullptr,0);}
    expires=esp_timer_get_time()+300000000LL;state="waiting";changed=true;return true;
}
void PairStop(){std::lock_guard<std::mutex> guard(mutex);Close();state.clear();changed=false;}
bool PairViewChanged(PairView& view){std::lock_guard<std::mutex> guard(mutex);if(state=="waiting"&&esp_timer_get_time()>=expires){state="expired";changed=true;Close();}if(!changed)return false;changed=false;view={code,ip,state};return true;}
}
