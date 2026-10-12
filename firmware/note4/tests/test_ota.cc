// Actual OtaWriter and Mbed TLS; only flash/bootloader calls are replaced in memory.
#include "nido_ota.h"
#include "esp_timer.h"
#include <cassert>
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
 std::puts("Signed OTA: real RSA verification, streaming, integrity, aborts and boot guards passed");
}
