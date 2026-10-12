// Actual OtaWriter and Mbed TLS; only flash/bootloader calls are replaced in memory.
#include "nido_ota.h"
#include "nido_github.h"
#include "esp_http_client.h"
#include "esp_crt_bundle.h"
#include "esp_timer.h"
#include <cassert>
#include <algorithm>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>
namespace {
esp_partition_t inactive{4194304},running{4194304};std::vector<unsigned char> flash;
bool boot_changed=false,write_fail=false,end_fail=false,read_fail=false,description_fail=false;
int begins=0,aborts=0,confirmed=0,rollbacks=0;
esp_ota_img_states_t boot_state=ESP_OTA_IMG_PENDING_VERIFY;int64_t clock_us=0;
std::string Read(const std::string& path){std::ifstream in(path,std::ios::binary);assert(in.good());return {std::istreambuf_iterator<char>(in),{}};}
}
esp_err_t esp_ota_begin(const esp_partition_t* p,size_t size,esp_ota_handle_t* handle){assert(p==&inactive);assert(size<=p->size);flash.clear();boot_changed=false;++begins;*handle=1;return 0;}
esp_err_t esp_ota_write(esp_ota_handle_t,const void* bytes,size_t size){if(write_fail)return -1;const auto* p=static_cast<const unsigned char*>(bytes);flash.insert(flash.end(),p,p+size);return 0;}
esp_err_t esp_ota_end(esp_ota_handle_t){return end_fail ? -1 : 0;}
esp_err_t esp_ota_abort(esp_ota_handle_t){++aborts;return 0;}
esp_err_t esp_ota_set_boot_partition(const esp_partition_t* p){assert(p==&inactive);boot_changed=true;return 0;}
const esp_partition_t* esp_ota_get_next_update_partition(const esp_partition_t*){return &inactive;}
const esp_partition_t* esp_ota_get_running_partition(){return &running;}
esp_err_t esp_ota_get_partition_description(const esp_partition_t*,esp_app_desc_t* d){if(description_fail || flash.size()<112)return -1;std::memcpy(d->version,flash.data()+48,32);std::memcpy(d->project_name,flash.data()+80,32);return 0;}
esp_err_t esp_ota_get_state_partition(const esp_partition_t*,esp_ota_img_states_t* state){*state=boot_state;return 0;}
esp_err_t esp_ota_mark_app_valid_cancel_rollback(){++confirmed;boot_state=ESP_OTA_IMG_VALID;return 0;}
esp_err_t esp_ota_mark_app_invalid_rollback_and_reboot(){++rollbacks;return 0;}
const esp_partition_t* esp_partition_find_first(int,esp_partition_subtype_t,const char*){return nullptr;}
esp_err_t esp_partition_read(const esp_partition_t*,size_t offset,void* bytes,size_t size){if(read_fail || offset+size>flash.size())return -1;std::memcpy(bytes,flash.data()+offset,size);return 0;}
int64_t esp_timer_get_time(){return clock_us;}
struct FakeHttp {esp_http_client_config_t config;std::string url,body;size_t offset=0;};
namespace {std::string http_body,http_redirect;bool http_incomplete=false;int http_status=200,http_opened=0;bool http_chunked=false;}
esp_http_client_handle_t esp_http_client_init(const esp_http_client_config_t* c){assert(c->crt_bundle_attach==esp_crt_bundle_attach);assert(c->disable_auto_redirect);assert(c->timeout_ms>0&&c->timeout_ms<=5000);return new FakeHttp{*c,c->url,http_body,0};}
int esp_http_client_close(esp_http_client_handle_t){return 0;}
int esp_http_client_cleanup(esp_http_client_handle_t c){delete c;return 0;}
int esp_http_client_set_header(esp_http_client_handle_t,const char* key,const char*){assert(std::strcmp(key,"Authorization"));return 0;}
int esp_http_client_open(esp_http_client_handle_t c,int){++http_opened;const auto path=c->url.find('/',8);const size_t line=4+c->url.size()-path+11;return line>=static_cast<size_t>(c->config.buffer_size_tx?c->config.buffer_size_tx:512)?ESP_FAIL:ESP_OK;}
int esp_http_client_set_timeout_ms(esp_http_client_handle_t,int){return 0;}
int64_t esp_http_client_fetch_headers(esp_http_client_handle_t c){if(!http_redirect.empty()){esp_http_client_event_t e{HTTP_EVENT_ON_HEADER,"Location",http_redirect.c_str(),c->config.user_data};c->config.event_handler(&e);}return http_chunked?0:c->body.size();}
int esp_http_client_get_status_code(esp_http_client_handle_t c){return c->url==http_redirect && c->url.find("release-assets.githubusercontent.com")!=std::string::npos?200:http_status;}
int esp_http_client_read(esp_http_client_handle_t c,char* out,int capacity){size_t n=std::min({size_t(capacity),size_t(7),c->body.size()-c->offset});std::memcpy(out,c->body.data()+c->offset,n);c->offset+=n;return n;}
bool esp_http_client_is_complete_data_received(esp_http_client_handle_t c){return !http_incomplete&&c->offset==c->body.size();}
int main(int argc,char** argv){
 assert(argc==2);const std::string dir=argv[1];const auto manifest=Read(dir+"/ota-manifest.json"),signature=Read(dir+"/ota-signature.txt"),image=Read(dir+"/ota-fixture.bin");
 {nido::OtaWriter w;auto bad=signature;bad[0]=bad[0]=='a'?'b':'a';assert(!w.Begin(manifest,bad));assert(!w.Begin(manifest+" ",signature));assert(!w.Begin(Read(dir+"/ota-incompatible.json"),Read(dir+"/ota-incompatible-signature.txt")));assert(begins==0);}
 {nido::OtaWriter w;assert(w.Begin(manifest,signature));for(size_t i=0;i<image.size();i+=7)assert(w.Write(image.data()+i,std::min(size_t(7),image.size()-i)));assert(w.remaining()==0);assert(w.Finish());assert(boot_changed);}
 {nido::OtaWriter w;assert(w.Begin(manifest,signature));assert(w.Write(image.data(),128));assert(!w.Finish());assert(!boot_changed);}assert(aborts==1);
 {nido::OtaWriter w;assert(w.Begin(manifest,signature));auto changed=image;changed.back()=1;assert(w.Write(changed.data(),changed.size()));assert(!w.Finish());assert(!boot_changed);}
 {nido::OtaWriter w;assert(w.Begin(manifest,signature));auto changed=image;changed[12]=0;assert(!w.Write(changed.data(),changed.size()));assert(!boot_changed);}
 {nido::OtaWriter w;assert(w.Begin(manifest,signature));assert(!w.Write(image.data(),image.size()+1));}
 for(int fault=0;fault<4;++fault){nido::OtaWriter w;assert(w.Begin(manifest,signature));write_fail=fault==0;assert(w.Write(image.data(),image.size())==!write_fail);read_fail=fault==1;description_fail=fault==2;end_fail=fault==3;assert(!w.Finish());assert(!boot_changed);write_fail=read_fail=description_fail=end_fail=false;}
 nido::FirmwareBootGuard();clock_us=30000001;nido::FirmwareBootGuard();assert(rollbacks==1);nido::ConfirmFirmware();assert(confirmed==1);nido::FirmwareBootGuard();assert(rollbacks==1);
 std::string bundle(16,'\0');bundle.replace(0,8,"NIDOOTA1");auto put=[&](int offset,uint32_t n){for(int i=0;i<4;i++)bundle[offset+i]=(n>>(8*i))&255;};put(8,manifest.size());put(12,signature.size());bundle+=manifest+signature+image;
 nido::GithubRelease selected{"native-test","https://github.com/example/nido/releases/download/native-test/firmware.nidoota",bundle.size()};
 http_body=bundle;assert(nido::GithubInstall(selected));assert(boot_changed);
 http_chunked=true;assert(nido::GithubInstall(selected));http_chunked=false;
 for(int failure=0;failure<6;failure++){boot_changed=false;http_body=bundle;auto wanted=selected;
   if(failure==0)http_body.pop_back();if(failure==1)http_body.back()^=1;if(failure==2)http_body[16+manifest.size()]='z';if(failure==3)wanted.version="different";if(failure==4)http_incomplete=true;if(failure==5)http_body[8]=0;
   assert(!nido::GithubInstall(wanted));assert(!boot_changed);http_incomplete=false;
 }
 http_body=bundle;http_status=302;http_redirect="https://evil.example/private";http_opened=0;assert(!nido::GithubInstall(selected));assert(http_opened==1);
 http_redirect="https://release-assets.githubusercontent.com/example/firmware?signature="+std::string(900,'a');
 http_opened=0;assert(nido::GithubInstall(selected));assert(http_opened==2);assert(boot_changed);
 http_redirect=selected.url;http_opened=0;assert(!nido::GithubInstall(selected));assert(http_opened==4);http_redirect.clear();http_status=200;
 http_body=R"({"tag_name":"nido-ota-0.4.3","draft":false,"prerelease":false,"assets":[{"name":"firmware.nidoota","state":"uploaded","size":2048,"browser_download_url":"https://github.com/Davidhidalgo/nido/releases/download/nido-ota-0.4.3/firmware.nidoota"}]})";
 nido::GithubRelease latest;assert(nido::GithubLatest("nido-ota-0.4.2",latest,clock_us+1000000));assert(latest.version=="nido-ota-0.4.3");assert(!nido::GithubLatest("nido-ota-0.4.2",latest,clock_us-1));
 http_body=std::string(65537,'x');assert(!nido::GithubLatest("nido-ota-0.4.2",latest,clock_us+1000000));
 std::puts("Direct GitHub OTA: TLS policy, bounded redirects, chunks, signed bundle and corrupt downloads verified");
 std::puts("Signed OTA: real RSA verification, streaming, integrity, aborts and boot guards passed");
}
